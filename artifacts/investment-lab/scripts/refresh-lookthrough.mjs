#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-lookthrough.mjs
// ----------------------------------------------------------------------------
// Pulls per-ISIN look-through reference data from justETF and writes the
// result into src/data/lookthrough.overrides.json. The merge layer in
// src/lib/lookthrough.ts shallow-merges those values on top of the curated
// PROFILES so the engine keeps working with no live network call at runtime.
//
// Two reference data sets are refreshed here:
//   1. `topHoldings` — the top-10 stocks list parsed from the static
//      profile HTML (etf-holdings_top-holdings_table). Per-ISIN as-of stamp:
//      `topHoldingsAsOf`.
//   2. `geo` and `sector` — the country and sector breakdown maps. The
//      static profile HTML only ships the top-4 + "Other" bucket for these
//      tables; the full breakdown is loaded by the page through Wicket Ajax
//      (`holdingsSection-{countries|sectors}-loadMore{Countries|Sectors}`).
//      We replay that exact Ajax POST with the session cookie captured from
//      the initial GET, then parse the same `<table data-testid="...">`
//      structure. Per-ISIN as-of stamp: `breakdownsAsOf`.
//
// Currency exposure is *not* refreshed — justETF doesn't publish a per-ETF
// currency breakdown table at all (only a single fund-base currency in the
// summary header). The `currency` map in PROFILES therefore stays
// hand-curated. The Methodology page documents this explicitly.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const LOOKTHROUGH_TS = resolve(ROOT, "src/lib/lookthrough.ts");
const OVERRIDES_JSON = resolve(ROOT, "src/data/lookthrough.overrides.json");
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

// Skip the small set of non-equity ISINs whose top-holdings list either does
// not apply (gold ETF) or is uninformative for an equity-style display
// (broad-market crypto basket published with daily-shifting weights). These
// stay hand-curated.
async function extractEquityIsinsFromLookthrough() {
  const src = await readFile(LOOKTHROUGH_TS, "utf8");
  return parseEquityIsinsFromLookthroughSource(src);
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
  if (Object.keys(out).length < 2) return undefined;
  if (sum < 95 || sum > 105) return undefined;
  return out;
}

// Pure exports for unit tests under tests/scrapers.test.ts.
export {
  extractTopHoldings,
  extractBreakdown,
  parseEquityIsinsFromLookthroughSource,
};

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
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
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
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin} ${kind}`);
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
  let topOk = 0;
  let topFail = 0;
  let breakdownsOk = 0;
  let breakdownsFail = 0;
  const stamp = new Date().toISOString();

  for (const isin of isins) {
    let cookie = "";
    let html;

    // ---- 1) Profile page: top-10 holdings (and capture session cookie) ----
    try {
      const profile = await fetchProfile(isin);
      cookie = profile.cookie;
      html = profile.html;
      const topHoldings = extractTopHoldings(html);
      if (!topHoldings) {
        console.warn(`  ! ${isin}: no top-holdings extracted (leaving previous value)`);
        topFail++;
      } else {
        next[isin] = {
          ...(next[isin] ?? {}),
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
    if (html) {
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
      }
    }

    if (geo && sector) {
      next[isin] = {
        ...(next[isin] ?? {}),
        geo,
        sector,
        breakdownsAsOf: stamp,
      };
      console.log(
        `  \u2713 ${isin}: breakdowns refreshed ` +
          `(geo=${Object.keys(geo).length} entries, sector=${Object.keys(sector).length} entries)`
      );
      breakdownsOk++;
    } else if (cookie) {
      // Cookie was captured (so the page exists) but at least one of the
      // two breakdown tables didn't parse — leave the existing override or
      // curated default in place rather than half-overwriting.
      console.warn(
        `  ! ${isin}: breakdowns extraction failed ` +
          `(geo=${geo ? "ok" : "missing"}, sector=${sector ? "ok" : "missing"}) — leaving previous value`
      );
      breakdownsFail++;
    } else {
      // Profile fetch already failed; not counting again.
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
        "Refreshed fields: topHoldings (top-10 stocks, per-ISIN topHoldingsAsOf stamp) and " +
        "geo / sector breakdown maps (per-ISIN breakdownsAsOf stamp, fetched via the Wicket Ajax loadMore endpoint with a session cookie). " +
        "currency stays hand-curated because justETF doesn't publish a per-ETF currency breakdown table.",
    },
    overrides: next,
  };

  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${OVERRIDES_JSON} ` +
      `(top-holdings: ${topOk} ok / ${topFail} fail · ` +
      `breakdowns: ${breakdownsOk} ok / ${breakdownsFail} fail).`
  );
  process.exit(halfFailed ? 1 : 0);
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
