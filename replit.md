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

## Validation policy (user preference — 2026-05)

Match validation effort to the size of the change. Do not run the full e2e suite for trivial edits.

- **Copy-only tweaks in `i18n.tsx` (no JSX, no logic)** → typecheck only.
- **Component JSX, props, or styling changes** → typecheck + unit tests (`pnpm --filter @workspace/investment-lab run test`).
- **Logic, routing, state, persistence, calculation, or anything touching the home-bias / explain / build flows** → typecheck + unit tests + full e2e (`restart_workflow e2e`).
- **Always full e2e before suggesting `suggest_deploy`.**

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

Phase 2 (Task #111 Phase 2 — 2026-04, completed): the catalog now
enforces **strict global ISIN uniqueness** — every ISIN appears in at
most one bucket slot (default OR alternative OR pool), and
`validateCatalog` fails fast otherwise. The mutators `injectEntry`,
`injectAlternative`, `setBucketDefault`, `injectPool`, `removePool`
reject any write that would violate this invariant; in particular
`setBucketDefault` also refuses targets that already live as an
alternative within the SAME bucket (would create a within-bucket
duplicate).

Phase 3 (Task #149 — 2026-05): per-bucket **extended-universe pool**
slot added (`BucketAssignment.pool?: string[]`, cap
`MAX_POOL_PER_BUCKET = 50`). Initial fill (2026-05-05): 74 of the 80
orphan popular UCITS ETFs (registered in INSTRUMENTS since the
2026-05-01 bulk-add) were assigned to bucket pools across 14 buckets
based on their `popular-etfs-seed.mjs` category — see
`artifacts/investment-lab/DOCUMENTATION.md` changelog entry
`pool-bulk-fill` for the full per-bucket breakdown. The
`tests/popular-etfs-orphan.test.ts` orphan-invariant was relaxed
accordingly: staged ISINs may now be `unassigned` OR `pool`, but
never `default`/`alternative` — checked via `getInstrumentRole`. Engine slot range extended in-place —
slots `0` = default, `1..altCount` = alternatives,
`altCount+1..altCount+poolCount` = pool. `resolvePickerSelection`
takes an optional `pool` 3rd arg (defaults to `[]` for backward
compat); `selectableOptions[]` rows now carry an optional
`kind: "default" | "alternative" | "pool"` discriminator. Build UI
splits the inline `<Select>` (default + alternatives) from a new
`More ETFs (N)` dialog (`MoreEtfsDialog.tsx`); Explain's per-bucket
`IsinPicker` flags pool rows via `getInstrumentRole`. Admin routes
`POST /admin/buckets/:key/pool` and `DELETE /admin/buckets/:key/pool/:isin`
(PR-only). **Gotcha:** `etfs.ts ↔ etfSelection.ts` form an import
cycle, so any cap that mixes `MAX_POOL_PER_BUCKET` and
`MAX_ALTERNATIVES_PER_BUCKET` in `etfSelection.ts` MUST be computed
lazily inside the function (not at module scope) — top-level access
would observe `MAX_POOL_PER_BUCKET` as `undefined` and silently drop
all stored selections through the `v <= NaN` guard. Operator-facing surfaces:
- **Instruments sub-tab** (`src/pages/admin/Catalog.tsx` + `src/components/admin/InstrumentsPanel.tsx`) — full CRUD over the INSTRUMENTS table with usage column.
- **Tree-row registry pickers** (`src/components/admin/InstrumentPicker.tsx`, wired in `ConsolidatedEtfTreePanel.tsx`) — "Default ändern" and "+ Alternative" buttons pick from already-registered, currently-unassigned ISINs; "Neues Instrument …" still allows ad-hoc creation via the legacy `AddAlternativeForm`.
- **Glossary** (`src/components/admin/Glossary.tsx`) — added plain-language entries explaining "Instrument" vs "Bucket-Zuordnung" (DE+EN).
- New backend routes: `GET/POST/PATCH/DELETE /admin/instruments`, `POST /admin/buckets/:key/alternatives`, `PUT /admin/buckets/:key/default` (all PR-only writes).

## Explain My Portfolio editor — tree of buckets (Task #148 — 2026-05)

The Explain tab's position editor (`artifacts/investment-lab/src/components/investment/ExplainPortfolio.tsx`) is a tree of catalog buckets, not a flat list with toolbar shortcuts. Every catalog asset class (Equity, Fixed Income, Real Estate, Commodities, Digital Assets, Cash) renders as a collapsible chevron header. Inside an expanded group, every bucket — populated or empty — shows its own header + per-bucket [+] button (`explain-add-in-bucket-${bucketKey}`) that opens a scoped IsinPicker pre-filtered to that bucket. The legacy "Add ETF" and "By bucket" toolbar buttons are removed; "Add manual ISIN" stays for off-catalog instruments.

Smart-default expand rule: `assetClassSummary(buckets).hasAnyRow` — a group is open by default iff any of its catalog buckets has at least one row (even an unselected/zero-weight one). The user's explicit chevron toggle is stored in component-local `expandedGroups: Record<assetClass, boolean>` and wins for the rest of the session (per-tab, not persisted).

Tail pseudo-groups: manual entries land in a "Manual entries" group, and any non-manual row whose `bucketKey` is missing or no longer in `ALL_BUCKET_KEYS` (catalog evolved) lands in an "Unassigned" group — both keep stale rows visible/removable.

E2E hooks (`tests/e2e/explain-portfolio.spec.ts`, `…file-roundtrip.spec.ts`): the `addCatalogRow(page, rowIndex, isin, bucketKey, groupSlug)` helper expands the group via `ensureGroupExpanded` (idempotent against the smart-default), taps `explain-add-in-bucket-${bucketKey}`, picks the ISIN, then waits ≤1s for Radix's `data-scroll-locked` overlay to release before returning. Per-test timeout in `playwright.config.ts` is 60s to absorb the extra chevron+overlay steps in the heavy "add three ETFs" test.

## Project Documentation

- **Investment Decision Lab** functional & logic documentation: `artifacts/investment-lab/DOCUMENTATION.md`.
  - **Maintenance rule:** whenever a feature is added, removed, or its behaviour changes in the Investment Decision Lab, this file MUST be updated and a new entry MUST be appended to its Changelog section.
  - **Test rule:** the Investment Decision Lab has an automated regression suite at `artifacts/investment-lab/tests/engine.test.ts` (Vitest). Whenever functional behaviour changes, the corresponding test MUST be added/updated and `pnpm --filter @workspace/investment-lab run test` MUST pass before completing the change. Bugfixes MUST include a regression test.
  - **Mobile e2e rule:** mobile-viewport regressions (touch input, on-screen keyboard, narrow layout) are guarded by a Playwright suite at `artifacts/investment-lab/tests/e2e/`. It runs against an iPhone-13-sized chromium viewport via `pnpm --filter @workspace/investment-lab run test:e2e` (registered as the `e2e` validation). When adding features that touch any mobile-only input or commit-on-blur path, extend that suite. Outside Replit, run `pnpm --filter @workspace/investment-lab run test:e2e:install` once to fetch the chromium binary; inside Replit it uses the system chromium at `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
  - **Admin pane (`/admin`):** the in-app operator UI for paste-an-ISIN → preview → open-pull-request plus read-only data update panels. Backed by `/api/admin/*` on the api-server (`artifacts/api-server/src/routes/admin.ts`), gated by `ADMIN_TOKEN`. Pull request creation needs `GITHUB_PAT`/`GITHUB_OWNER`/`GITHUB_REPO`. Per-field diffs are appended to `artifacts/investment-lab/src/data/refresh-changes.log.jsonl` by the scrapers via the helper at `scripts/lib/diff-overrides.mjs`. Full design + auth contract documented in `artifacts/investment-lab/ETF_DATA_CONTROL.md` §12.
    - **Layout (Task #101):** `/admin` is a thin shell (`src/pages/Admin.tsx`, ~115 lines) that owns auth + shared GitHub/catalog state (via `AdminContext`) and renders a sidebar layout with five nested wouter routes — Overview, Catalog, Defaults, Operations, Docs. Section pages live in `src/pages/admin/*`; per-flow panels live in `src/components/admin/*` (each ≤800 lines). Catalog has sub-tabs `browse | add-isin | batch`; Operations has sub-tabs `sync | prs | changes | runs | freshness`.
  - **Scraper helper module:** justETF regex extractors live in the pure ESM module `artifacts/investment-lab/scripts/lib/justetf-extract.mjs`, imported both by `scripts/refresh-justetf.mjs` and the api-server's `/api/admin/preview-isin` route. Do NOT import the CLI entrypoint (`refresh-justetf.mjs`) from server code — esbuild flattens its `import.meta.url === ...` guard and would run the CLI at server boot.

## Publishing the admin app — sync workflow

The admin UI in this workspace and the GitHub `main` branch both write to the same set of "data-as-code" files (`src/lib/etfs.ts`, `src/data/*.overrides.json`, `src/data/refresh-*.log.*`). When admin PRs are merged on github.com between two publishes, the workspace branch and `main` diverge. Clicking Publish then triggers a workspace→main merge that conflicts on those files.

**Bulletproof workflow before clicking Publish:**

1. Glance at the **Git pane**'s Remote Updates card. If the counter shows any incoming commits (`↓ N` with N > 0), or if you know admin PRs were merged on GitHub recently, run the sync script first.
2. Open the **Shell** tab and run:
   ```
   bash bin/sync-with-main.sh
   ```
   The script pulls main, auto-resolves conflicts on the known data files (always taking main's version, since main is the canonical source for operator-edited data), and stops with a clear error only if there's a real code-level conflict that needs human judgement.
3. Once the script reports `✓ Merge complete`, click **Push** in the Git pane (or run `git push <remote> main` — the script prints the exact command).
4. **Then** click **Publish/Republish**. The deploy will go through cleanly.

If a publish ever drops you into the conflict pane regardless, click **Abort merge** in the Git pane (it's lossless), then run the sync script — that's the universal recovery path.

Chat-attachment screenshots are gitignored (`attached_assets/image_*.png|jpg|jpeg`) so they no longer show up in the Git pane and don't need cleanup commits.
