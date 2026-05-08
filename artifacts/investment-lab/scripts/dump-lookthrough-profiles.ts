// ----------------------------------------------------------------------------
// dump-lookthrough-profiles.ts — Task #207
// ----------------------------------------------------------------------------
// Helper invoked by `scripts/backfill-comments.mjs` to obtain the FULL
// merged look-through map (curated TS PROFILES literal in
// `src/lib/lookthrough.ts` + JSON overrides from
// `src/data/lookthrough.overrides.json`) the runtime UI uses via
// `profileFor(isin)`. The .mjs Node script can't import the curated
// PROFILES literal directly (TS types + ESM/CJS interop), so we spawn
// this tsx file once per backfill run and parse its stdout JSON. That
// way describeEtf("auto") in the backfill sees the same profile the
// runtime cell would render — closing the gap the round-2 review
// flagged ("derives auto text from lookthrough.overrides.json only,
// not the full runtime look-through map").
// ----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { profileFor } from "../src/lib/lookthrough";

// Collect every ISIN that appears anywhere in `etfs.ts` — INSTRUMENTS,
// BUCKETS defaults, alternatives, and pools are all listed there. A
// regex over the source text avoids needing dedicated runtime exports
// for the master table (currently INSTRUMENTS isn't exported, only
// the joined CATALOG view via getCatalog()).
const __dirname = dirname(fileURLToPath(import.meta.url));
const ETFS_TS = resolve(__dirname, "../src/lib/etfs.ts");
const src = readFileSync(ETFS_TS, "utf8");
const isins = new Set<string>();
for (const m of src.matchAll(/\bisin:\s*"([A-Z]{2}[A-Z0-9]{10})"/g)) {
  isins.add(m[1]);
}
for (const m of src.matchAll(/^  ([A-Z]{2}[A-Z0-9]{10}):\s*\{/gm)) {
  isins.add(m[1]);
}

const out: Record<string, unknown> = {};
for (const isin of isins) {
  const p = profileFor(isin);
  if (p) out[isin] = p;
}
process.stdout.write(JSON.stringify(out));
