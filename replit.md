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

## Project Documentation

- **Investment Decision Lab** functional & logic documentation: `artifacts/investment-lab/DOCUMENTATION.md`.
  - **Maintenance rule:** whenever a feature is added, removed, or its behaviour changes in the Investment Decision Lab, this file MUST be updated and a new entry MUST be appended to its Changelog section.
  - **Test rule:** the Investment Decision Lab has an automated regression suite at `artifacts/investment-lab/tests/engine.test.ts` (Vitest). Whenever functional behaviour changes, the corresponding test MUST be added/updated and `pnpm --filter @workspace/investment-lab run test` MUST pass before completing the change. Bugfixes MUST include a regression test.
