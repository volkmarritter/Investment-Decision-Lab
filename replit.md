# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Investment Lab catalog data model (Task #111 — 2026-04)

The ETF catalog in `artifacts/investment-lab/src/lib/etfs.ts` is split
into two literals at source:

- `INSTRUMENTS: Record<ISIN, InstrumentRecord>` — master per-fund
  metadata (name, TER, listings, …). One row per ISIN.
- `BUCKETS: Record<key, BucketAssignment>` — bucket assignment with
  `default: ISIN` and `alternatives: ISIN[]` (single-line array).

A joined `CATALOG` view is built at module load so existing consumers
(engine, UI, admin parser) keep working unchanged. The admin
PR-injection helpers in `artifacts/api-server/src/lib/github.ts`
(`injectAlternative`, `removeAlternative`, `injectEntry`,
`setBucketDefault`) operate on both literals — they keep INSTRUMENTS
and BUCKETS in sync and rely on the headers
`const INSTRUMENTS: Record<string, InstrumentRecord> = {` and
`const BUCKETS: Record<string, BucketAssignment> = {` to locate the
blocks. Renaming those headers requires updating the helpers.

Phase 2 (Instruments admin sub-tab, tree-row registry pickers, strict
cross-bucket validator, glossary copy) is tracked as a separate task.

## Project Documentation

- **Investment Decision Lab** functional & logic documentation: `artifacts/investment-lab/DOCUMENTATION.md`.
  - **Maintenance rule:** whenever a feature is added, removed, or its behaviour changes in the Investment Decision Lab, this file MUST be updated and a new entry MUST be appended to its Changelog section.
  - **Test rule:** the Investment Decision Lab has an automated regression suite at `artifacts/investment-lab/tests/engine.test.ts` (Vitest). Whenever functional behaviour changes, the corresponding test MUST be added/updated and `pnpm --filter @workspace/investment-lab run test` MUST pass before completing the change. Bugfixes MUST include a regression test.
  - **Mobile e2e rule:** mobile-viewport regressions (touch input, on-screen keyboard, narrow layout) are guarded by a Playwright suite at `artifacts/investment-lab/tests/e2e/`. It runs against an iPhone-13-sized chromium viewport via `pnpm --filter @workspace/investment-lab run test:e2e` (registered as the `e2e` validation). When adding features that touch any mobile-only input or commit-on-blur path, extend that suite. Outside Replit, run `pnpm --filter @workspace/investment-lab run test:e2e:install` once to fetch the chromium binary; inside Replit it uses the system chromium at `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
  - **Admin pane (`/admin`):** the in-app operator UI for paste-an-ISIN → preview → open-pull-request plus read-only data update panels. Backed by `/api/admin/*` on the api-server (`artifacts/api-server/src/routes/admin.ts`), gated by `ADMIN_TOKEN`. Pull request creation needs `GITHUB_PAT`/`GITHUB_OWNER`/`GITHUB_REPO`. Per-field diffs are appended to `artifacts/investment-lab/src/data/refresh-changes.log.jsonl` by the scrapers via the helper at `scripts/lib/diff-overrides.mjs`. Full design + auth contract documented in `artifacts/investment-lab/ETF_DATA_CONTROL.md` §12.
    - **Layout (Task #101):** `/admin` is a thin shell (`src/pages/Admin.tsx`, ~115 lines) that owns auth + shared GitHub/catalog state (via `AdminContext`) and renders a sidebar layout with five nested wouter routes — Overview, Catalog, Defaults, Operations, Docs. Section pages live in `src/pages/admin/*`; per-flow panels live in `src/components/admin/*` (each ≤800 lines). Catalog has sub-tabs `browse | add-isin | batch`; Operations has sub-tabs `sync | prs | changes | runs | freshness`.
  - **Scraper helper module:** justETF regex extractors live in the pure ESM module `artifacts/investment-lab/scripts/lib/justetf-extract.mjs`, imported both by `scripts/refresh-justetf.mjs` and the api-server's `/api/admin/preview-isin` route. Do NOT import the CLI entrypoint (`refresh-justetf.mjs`) from server code — esbuild flattens its `import.meta.url === ...` guard and would run the CLI at server boot.
