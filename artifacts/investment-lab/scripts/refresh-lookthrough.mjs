#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-lookthrough.mjs
// ----------------------------------------------------------------------------
// Pulls per-ISIN look-through reference data from justETF and writes the
// result into src/data/lookthrough.overrides.json. The merge layer in
// src/lib/lookthrough.ts shallow-merges those values on top of the curated
// PROFILES so the engine keeps working with no live network call at runtime.
//
// Three reference data sets are refreshed here:
//   1. `topHoldings` — the top-10 stocks list parsed from the static
//      profile HTML (etf-holdings_top-holdings_table). Per-ISIN as-of stamp:
//      `topHoldingsAsOf`.
//   2. `geo` and `sector` — the country and sector breakdown maps. The
//      static profile HTML often ships only the top-4 + "Other" bucket of
//      these tables and renders a "Show more" link; when the link is
//      present we replay the same Wicket Ajax POST the browser would
//      (`holdingsSection-{countries|sectors}-loadMore{Countries|Sectors}`)
//      with the session cookie captured from the initial GET, and parse
//      the full `<table data-testid="...">` payload. When the link is
//      absent (thematic / single-sector ETFs) the static table already
//      contains every row, so we use it directly and skip the Ajax POST.
//      Per-ISIN as-of stamp: `breakdownsAsOf`.
//   3. `currency` — DERIVED from the just-refreshed `geo` map by re-
//      bucketing each country into its local listing currency
//      (COUNTRY_TO_CURRENCY below; eurozone members → EUR, etc.).
//      justETF doesn't publish a per-ETF currency breakdown table — only
//      a single fund-base currency in the summary header — so this is
//      the cleanest auto-refreshable approximation. Skipped (and the
//      curated value left in place) for currency-hedged share classes
//      in HEDGED_ISINS, where the post-hedging FX exposure is the
//      share-class hedge currency rather than the underlying country
//      mix. Shares the `breakdownsAsOf` stamp with geo and sector.
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-lookthrough.mjs                 # refresh all ISINs
//   node scripts/refresh-lookthrough.mjs IE00B5BMR087    # refresh one ISIN
//   DRY_RUN=1 node scripts/refresh-lookthrough.mjs       # don't write JSON
//
// Politeness: 750 ms between Ajax follow-ups within the same ISIN, 1.5 s
// between ISINs. Aborts cleanly if more than half of either the
// top-holdings or the breakdowns fail to parse, instead of writing junk.
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { appendRunLogEntry } from "./lib/run-log.mjs";
import { computeFieldChanges, appendChangeEntries } from "./lib/diff-overrides.mjs";
import { fetchWithRetry } from "./lib/justetf-extract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const LOOKTHROUGH_TS = resolve(ROOT, "src/lib/lookthrough.ts");
const OVERRIDES_JSON = resolve(ROOT, "src/data/lookthrough.overrides.json");
const RUN_LOG_MD = resolve(ROOT, "src/data/refresh-runs.log.md");
const CHANGES_LOG = resolve(ROOT, "src/data/refresh-changes.log.jsonl");
// Per-ISIN fields that are timestamps refreshed on every successful run by
// design. Excluded from the change-log diff so the admin pane's "Recent
// data changes" panel only surfaces real content shifts (a new top
// holding, a TER cut), not stamp updates that happen on every cron tick.
const STAMP_FIELDS = new Set(["topHoldingsAsOf", "breakdownsAsOf"]);
const REQUEST_DELAY_MS = 1500;
const BREAKDOWN_DELAY_MS = 750;
const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

// Wicket Ajax sub-resource names for the two breakdown tables. The page's
// "Show more" link on each table fires an Ajax POST to these URLs which
// returns the FULL table (not the static-HTML top-4 + Other preview).
const BREAKDOWN_AJAX_PATHS = {
  countries: "holdingsSection-countries-loadMoreCountries",
  sectors: "holdingsSection-sectors-loadMoreSectors",
};

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

// Pure parser: given the text of src/lib/lookthrough.ts, return the Set of
// ISINs whose PROFILES entry has `isEquity: true`. Split out from the
// filesystem-reading wrapper so tests can feed it a fixture string directly
// (see tests/scrapers.test.ts) — keeping it side-effect-free is what makes
// the equity-only filter test loud-failing if the PROFILES literal shape
// ever changes.
function parseEquityIsinsFromLookthroughSource(src) {
  const equity = new Set();
  // Match each PROFILES entry: "ISIN": { isEquity: true | false, ... }
  const re = /"([A-Z]{2}[A-Z0-9]{9}\d)"\s*:\s*\{\s*isEquity:\s*(true|false)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === "true") equity.add(m[1]);
  }
  return equity;
}

