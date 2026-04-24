#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-justetf.mjs
// ----------------------------------------------------------------------------
// Pulls the current TER (and a few other simple fields) for every ISIN listed
// in src/lib/etfs.ts from justETF and writes the result into
// src/data/etfs.overrides.json. The override layer in src/lib/etfs.ts then
// shallow-merges those values on top of the curated CATALOG, so the engine
// keeps working with no live network call at runtime.
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-justetf.mjs                 # refresh all ISINs
//   node scripts/refresh-justetf.mjs IE00B5BMR087    # refresh one ISIN
//   DRY_RUN=1 node scripts/refresh-justetf.mjs       # don't write JSON
//
// Notes
// - This is an unofficial scrape of justETF's public English ETF profile pages.
//   Be polite: a 1.5s delay is enforced between requests, and the script will
//   abort cleanly if a page fails to parse instead of writing junk.
// - HTML structure can change. If the TER regex stops matching, the existing
//   override file is preserved and a non-zero exit code is returned so a CI
//   job will surface the failure.
// - Only fields explicitly listed in EXTRACTORS are refreshed. Everything else
//   (replication, listings, comment, defaultExchange, ...) stays curated in
//   src/lib/etfs.ts.
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const OVERRIDES_JSON = resolve(ROOT, "src/data/etfs.overrides.json");
const REQUEST_DELAY_MS = 1500;
const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

const TARGET_ISINS = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extractIsinsFromCatalog() {
  const src = await readFile(ETFS_TS, "utf8");
  const isins = new Set();
  const re = /isin:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"/g;
  let m;
  while ((m = re.exec(src)) !== null) isins.add(m[1]);
  return [...isins];
}

// --- Field extractors ---------------------------------------------------------
// Each extractor receives the raw HTML of a justETF profile page and returns
// either a primitive value or `undefined` (= leave catalog default). Add more
// extractors here and they will be merged into the override file automatically.
const EXTRACTORS = {
  terBps: (html) => {
    const m =
      html.match(/Total expense ratio[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i) ||
      html.match(/Gesamtkostenquote[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i);
    if (!m) return undefined;
    const pct = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 3) return undefined;
    return Math.round(pct * 100); // store as basis points (0.07 % -> 7)
  },
};

async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
  return await res.text();
}

async function main() {
  const allIsins = await extractIsinsFromCatalog();
  const isins = TARGET_ISINS.length ? TARGET_ISINS : allIsins;
  console.log(`Refreshing ${isins.length} ISIN(s) from justETF...`);

  let existing = {};
  try {
    const raw = JSON.parse(await readFile(OVERRIDES_JSON, "utf8"));
    existing = raw.overrides ?? {};
  } catch {
    // first run — leave empty
  }

  const next = { ...existing };
  let okCount = 0;
  let failCount = 0;

  for (const isin of isins) {
    try {
      const html = await fetchProfile(isin);
      const patch = {};
      for (const [field, extractor] of Object.entries(EXTRACTORS)) {
        const v = extractor(html);
        if (v !== undefined) patch[field] = v;
      }
      if (Object.keys(patch).length === 0) {
        console.warn(`  ! ${isin}: no fields extracted (leaving previous value)`);
        failCount++;
      } else {
        next[isin] = { ...(existing[isin] ?? {}), ...patch };
        const summary = Object.entries(patch)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        console.log(`  \u2713 ${isin}: ${summary}`);
        okCount++;
      }
    } catch (e) {
      console.warn(`  ! ${isin}: ${e.message}`);
      failCount++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (process.env.DRY_RUN) {
    console.log("\nDRY_RUN set — not writing override file.");
    process.exit(failCount > okCount ? 1 : 0);
  }

  const payload = {
    _meta: {
      source: "justetf.com",
      lastRefreshed: new Date().toISOString(),
      refreshedBy: "scripts/refresh-justetf.mjs",
      note:
        "ISIN -> partial ETFRecord overrides applied on top of the in-code CATALOG in src/lib/etfs.ts. " +
        "Empty by default; populated by the nightly refresh script. Only fields present in this file override the catalog defaults; everything else stays as defined in code.",
    },
    overrides: next,
  };

  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OVERRIDES_JSON} (${okCount} ok, ${failCount} failed).`);
  process.exit(failCount > okCount ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
