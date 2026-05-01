#!/usr/bin/env node
// ----------------------------------------------------------------------------
// scrape-popular-etfs-pool.mjs
// ----------------------------------------------------------------------------
// Companion to scrape-popular-etfs-instruments.mjs + inject-popular-etfs.mjs.
//
// For each newly-injected orphan ISIN (read from
// scripts/data/popular-etfs-staged.json), fetches the same look-through
// reference data as the monthly refresh-lookthrough.mjs (top-10 holdings,
// country + sector breakdowns, derived currency) and writes the result
// into src/data/lookthrough.overrides.json under `pool[isin]`.
//
// This is what makes the orphan instruments useful on day one: without a
// pool entry, an orphan ISIN typed in the Explain manual-entry flow
// would resolve to the InstrumentRecord (so name/TER/exchange render),
// but its Methodology look-through would have to fall back to the ETF
// header's base currency only — no per-stock geo/sector exposure. With
// a pool entry, the same ISIN gets the full look-through treatment from
// the very first user interaction, and the regular monthly cron job
// (refresh-lookthrough.mjs) keeps it fresh thereafter.
//
// Pool entry shape (matches what the admin /api/admin/lookthrough-pool
// endpoint writes for a manually-added ISIN):
//   {
//     name, topHoldings, topHoldingsAsOf,
//     geo, sector, currency, breakdownsAsOf,
//     _source, _addedAt, _addedVia,
//   }
//
// Resumable: writes overrides.json after every ISIN, so re-running after
// a SIGTERM picks up only the ISINs that don't already have a complete
// pool entry. ISINs whose existing pool entry is missing topHoldings,
// geo, or sector are re-attempted; complete entries are skipped.
//
// Politeness: 1.5 s between ISINs, 750 ms between sub-requests within
// the same ISIN — identical to refresh-lookthrough.mjs.
//
// Usage (from artifacts/investment-lab):
//   node scripts/scrape-popular-etfs-pool.mjs
//   DRY_RUN=1 node scripts/scrape-popular-etfs-pool.mjs   # don't write
//   LIMIT=40 node scripts/scrape-popular-etfs-pool.mjs    # process at most N
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  extractTopHoldings,
  extractBreakdown,
  extractEtfName,
  hasLoadMoreLink,
  fetchLookthroughProfile,
  fetchBreakdownAjax,
  deriveCurrencyFromGeo,
  HEDGED_ISINS,
  LOOKTHROUGH_REQUEST_DELAY_MS,
  LOOKTHROUGH_BREAKDOWN_DELAY_MS,
} from "./refresh-lookthrough.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STAGED_JSON = resolve(__dirname, "data/popular-etfs-staged.json");
const OVERRIDES_JSON = resolve(ROOT, "src/data/lookthrough.overrides.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isComplete(entry) {
  // An entry is "good enough to skip on resume" when it has the minimum
  // look-through inputs the engine consumes: geo + sector breakdowns.
  // topHoldings is a nice-to-have preview list (justETF only publishes
  // it for equity ETFs), so bond / commodity / synthetic ETFs that
  // expose a holdings-less but valid geo+sector shape are still
  // considered complete.
  return Boolean(
    entry &&
      entry.geo &&
      typeof entry.geo === "object" &&
      Object.keys(entry.geo).length > 0 &&
      entry.sector &&
      typeof entry.sector === "object" &&
      Object.keys(entry.sector).length > 0
  );
}

async function loadOverrides() {
  const text = await readFile(OVERRIDES_JSON, "utf8");
  return JSON.parse(text);
}