// Pure parser: given the text of src/lib/lookthrough.ts, return the Set of
// ALL ISIN keys in PROFILES (equity + non-equity). Used to detect orphan
// overrides — entries in lookthrough.overrides.json whose ISIN no longer
// has a curated profile to merge onto, so the merge layer in
// src/lib/lookthrough.ts silently skips them. We still keep writing for
// these every month if they linger in the JSON file, which is exactly the
// silent drift this warning surfaces. Same shape regex as the equity
// parser above so future PROFILES literal-shape refactors trip both
// loud-failing tests at once.
function parseAllProfileIsinsFromLookthroughSource(src) {
  const all = new Set();
  const re = /"([A-Z]{2}[A-Z0-9]{9}\d)"\s*:\s*\{\s*isEquity:\s*(?:true|false)/g;
  let m;
  while ((m = re.exec(src)) !== null) all.add(m[1]);
  return all;
}

// Note: the equity-only filter (skipping non-equity ISINs whose top-holdings
// list either does not apply — gold ETC — or is uninformative for an
// equity-style display — broad-market crypto basket with daily-shifting
// weights) is now applied in main() directly via
// parseEquityIsinsFromLookthroughSource(), since main() already needs the
// raw lookthrough.ts source to also extract the full PROFILES set for the
// orphan-override check below.

// ---------------------------------------------------------------------------
// Task #122 (T005) — INSTRUMENTS-as-allowlist guards.
//
// After unification, every ISIN in lookthrough.overrides.json (`overrides`
// or `pool`) MUST also be a registered instrument in src/lib/etfs.ts. The
// monthly refresh job is the second-most-likely vector for zombie entries
// to creep back in (the most-likely is the admin "+ Alternative" flow,
// addressed by T004's multi-file PR). Two pure helpers, exported so the
// orphan unit test can exercise them without the network loop:
//
//   • validateExplicitTargets — explicit-arg run: refuse any CLI ISIN
//     that isn't in INSTRUMENTS. Returns the list of offending ISINs;
//     main() exits 1 if non-empty.
//   • pruneNonInstrumentsKeys — full-refresh run: silently drop any
//     pre-existing JSON key that no longer matches INSTRUMENTS. Logged
//     but never preserved through write — the admin pane / picker is
//     the operator's UI for re-adding a removed instrument.
// ---------------------------------------------------------------------------
export function validateExplicitTargets(targets, instrumentSet) {
  return targets.filter((isin) => !instrumentSet.has(isin));
}

export function pruneNonInstrumentsKeys(map, instrumentSet) {
  const kept = {};
  const orphans = [];
  for (const [isin, value] of Object.entries(map ?? {})) {
    if (instrumentSet.has(isin)) kept[isin] = value;
    else orphans.push(isin);
  }
  return { kept, orphans };
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
// Holding names from justETF arrive HTML-entity encoded inside the
// `title="..."` attribute (e.g. "Johnson &amp; Johnson", "L&#39;Oreal",
// "Berkshire Hathaway &#x2014; Class B"). Decode the small set of named +
// numeric entities the scraped attribute can realistically contain so the
// snapshot JSON stores human-readable strings — otherwise the UI panel
// renders raw "&amp;" artefacts.
function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Offizieller ETF-Name vom justETF-Profilkopf. Stabiles Selektor-Pattern:
// <h1 data-testid="etf-profile-header_etf-name">…</h1>. Fallback auf
// <title> ("<Name> | <WKN> | <ISIN>"). Wird in jedem Lauf neu geschrieben,
// auch für bereits vorhandene Pool-Einträge — backfillt damit Einträge
// die vor Einführung des Name-Felds (2026-04-27) gescraped wurden.
function extractEtfName(html) {
  const h1 = html.match(
    /<h1[^>]*data-testid="etf-profile-header_etf-name"[^>]*>([\s\S]*?)<\/h1>/i
  );
  if (h1) {
    const text = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, "")).trim();
    if (text) return text;
  }
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    const text = decodeHtmlEntities(title[1]).trim();
    const name = text.split(" | ")[0]?.trim();
    if (name && name.length > 3 && !/justetf/i.test(name)) return name;
  }
  return undefined;
}

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
    const name = decodeHtmlEntities(nameMatch[1]).trim();
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

