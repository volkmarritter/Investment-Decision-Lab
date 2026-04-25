// ----------------------------------------------------------------------------
// data-paths.ts
// ----------------------------------------------------------------------------
// Resolves on-disk paths to the investment-lab artifact's data files. The
// admin pane reads these directly so it always shows what the freshest
// committed data files contain — no separate DB, no caching layer.
//
// In dev (pnpm --filter @workspace/api-server run dev) the cwd is
// artifacts/api-server, so `../investment-lab/src/data` resolves correctly.
//
// In production both artifacts are deployed under the same monorepo root,
// so the same relative path holds. If a deployment ever inverts that
// layout, set INVESTMENT_LAB_DATA_DIR to an absolute path to override.
// ----------------------------------------------------------------------------

import { resolve } from "node:path";

const DEFAULT_REL = "../investment-lab/src/data";
const DEFAULT_CATALOG_REL = "../investment-lab/src/lib/etfs.ts";

export function dataDir(): string {
  if (process.env.INVESTMENT_LAB_DATA_DIR) {
    return resolve(process.env.INVESTMENT_LAB_DATA_DIR);
  }
  return resolve(process.cwd(), DEFAULT_REL);
}

export function dataFile(name: string): string {
  return resolve(dataDir(), name);
}

// Path to the canonical catalog source file. The admin pane's
// replace-vs-add diff parses this on demand to detect whether a chosen
// catalog key already exists. Override via INVESTMENT_LAB_CATALOG_PATH if
// the api-server is deployed away from the rest of the monorepo.
export function getCatalogPath(): string {
  if (process.env.INVESTMENT_LAB_CATALOG_PATH) {
    return resolve(process.env.INVESTMENT_LAB_CATALOG_PATH);
  }
  return resolve(process.cwd(), DEFAULT_CATALOG_REL);
}