async function persistOverrides(payload) {
  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function scrapeOne(isin) {
  // --- Profile + top holdings + name + session cookie ---
  const { html, cookie } = await fetchLookthroughProfile(isin);
  const topHoldings = extractTopHoldings(html);
  const name = extractEtfName(html);

  // --- Sectors breakdown (static if complete; Ajax if "Show more") ---
  let sector;
  if (!hasLoadMoreLink(html, "sectors")) {
    sector = extractBreakdown(html, "sectors");
  } else if (cookie) {
    await sleep(LOOKTHROUGH_BREAKDOWN_DELAY_MS);
    try {
      const xml = await fetchBreakdownAjax(isin, "sectors", cookie);
      sector = extractBreakdown(xml, "sectors");
    } catch {
      sector = undefined;
    }
  }

  // --- Countries breakdown (static if complete; Ajax if "Show more") ---
  let geo;
  if (!hasLoadMoreLink(html, "countries")) {
    geo = extractBreakdown(html, "countries");
  } else if (cookie) {
    await sleep(LOOKTHROUGH_BREAKDOWN_DELAY_MS);
    try {
      const xml = await fetchBreakdownAjax(isin, "countries", cookie);
      geo = extractBreakdown(xml, "countries");
    } catch {
      geo = undefined;
    }
  }

  // --- Derived currency (skipped for hedged share classes) ---
  let currency;
  if (geo && !HEDGED_ISINS.has(isin)) {
    currency = deriveCurrencyFromGeo(geo);
  }

  return { name, topHoldings, geo, sector, currency };
}

// Categories whose ETFs are fixed-income (bond/money-market). Anything
// matching this regex gets isEquity:false on the pool entry so the
// runtime merge in src/lib/lookthrough.ts routes it to the bond geo
// path in analyzeLookthrough() instead of polluting equity geo/sector
// cards. Everything else (broad/regional/sector/factor/REIT/commodity
// equity proxy) defaults to isEquity:true.
const FIXED_INCOME_CATEGORY_RE =
  /^(corp bonds|govt bonds|em bonds|us aggregate bond|inflation-linked|money market|fallen angels)/i;

function isFixedIncomeCategory(category) {
  if (!category || typeof category !== "string") return false;
  return FIXED_INCOME_CATEGORY_RE.test(category.trim());
}

function buildPoolEntry(isin, scraped, seedCategory) {
  const stamp = new Date().toISOString();
  // Minimum for a writable entry: a valid geo + sector breakdown. These
  // are what the look-through engine actually consumes. topHoldings is
  // a nice-to-have preview only published by justETF for equity ETFs;
  // bond / commodity / swap ETFs skip the holdings list but still
  // produce useful breakdowns. (See isComplete() above for the matching
  // resume-skip predicate, and src/lib/lookthrough.ts ~L596 for the
  // matching reader-side gate.)
  if (
    !scraped.geo ||
    Object.keys(scraped.geo).length === 0 ||
    !scraped.sector ||
    Object.keys(scraped.sector).length === 0
  ) {
    return null;
  }
  const entry = {
    name: scraped.name || isin,
    geo: scraped.geo,
    sector: scraped.sector,
    breakdownsAsOf: stamp,
    _source: "justetf",
    _addedAt: stamp,
    _addedVia: "scrape-popular-etfs-pool",
  };
  if (isFixedIncomeCategory(seedCategory)) {
    entry.isEquity = false;
  }
  if (Array.isArray(scraped.topHoldings) && scraped.topHoldings.length >= 3) {
    entry.topHoldings = scraped.topHoldings;
    entry.topHoldingsAsOf = stamp;
  }
  if (scraped.currency) entry.currency = scraped.currency;
  return entry;
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

  const staged = JSON.parse(await readFile(STAGED_JSON, "utf8"));
  const stagedIsins = (staged.instruments || []).map((r) => r.isin);
  // _seedCategory was preserved on each staged instrument by the
  // enrichment script — we use it here only to derive isEquity. ISIN
  // not in staged or staged without a category falls back to undefined,
  // which means buildPoolEntry leaves isEquity unset (defaults to true
  // at runtime — backward-compatible).
  const seedCategoryByIsin = new Map(
    (staged.instruments || []).map((r) => [r.isin, r._seedCategory]),
  );
  console.log(
    `\n=== scrape-popular-etfs-pool — ${stagedIsins.length} staged ISIN(s) ===\n`
  );

  const overrides = await loadOverrides();
  const pool = overrides.pool || {};

  // Filter: skip ISINs whose pool entry is already complete from a prior
  // run (or pre-existing curated entry). Only re-attempt ISINs missing
  // any of topHoldings/geo/sector.
  let alreadyComplete = 0;
  const todo = [];
  for (const isin of stagedIsins) {
    if (isComplete(pool[isin])) {
      alreadyComplete++;
      continue;
    }
    todo.push(isin);
    if (todo.length >= limit) break;
  }
  console.log(
    `  filter: ${alreadyComplete} already-complete · ${todo.length} to scrape\n`
  );
  if (Number.isFinite(limit)) {
    console.log(`  LIMIT=${limit} — capping this run\n`);
  }

  let okCount = 0;
  let partial = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const isin = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${isin} ... `);
    try {
      const scraped = await scrapeOne(isin);
      const entry = buildPoolEntry(isin, scraped, seedCategoryByIsin.get(isin));
      if (!entry) {
        const missing = [];
        if (!scraped.topHoldings || scraped.topHoldings.length < 3) missing.push("topHoldings");
        if (!scraped.geo) missing.push("geo");
        if (!scraped.sector) missing.push("sector");
        process.stdout.write(`PARTIAL (missing: ${missing.join(", ")})\n`);
        partial++;
      } else {
        pool[isin] = entry;
        const topPart = entry.topHoldings ? `top:${entry.topHoldings.length} ` : "";
        process.stdout.write(
          `OK (${topPart}geo:${Object.keys(entry.geo).length} sector:${Object.keys(entry.sector).length}` +
            (entry.currency ? ` ccy:${Object.keys(entry.currency).length}` : "") +
            `)\n`
        );
        okCount++;
        if (!dryRun) {
          // Persist after every successful ISIN so a SIGTERM mid-batch
          // loses at most one ISIN of work. _meta.lastRefreshed is bumped
          // on each persist so the freshness indicator in the UI stays
          // accurate.
          overrides.pool = pool;
          overrides._meta = {
            ...(overrides._meta || {}),
            lastRefreshed: new Date().toISOString(),
          };
          try {
            await persistOverrides(overrides);
          } catch (e) {
            console.error(`  ! persist-error: ${e?.message || e}`);
          }
        }
      }
    } catch (e) {
      process.stdout.write(`FAIL (${e?.message || e})\n`);
      failed++;
    }
    if (i < todo.length - 1) await sleep(LOOKTHROUGH_REQUEST_DELAY_MS);
  }

  console.log(
    `\n  ok: ${okCount}   partial: ${partial}   failed: ${failed}   already-complete: ${alreadyComplete}\n`
  );
  if (dryRun) {
    console.log("  DRY_RUN=1 — not writing overrides file.");
    return;
  }
  console.log(`  pool size now: ${Object.keys(pool).length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