// Country / sector breakdown: parses the
// `<table data-testid="etf-holdings_${kind}_table">` block. The same parser
// works on either the static profile HTML (top 4 + "Other" preview) or the
// Wicket Ajax response (full table — the response wraps the same <table>
// inside a `<![CDATA[…]]>` component, but a regex match against the table
// markup itself is identical).
//
// Returns an ExposureMap (Record<name, pct>) on success, or undefined if
// the payload is missing the table, has fewer than 2 valid rows, or sums
// outside 95–105 % of 100. justETF normalises every breakdown table to
// 100 % via an "Other" bucket, so a sum well outside that band almost
// certainly means we matched the wrong table or the markup changed.
function extractBreakdown(payload, kind) {
  if (typeof payload !== "string" || !payload) return undefined;
  if (kind !== "countries" && kind !== "sectors") return undefined;
  const tableRe = new RegExp(
    '<table[^>]*data-testid="etf-holdings_' + kind + '_table"[\\s\\S]*?<\\/table>',
    "i"
  );
  const tableMatch = payload.match(tableRe);
  if (!tableMatch) return undefined;
  const table = tableMatch[0];
  const rowRe = new RegExp(
    '<tr[^>]*data-testid="etf-holdings_' + kind + '_row"[\\s\\S]*?<\\/tr>',
    "gi"
  );
  const out = {};
  let sum = 0;
  let m;
  while ((m = rowRe.exec(table)) !== null) {
    const block = m[0];
    const nameMatch = block.match(/_value_name"[^>]*>\s*([^<]+?)\s*</i);
    const pctMatch = block.match(/_value_percentage"[^>]*>\s*([\d.,]+)\s*%/i);
    if (!nameMatch || !pctMatch) continue;
    const name = decodeHtmlEntities(nameMatch[1]).trim();
    const pct = parseFloat(pctMatch[1].replace(",", "."));
    if (!name || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    if (out[name] !== undefined) continue; // dedupe defensively
    out[name] = Math.round(pct * 100) / 100;
    sum += pct;
  }
  // Allow single-row 100% breakdowns (e.g. a single-sector or
  // single-country thematic ETF where every holding maps to one bucket).
  // The sum guard below still catches malformed / empty payloads.
  if (Object.keys(out).length < 1) return undefined;
  if (sum < 95 || sum > 105) return undefined;
  return out;
}

// Pure exports for unit tests under tests/scrapers.test.ts.
export {
  extractTopHoldings,
  extractBreakdown,
  extractEtfName,
  hasLoadMoreLink,
  parseEquityIsinsFromLookthroughSource,
  parseAllProfileIsinsFromLookthroughSource,
};
// Network helpers + constants re-used by the orphan pool-fill script
// (scripts/scrape-popular-etfs-pool.mjs). Kept side-effect-free at module
// scope: importing this file does NOT trigger the CLI loop (`isCli`
// guard at the bottom).
export {
  fetchProfile as fetchLookthroughProfile,
  fetchBreakdownAjax,
  captureCookies,
  USER_AGENT as LOOKTHROUGH_USER_AGENT,
  BREAKDOWN_AJAX_PATHS,
  REQUEST_DELAY_MS as LOOKTHROUGH_REQUEST_DELAY_MS,
  BREAKDOWN_DELAY_MS as LOOKTHROUGH_BREAKDOWN_DELAY_MS,
};
// Note: deriveCurrencyFromGeo / COUNTRY_TO_CURRENCY / HEDGED_ISINS are
// re-exported below — once they're declared.

// Country → currency mapping used to derive the per-ISIN `currency`
// breakdown from the (auto-refreshed) `geo` breakdown. justETF does NOT
// publish a per-ETF currency table directly — only the fund's base
// currency in the profile header — so for unhedged equity ETFs we
// approximate currency exposure by re-bucketing the country exposure via
// each country's local listing currency. This is the same approximation
// the look-through engine in src/lib/lookthrough.ts already applies when
// it doesn't have a hand-curated currency map.
//
// Limitations baked into the methodology copy: (1) multinationals listed
// in country X may earn in other currencies, (2) currency-hedged share
// classes override this entirely (those ISINs are in HEDGED_ISINS in
// src/lib/lookthrough.ts and we deliberately skip the derivation for
// them — see deriveCurrencyFromGeo below). Unmapped countries fall into
// the "Other" bucket.
const COUNTRY_TO_CURRENCY = {
  "United States": "USD",
  "United Kingdom": "GBP",
  Switzerland: "CHF",
  Japan: "JPY",
  Canada: "CAD",
  Australia: "AUD",
  China: "CNY",
  "Hong Kong": "HKD",
  Taiwan: "TWD",
  "South Korea": "KRW",
  India: "INR",
  Singapore: "SGD",
  Sweden: "SEK",
  Denmark: "DKK",
  Norway: "NOK",
  Brazil: "BRL",
  "South Africa": "ZAR",
  Mexico: "MXN",
  Israel: "ILS",
  "Saudi Arabia": "SAR",
  "United Arab Emirates": "AED",
  Thailand: "THB",
  Indonesia: "IDR",
  Malaysia: "MYR",
  Poland: "PLN",
  // Eurozone members
  Germany: "EUR",
  France: "EUR",
  Italy: "EUR",
  Spain: "EUR",
  Netherlands: "EUR",
  Belgium: "EUR",
  Ireland: "EUR",
  Finland: "EUR",
  Portugal: "EUR",
  Austria: "EUR",
  Greece: "EUR",
  Luxembourg: "EUR",
  // justETF's normalising bucket — pass through.
  Other: "Other",
};

// ISINs whose currency exposure equals the share-class hedge currency
// rather than the underlying country mix. Mirrors HEDGED_ISINS in
// src/lib/lookthrough.ts. For these ISINs we deliberately do NOT write a
// derived currency map — the curated entry stays authoritative.
const HEDGED_ISINS = new Set([
  "IE00BCRY6557",
  "IE00BYX5MS15",
  "IE00B3ZW0K18",
  "IE00BDBRDM35",
  "IE00BDBRDN42",
  "IE00BDBRDP65",
]);

// Re-buckets a country breakdown into a currency breakdown using the
// country → currency map above. Returns undefined when the input is
// missing, when more than 5 percentage-points of weight fall into
// unmapped countries (a signal we should refresh COUNTRY_TO_CURRENCY
// rather than silently bucket the unknowns into "Other"), or when the
// resulting map sums outside 95–105 % of 100.
export { deriveCurrencyFromGeo, COUNTRY_TO_CURRENCY, HEDGED_ISINS };
function deriveCurrencyFromGeo(geo) {
  if (!geo || typeof geo !== "object") return undefined;
  const out = {};
  let unmapped = 0;
  for (const [country, pct] of Object.entries(geo)) {
    if (!Number.isFinite(pct) || pct <= 0) continue;
    const ccy = COUNTRY_TO_CURRENCY[country];
    if (!ccy) {
      unmapped += pct;
      continue;
    }
    out[ccy] = Math.round(((out[ccy] ?? 0) + pct) * 100) / 100;
  }
  if (unmapped > 5) return undefined;
  if (unmapped > 0) {
    out.Other = Math.round(((out.Other ?? 0) + unmapped) * 100) / 100;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum < 95 || sum > 105) return undefined;
  return out;
}

// True when the static profile HTML rendered a "Show more" link beneath
// the given breakdown table — i.e. there are hidden rows that require the
// Wicket Ajax loadMore POST to retrieve. Absent for thematic / single-
// sector ETFs whose static table already lists every row.
function hasLoadMoreLink(html, kind) {
  if (typeof html !== "string") return false;
  const re = new RegExp(`data-testid="etf-holdings_${kind}_load-more_link"`);
  return re.test(html);
}

// Capture Set-Cookie values from a fetch response and return a single
// `Cookie` header value. justETF's load-balancer (AWSALB / AWSALBCORS)
// requires session affinity for the Wicket Ajax POSTs to land on the
// backend that actually has the page state — hitting the URL without the
// cookie 301-redirects to the unauthenticated landing page.
function captureCookies(res) {
  const all = res.headers.getSetCookie?.() ?? [];
  return all.map((line) => line.split(";")[0]).join("; ");
}

async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } },
    {
      onRetry: ({ attempt, retries, waitMs, error }) =>
        console.warn(
          `  ! ${isin}: profile fetch attempt ${attempt}/${retries} failed (${error?.message ?? "unknown"}), retrying in ${Math.round(waitMs / 100) / 10}s`
        ),
    }
  );
  const cookie = captureCookies(res);
  const html = await res.text();
  return { html, cookie };
}

