// ----------------------------------------------------------------------------
// data-paths.ts
// ----------------------------------------------------------------------------
// Resolves on-disk paths to the investment-lab artifact's data files. The
// admin pane reads these directly so it always shows what the freshest
// committed data files contain — no separate DB, no caching layer.
//
// Path discovery is deliberately defensive because the api-server runs in
// two different layouts:
//
//   - dev (pnpm --filter @workspace/api-server run dev): the build output
//     lives in artifacts/api-server/dist/index.mjs and the cwd is
//     artifacts/api-server.
//   - production deployment: the same bundle is shipped, but cwd is the
//     monorepo root (/home/runner/workspace), which makes
//     `resolve(cwd, "../investment-lab/...")` walk OUT of the workspace
//     and ENOENT.
//
// We pin paths to the bundle's own URL (import.meta.url) which is the same
// in both layouts, then fall back through cwd-relative candidates so a
// future layout change doesn't break us silently.
//
// Always overridable with INVESTMENT_LAB_DATA_DIR / INVESTMENT_LAB_CATALOG_PATH.
// ----------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Directory containing the bundled api-server entry point (or this source
// file in non-bundled execution). Used as the anchor for relative path
// discovery so cwd doesn't matter.
const HERE = dirname(fileURLToPath(import.meta.url));

// Candidate paths for the investment-lab data directory, tried in order.
// The first one that exists wins. Listed most-likely-first.
function dataDirCandidates(): string[] {
  return [
    // Bundled layout: HERE = artifacts/api-server/dist/
    resolve(HERE, "../../investment-lab/src/data"),
    // Source layout: HERE = artifacts/api-server/src/lib/
    resolve(HERE, "../../../investment-lab/src/data"),
    // cwd = artifacts/api-server (dev script behaviour).
    resolve(process.cwd(), "../investment-lab/src/data"),
    // cwd = monorepo root (production deployment behaviour).
    resolve(process.cwd(), "artifacts/investment-lab/src/data"),
  ];
}

function catalogCandidates(): string[] {
  return [
    resolve(HERE, "../../investment-lab/src/lib/etfs.ts"),
    resolve(HERE, "../../../investment-lab/src/lib/etfs.ts"),
    resolve(process.cwd(), "../investment-lab/src/lib/etfs.ts"),
    resolve(process.cwd(), "artifacts/investment-lab/src/lib/etfs.ts"),
  ];
}

function firstExisting(candidates: string[]): string | null {
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function dataDir(): string {
  if (process.env.INVESTMENT_LAB_DATA_DIR) {
    return resolve(process.env.INVESTMENT_LAB_DATA_DIR);
  }
  const found = firstExisting(dataDirCandidates());
  if (found) return found;
  // Nothing exists — return the first candidate so the eventual ENOENT
  // surfaces a recognisable path in logs and operators can set the env
  // var to override.
  return dataDirCandidates()[0];
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
  const found = firstExisting(catalogCandidates());
  if (found) return found;
  return catalogCandidates()[0];
}
