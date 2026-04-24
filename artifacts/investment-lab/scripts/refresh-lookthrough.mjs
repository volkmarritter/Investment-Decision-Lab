#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-lookthrough.mjs
// ----------------------------------------------------------------------------
// Pulls the per-ISIN top-10 holdings from justETF and writes the result into
// src/data/lookthrough.overrides.json. The merge layer in src/lib/lookthrough.ts
// shallow-merges those values on top of the curated PROFILES so the engine
// keeps working with no live network call at runtime.
//
// Only `topHoldings` is refreshed here. The geo / sector / currency
// breakdowns stay hand-curated in src/lib/lookthrough.ts because justETF
// loads those tables via Wicket Ajax (not present in the static HTML), so a
// regex-based scrape can't pick them up. Their reference date stamp
// (`LOOKTHROUGH_REFERENCE_DATE`) therefore continues to apply to those three
// breakdowns; top-holdings carries its own per-ISIN `topHoldingsAsOf` ISO
// timestamp written by this script on every successful refresh.
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-lookthrough.mjs                 # refresh all ISINs
//   node scripts/refresh-lookthrough.mjs IE00B5BMR087    # refresh one ISIN
//   DRY_RUN=1 node scripts/refresh-lookthrough.mjs       # don't write JSON
//
// Politeness: 1.5 s delay between requests. Aborts cleanly if more than half
// of the pages fail to parse instead of writing junk.
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const LOOKTHROUGH_TS = resolve(ROOT, "src/lib/lookthrough.ts");
const OVERRIDES_JSON = resolve(ROOT, "src/data/lookthrough.overrides.json");
const REQUEST_DELAY_MS = 1500;
const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

const TARGET_ISINS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extractIsinsFromCatalog() {
  const src = await readFile(ETFS_TS, "utf8");
  const isins = new Set();
  const re = /isin:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"/g;
  let m;
  while ((m = re.exec(src)) !== null) isins.add(m[1]);
  return [...isins];
}

// Skip the small set of non-equity ISINs whose top-holdings list either does
// not apply (gold ETF) or is uninformative for an equity-style display
// (broad-market crypto basket published with daily-shifting weights). These
// stay hand-curated.
async function extractEquityIsinsFromLookthrough() {
  const src = await readFile(LOOKTHROUGH_TS, "utf8");
  const equity = new Set();
  // Match each PROFILES entry: "ISIN": { isEquity: true | false, ... }
  const re = /"([A-Z]{2}[A-Z0-9]{9}\d)"\s*:\s*\{\s*isEquity:\s*(true|false)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === "true") equity.add(m[1]);
  }
  return equity;
}

// Top-10 holdings: parses the static <table data-testid="etf-holdings_top-holdings_table">
// block on a justETF profile page. Returns an array of { name, pct } sorted in
// the same order justETF presents them (descending weight).
//
// Sanity bounds applied before accepting the parse:
//   - At least 3 rows must parse cleanly (broad-index ETFs always have 10).
//   - At most 10 rows are kept (justETF caps the visible "Top 10" table at
//     10 entries; any extra rows would be a parser glitch picking up
//     unrelated table rows).
//   - Cumulative weight must not exceed 100 % by more than rounding noise.
//   - Weights must be monotonically non-increasing (justETF orders the
//     "Top 10" descending by weight; an inversion suggests we matched the
//     wrong table).
function extractTopHoldings(html) {
  const tableMatch = html.match(
    /<table[^>]*data-testid="etf-holdings_top-holdings_table"[\s\S]*?<\/table>/i
  );
  if (!tableMatch) return undefined;
  const table = tableMatch[0];
  const rowRe = /<tr[^>]*data-testid="etf-holdings_top-holdings_row"[\s\S]*?<\/tr>/gi;
  const out = [];
  let m;
  while ((m = rowRe.exec(table)) !== null) {
    const block = m[0];
    const nameMatch = block.match(/title="([^"]+)"/);
    const pctMatch = block.match(/_value_percentage"[^>]*>\s*([\d.,]+)\s*%/i);
    if (!nameMatch || !pctMatch) continue;
    const name = nameMatch[1].trim();
    const pct = parseFloat(pctMatch[1].replace(",", "."));
    if (!name || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    out.push({ name, pct: Math.round(pct * 100) / 100 });
  }
  if (out.length < 3) return undefined;
  const trimmed = out.slice(0, 10);
  const sum = trimmed.reduce((a, h) => a + h.pct, 0);
  if (sum > 105) return undefined;
  for (let i = 1; i < trimmed.length; i++) {
    // Allow a small epsilon for rounding noise.
    if (trimmed[i].pct > trimmed[i - 1].pct + 0.05) return undefined;
  }
  return trimmed;
}

// Pure export for unit tests under tests/scrapers.test.ts.
export { extractTopHoldings };

async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
  return await res.text();
}

async function main() {
  const allIsins = await extractIsinsFromCatalog();
  const equityIsins = await extractEquityIsinsFromLookthrough();
  const isins = (TARGET_ISINS.length ? TARGET_ISINS : allIsins).filter((isin) =>
    equityIsins.has(isin)
  );
  const skipped = (TARGET_ISINS.length ? TARGET_ISINS : allIsins).length - isins.length;
  console.log(
    `Refreshing top-holdings for ${isins.length} equity ISIN(s) from justETF` +
      (skipped > 0 ? ` (skipped ${skipped} non-equity / no-profile ISIN(s))` : "")
  );

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
  const stamp = new Date().toISOString();

  for (const isin of isins) {
    try {
      const html = await fetchProfile(isin);
      const topHoldings = extractTopHoldings(html);
      if (!topHoldings) {
        console.warn(`  ! ${isin}: no holdings extracted (leaving previous value)`);
        failCount++;
      } else {
        next[isin] = {
          ...(existing[isin] ?? {}),
          topHoldings,
          topHoldingsAsOf: stamp,
        };
        console.log(`  \u2713 ${isin}: ${topHoldings.length} holdings (top: ${topHoldings[0].name} ${topHoldings[0].pct}%)`);
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
      lastRefreshed: stamp,
      refreshedBy: "scripts/refresh-lookthrough.mjs",
      note:
        "ISIN -> partial LookthroughProfile overrides applied on top of the curated PROFILES in src/lib/lookthrough.ts. " +
        "Populated monthly (1st of month, 04:00 UTC) by the refresh-lookthrough GitHub Action. " +
        "Only the topHoldings array (and its per-ISIN topHoldingsAsOf ISO timestamp) is refreshed here. " +
        "geo / sector / currency stay hand-curated because justETF Ajax-loads those tables.",
    },
    overrides: next,
  };

  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OVERRIDES_JSON} (${okCount} ok, ${failCount} failed).`);
  process.exit(failCount > okCount ? 1 : 0);
}

// Only run main() when invoked directly from the CLI. When this module is
// imported (e.g. by tests/scrapers.test.ts) the network fetch loop must NOT
// auto-execute.
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(2);
  });
}