async function fetchBreakdownAjax(isin, kind, cookie) {
  const path = BREAKDOWN_AJAX_PATHS[kind];
  if (!path) throw new Error(`unknown breakdown kind: ${kind}`);
  const url =
    `https://www.justetf.com/en/etf-profile.html?0-1.0-${path}` +
    `&isin=${isin}&_wicket=1`;
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en",
    "Wicket-Ajax": "true",
    "Wicket-Ajax-BaseURL": `en/etf-profile.html?isin=${isin}`,
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/xml, text/xml, */*; q=0.01",
    Referer: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetchWithRetry(
    url,
    { method: "POST", headers },
    {
      onRetry: ({ attempt, retries, waitMs, error }) =>
        console.warn(
          `  ! ${isin}: ${kind} Ajax attempt ${attempt}/${retries} failed (${error?.message ?? "unknown"}), retrying in ${Math.round(waitMs / 100) / 10}s`
        ),
    }
  );
  return await res.text();
}

async function main() {
  const startedAt = new Date().toISOString();
  const allIsins = await extractIsinsFromCatalog();
  const lookthroughSrc = await readFile(LOOKTHROUGH_TS, "utf8");
  const equityIsins = parseEquityIsinsFromLookthroughSource(lookthroughSrc);
  const allProfileIsins = parseAllProfileIsinsFromLookthroughSource(lookthroughSrc);

  // Pool ISINs are added bucket-agnostically via the admin "Look-through
  // data pool" UI. They live under `pool[isin]` in the same JSON file but
  // are NOT in PROFILES (they're folded in at runtime by lookthrough.ts).
  // On a full refresh (no CLI args) we include them so they get the same
  // monthly justETF re-scrape as the curated catalog. On an explicit-arg
  // run we behave exactly as today; the operator selects what to refresh.
  let existing = {};
  let existingPool = {};
  try {
    const raw = JSON.parse(await readFile(OVERRIDES_JSON, "utf8"));
    existing = raw.overrides ?? {};
    existingPool = raw.pool ?? {};
  } catch {
    // first run — leave both empty
  }

  // Task #122 (T005) — INSTRUMENTS-as-allowlist guards:
  //   1. Explicit-arg run: refuse any CLI ISIN that has no INSTRUMENTS
  //      row. Such an ISIN cannot reach the picker even if the scrape
  //      succeeds (the picker filters on INSTRUMENTS), so writing for
  //      it would just re-create a zombie. Exit 1 with the offending
  //      list so the operator sees it in the GitHub Action output.
  //   2. Full-refresh run: prune any pre-existing pool/override entry
  //      whose ISIN no longer matches INSTRUMENTS. The validator in
  //      etfs.ts will fail the build the moment such an entry lands,
  //      so the only sensible refresh-job behaviour is to drop them
  //      before write — never preserve them through.
  const instrumentSet = new Set(allIsins);
  if (TARGET_ISINS.length) {
    const offending = validateExplicitTargets(TARGET_ISINS, instrumentSet);
    if (offending.length > 0) {
      console.error(
        `\nrefuse: ${offending.length} explicit ISIN(s) not registered in INSTRUMENTS — ` +
          `${offending.join(", ")}. ` +
          `Register them via the Instruments tab in /admin first, then re-run with the same args.\n`
      );
      process.exit(1);
    }
  }
  const prunedPool = pruneNonInstrumentsKeys(existingPool, instrumentSet);
  const prunedOverrides = pruneNonInstrumentsKeys(existing, instrumentSet);
  if (prunedPool.orphans.length > 0 || prunedOverrides.orphans.length > 0) {
    console.warn(
      `\n! pruning ${prunedPool.orphans.length} orphan pool entry/entries ` +
        `and ${prunedOverrides.orphans.length} orphan override entry/entries ` +
        `from lookthrough.overrides.json (no matching INSTRUMENTS row): ` +
        `pool=[${prunedPool.orphans.join(", ")}] ` +
        `overrides=[${prunedOverrides.orphans.join(", ")}]\n`
    );
  }
  existing = prunedOverrides.kept;
  existingPool = prunedPool.kept;

  const poolIsinSet = new Set(Object.keys(existingPool));
  const isPoolIsin = (isin) => poolIsinSet.has(isin);

  const requested = TARGET_ISINS.length ? TARGET_ISINS : allIsins;
  // Equity filter only applies to catalog ISINs; pool ISINs bypass it
  // (they were vetted at admin-add time and are assumed equity — see the
  // pool-merge note in lookthrough.ts).
  const equityFiltered = requested.filter((isin) => equityIsins.has(isin));
  const isins = TARGET_ISINS.length
    ? requested.filter((isin) => equityIsins.has(isin) || isPoolIsin(isin))
    : [...new Set([...equityFiltered, ...poolIsinSet])];
  const skipped = requested.length - equityFiltered.length;
  const poolCount = isins.filter(isPoolIsin).length;
  console.log(
    `Refreshing top-holdings for ${isins.length} equity ISIN(s) from justETF` +
      (poolCount > 0 ? ` (incl. ${poolCount} bucket-agnostic pool ISIN(s))` : "") +
      (skipped > 0 ? ` (skipped ${skipped} non-equity / no-profile ISIN(s))` : "")
  );

  // Detect orphan overrides up front: ISIN keys in the existing JSON file
  // (or about-to-be-written `next`, since `next = { ...existing }`) that
  // have no matching curated profile in PROFILES. The merge layer in
  // src/lib/lookthrough.ts silently skips these at runtime — we surface
  // the names here so the maintainer sees them in the monthly GitHub
  // Action's `Refresh top-holdings from justETF (monthly)` step output.
  // The merge layer also re-emits the same warning at module load time
  // (see lookthrough.ts) so the subsequent typecheck/test steps and the
  // dev server boot also flag it; this duplication is intentional —
  // surfacing it in the refresh step itself means the maintainer doesn't
  // have to scroll past test output to find it.
  const orphanOverrideIsins = Object.keys(existing).filter(
    (isin) => !allProfileIsins.has(isin)
  );
  if (orphanOverrideIsins.length > 0) {
    console.warn(
      `\n! ${orphanOverrideIsins.length} override ISIN(s) in lookthrough.overrides.json have no matching curated profile in src/lib/lookthrough.ts — ` +
        `their refreshed holdings/breakdowns will never reach the UI: ${orphanOverrideIsins.join(", ")}. ` +
        `If a curated ISIN was renamed or removed, either restore the PROFILES entry or delete the orphan override from the JSON file.\n`
    );
  }

  const next = { ...existing };
  const nextPool = { ...existingPool };
  // Helper: route per-ISIN reads/writes to the correct map. Pool ISINs
  // were tagged at the top of main(); everything else is a regular
  // override.
  const tableFor = (isin) => (isPoolIsin(isin) ? nextPool : next);
  const existingFor = (isin) => (isPoolIsin(isin) ? existingPool : existing);
  let topOk = 0;
  let topFail = 0;
  let breakdownsOk = 0;
  let breakdownsFail = 0;
  const stamp = new Date().toISOString();
  // Per-ISIN diff entries collected during the loop and flushed AFTER the
  // override JSON is successfully written. Stamp fields (topHoldingsAsOf,
  // breakdownsAsOf) are excluded so the admin "Recent data changes" panel
  // only surfaces real content shifts.
  const pendingChanges = [];

  for (const isin of isins) {
    // Snapshot of this ISIN's previous override-entry, taken before any of
    // the in-loop mutations. Reads from the pool map for pool ISINs, the
    // overrides map otherwise (existingFor handles the routing).
    const beforeEntry = existingFor(isin)[isin];
    const targetMap = tableFor(isin);
    let cookie = "";
    let html;

    // ---- 1) Profile page: top-10 holdings (and capture session cookie) ----
    try {
      const profile = await fetchProfile(isin);
      cookie = profile.cookie;
      html = profile.html;
      const topHoldings = extractTopHoldings(html);
      // Offiziellen ETF-Namen vom Profilkopf mitnehmen. Nur für Pool-
      // Einträge persistieren — overrides-only-Einträge sind Katalog-ETFs
      // (etfs.ts), dort liefert das Frontend den Namen direkt aus dem
      // Katalog. Bei Pool-Einträgen ist der gescrapete Name die einzige
      // Identifikation in der Admin-Tabelle.
      const scrapedName = isPoolIsin(isin) ? extractEtfName(html) : undefined;
      if (!topHoldings) {
        console.warn(`  ! ${isin}: no top-holdings extracted (leaving previous value)`);
        topFail++;
      } else {
        targetMap[isin] = {
          ...(targetMap[isin] ?? {}),
          ...(scrapedName ? { name: scrapedName } : {}),
          topHoldings,
          topHoldingsAsOf: stamp,
        };
        console.log(`  \u2713 ${isin}: ${topHoldings.length} holdings (top: ${topHoldings[0].name} ${topHoldings[0].pct}%)`);
        topOk++;
      }
    } catch (e) {
      console.warn(`  ! ${isin}: profile fetch failed (${e.message})`);
      topFail++;
    }

    // ---- 2) Breakdowns: country + sector ----
    // For each table, parse the static HTML first (always present, but
    // truncated to top-4 + "Other" for broad ETFs). Only fall back to the
    // Wicket Ajax loadMore POST when the static page actually rendered
    // a "Show more" link for that table — i.e. there are hidden rows.
    // For thematic / single-sector ETFs the static table already contains
    // the full breakdown (e.g. "Technology 96.41% / Other 3.59%") and the
    // Ajax endpoint returns an empty no-op response, so probing it would
    // both waste a request and incorrectly look like a failure.
    let geo;
    let sector;
    // Tracks whether breakdown extraction was attempted at all for this
    // ISIN. False only when the profile fetch itself failed earlier (in
    // which case topFail is already counted; we don't double-count for
    // breakdowns). True for every other path — including "needed Ajax
    // but had no session cookie", which IS a breakdown failure (the
    // load-more link being present means the static table is just a
    // truncated top-4 preview, so falling back silently would be a
    // quality regression).
    let attemptedBreakdowns = false;
    if (html) {
      attemptedBreakdowns = true;
      const sectorsHasMore = hasLoadMoreLink(html, "sectors");
      const countriesHasMore = hasLoadMoreLink(html, "countries");

      // Sectors: if there's no "Show more" link the static table IS the full
      // breakdown — use it directly. If there IS a "Show more", the static
      // markup is just a top-4 + "Other" preview; Ajax MUST succeed or we
      // refuse to write anything (silently overwriting a curated full
      // breakdown with a degraded top-4 stub would be a quality regression).
      if (!sectorsHasMore) {
        sector = extractBreakdown(html, "sectors");
      } else if (cookie) {
        await sleep(BREAKDOWN_DELAY_MS);
        try {
          const sectorsXml = await fetchBreakdownAjax(isin, "sectors", cookie);
          sector = extractBreakdown(sectorsXml, "sectors");
          if (!sector) console.warn(`  ! ${isin}: sectors Ajax returned no parseable rows`);
        } catch (e) {
          console.warn(`  ! ${isin}: sectors Ajax fetch failed (${e.message})`);
        }
      } else {
        // Show-more link present but no session cookie was captured from
        // the profile GET — Ajax can't be attempted, so this is a real
        // breakdown failure (sector stays undefined, the outer guard
        // below routes to breakdownsFail++).
        console.warn(`  ! ${isin}: sectors needs Ajax but no session cookie was captured`);
      }

      // Countries: same pattern.
      if (!countriesHasMore) {
        geo = extractBreakdown(html, "countries");
      } else if (cookie) {
        await sleep(BREAKDOWN_DELAY_MS);
        try {
          const countriesXml = await fetchBreakdownAjax(isin, "countries", cookie);
          geo = extractBreakdown(countriesXml, "countries");
          if (!geo) console.warn(`  ! ${isin}: countries Ajax returned no parseable rows`);
        } catch (e) {
          console.warn(`  ! ${isin}: countries Ajax fetch failed (${e.message})`);
        }
      } else {
        console.warn(`  ! ${isin}: countries needs Ajax but no session cookie was captured`);
      }
    }

    if (geo && sector) {
      // Currency is derived from the (just-refreshed) country breakdown
      // via COUNTRY_TO_CURRENCY — see deriveCurrencyFromGeo above.
      // Skipped for currency-hedged share classes (HEDGED_ISINS), where
      // the curated hedge-currency map remains authoritative.
      let currency;
      if (HEDGED_ISINS.has(isin)) {
        console.log(`    ${isin}: hedged share class — leaving curated currency map untouched`);
      } else {
        currency = deriveCurrencyFromGeo(geo);
        if (!currency) {
          console.warn(
            `  ! ${isin}: currency derivation failed (>5 % unmapped countries) — leaving curated currency map untouched`
          );
        }
      }

      const patch = {
        ...(targetMap[isin] ?? {}),
        geo,
        sector,
        breakdownsAsOf: stamp,
      };
      if (currency) patch.currency = currency;
      targetMap[isin] = patch;

      console.log(
        `  \u2713 ${isin}: breakdowns refreshed ` +
          `(geo=${Object.keys(geo).length} entries, sector=${Object.keys(sector).length} entries` +
          (currency ? `, currency=${Object.keys(currency).length} entries derived` : ", currency=skipped") +
          `)`
      );
      breakdownsOk++;
    } else if (attemptedBreakdowns) {
      // The profile GET succeeded (so we tried) but at least one of the
      // two breakdown tables didn't parse — either Ajax failed, returned
      // no rows, or no session cookie was captured for a page that needs
      // it. Leave the existing override or curated default in place
      // rather than half-overwriting.
      console.warn(
        `  ! ${isin}: breakdowns extraction failed ` +
          `(geo=${geo ? "ok" : "missing"}, sector=${sector ? "ok" : "missing"}) — leaving previous value`
      );
      breakdownsFail++;
    } else {
      // Profile fetch already failed (no html captured). topFail is
      // already incremented above; not counting this against breakdowns
      // would double-penalise a single network error.
    }

    // Per-ISIN diff: only the fields that actually changed between the
    // pre-loop snapshot (beforeEntry) and the post-loop entry (next[isin]).
    // Stamp fields are filtered out so the admin pane doesn't show a row
    // for "topHoldingsAsOf changed" on every cron tick. The diff is
    // queued; flushed to disk only after the override JSON write succeeds.
    const afterEntry = targetMap[isin];
    if (afterEntry && afterEntry !== beforeEntry) {
      // Build a "patch-like" object containing only the fields the loop
      // actually wrote on this iteration. We recompute it from afterEntry
      // by selecting the keys we know the loop touches when successful.
      const patch = {};
      for (const k of ["topHoldings", "geo", "sector", "currency"]) {
        if (afterEntry[k] !== undefined && (!beforeEntry || afterEntry[k] !== beforeEntry[k])) {
          patch[k] = afterEntry[k];
        }
      }
      // Drop stamp fields defensively — they should never enter `patch`
      // here, but the guard makes the contract explicit for maintainers.
      for (const k of STAMP_FIELDS) delete patch[k];
      const fieldChanges = computeFieldChanges(beforeEntry, patch);
      if (fieldChanges.length > 0) {
        pendingChanges.push({ isin, changes: fieldChanges });
      }
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const okCount = topOk + breakdownsOk;
  const failCount = topFail + breakdownsFail;
  const halfFailed = topFail > topOk || breakdownsFail > breakdownsOk;

  if (process.env.DRY_RUN) {
    console.log(
      `\nDRY_RUN set — not writing override file. ` +
        `top-holdings: ${topOk} ok / ${topFail} fail · breakdowns: ${breakdownsOk} ok / ${breakdownsFail} fail`
    );
    await appendRunLogEntry(RUN_LOG_MD, {
      startedAt,
      script: "refresh-lookthrough",
      isinCount: isins.length,
      okCount,
      failCount,
      dryRun: true,
    });
    process.exit(halfFailed ? 1 : 0);
  }

  const payload = {
    _meta: {
      source: "justetf.com",
      lastRefreshed: stamp,
      refreshedBy: "scripts/refresh-lookthrough.mjs",
      note:
        "ISIN -> partial LookthroughProfile overrides applied on top of the curated PROFILES in src/lib/lookthrough.ts. " +
        "Populated monthly (1st of month, 04:00 UTC) by the refresh-lookthrough GitHub Action. " +
        "Refreshed fields: topHoldings (top-10 stocks, per-ISIN topHoldingsAsOf stamp), " +
        "geo / sector breakdown maps (per-ISIN breakdownsAsOf stamp, scraped from justETF — static profile HTML when complete, Wicket Ajax loadMore endpoint with a session cookie when justETF renders a 'Show more' link), " +
        "and currency (re-bucketed from the just-refreshed geo map via a country -> local-listing-currency table — justETF doesn't publish a per-ETF currency breakdown directly; skipped for currency-hedged share classes whose curated hedge-currency map remains authoritative). " +
        "The `pool` map holds bucket-agnostic look-through profiles added via the admin /api/admin/lookthrough-pool endpoint; the same monthly job re-scrapes them so admin-added ISINs stay fresh alongside the catalog.",
    },
    overrides: next,
    pool: nextPool,
  };

  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${OVERRIDES_JSON} ` +
      `(top-holdings: ${topOk} ok / ${topFail} fail · ` +
      `breakdowns: ${breakdownsOk} ok / ${breakdownsFail} fail).`
  );

  // Now that the override file is durably on disk, append the per-field
  // changes to refresh-changes.log.jsonl so the admin pane's "Recent ETF
  // updates" panel can show exactly what shifted in this run.
  if (pendingChanges.length > 0) {
    let totalLines = 0;
    for (const { isin, changes } of pendingChanges) {
      await appendChangeEntries(
        CHANGES_LOG,
        { timestamp: stamp, source: "lookthrough", isin },
        changes
      );
      totalLines += changes.length;
    }
    console.log(`Appended ${totalLines} change line(s) to refresh-changes.log.jsonl.`);
  }

  await appendRunLogEntry(RUN_LOG_MD, {
    startedAt,
    script: "refresh-lookthrough",
    isinCount: isins.length,
    okCount,
    failCount,
  });
  process.exit(halfFailed ? 1 : 0);
}

// Only run main() when invoked directly from the CLI. When this module is
// imported (e.g. by tests/scrapers.test.ts) the network fetch loop must NOT
// auto-execute.
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const fatalStartedAt = new Date().toISOString();
  main().catch(async (e) => {
    console.error("Fatal:", e);
    // Best-effort: record the fatal in the run log so a crashed scheduled
    // run still appears in the history. Swallow log-write errors so the
    // original failure surfaces unobscured.
    try {
      await appendRunLogEntry(RUN_LOG_MD, {
        startedAt: fatalStartedAt,
        script: "refresh-lookthrough",
        outcome: "fail",
        error: e?.message ?? String(e),
      });
    } catch {}
    process.exit(2);
  });
}
