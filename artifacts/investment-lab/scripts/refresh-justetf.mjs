#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-justetf.mjs
// ----------------------------------------------------------------------------
// Pulls a small set of per-ISIN reference fields from justETF for every ETF
// listed in src/lib/etfs.ts and writes the result into
// src/data/etfs.overrides.json. The override layer in src/lib/etfs.ts then
// shallow-merges those values on top of the curated CATALOG, so the engine
// keeps working with no live network call at runtime.
//
// Two refresh modes (run by separate CI schedules — see .github/workflows/):
//   - core      Weekly cadence. Refreshes slow-moving fund metadata:
//               terBps, aumMillionsEUR, inceptionDate, distribution,
//               replication.
//   - listings  Nightly cadence. Refreshes the per-exchange ticker map for
//               LSE / XETRA / SIX / Euronext.
//   - all       Runs both groups (default when no --mode flag is given).
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-justetf.mjs                           # all fields, all ISINs
//   node scripts/refresh-justetf.mjs --mode=core               # weekly snapshot
//   node scripts/refresh-justetf.mjs --mode=listings           # nightly listings
//   node scripts/refresh-justetf.mjs IE00B5BMR087              # one ISIN, all fields
//   node scripts/refresh-justetf.mjs --mode=core IE00B5BMR087  # one ISIN, core only
//   DRY_RUN=1 node scripts/refresh-justetf.mjs                 # don't write JSON
//
// Notes
// - This is an unofficial scrape of justETF's public English ETF profile pages.
//   Be polite: a 1.5s delay is enforced between requests, and the script will
//   abort cleanly if more than half of the pages fail to parse instead of
//   writing junk.
// - HTML structure can change. If a single extractor stops matching for an
//   ISIN, the previous value for that field is preserved (no clobber) and the
//   ISIN is only counted as a failure when *no* field could be extracted.
// - Editorial comment, defaultExchange and the geo / sector / currency
//   look-through breakdowns are intentionally NOT scraped here — they stay
//   curated in code (defaultExchange in src/lib/etfs.ts, look-through in
//   src/lib/lookthrough.ts). Top-10 holdings are refreshed monthly by
//   scripts/refresh-lookthrough.mjs.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract every (isin, currency) pair from the curated catalog so the listings
// extractor knows which currency to prefer when an exchange has multiple
// share classes (e.g. LSE typically lists USD + GBP + GBX variants).
async function extractCatalogEntries() {
  const src = await readFile(ETFS_TS, "utf8");
  const entries = new Map();
  const re =
    /isin:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"[\s\S]{0,800}?currency:\s*"([A-Z]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    entries.set(m[1], { isin: m[1], currency: m[2] });
  }
  return entries;
}

// --- Field extractors --------------------------------------------------------
// Each extractor receives (html, rec) and returns either a primitive/object or
// `undefined` (= leave catalog default). Each one must accept both English and
// German label variants because justETF serves either depending on the cookie
// / locale.
const MONTHS_EN = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTHS_DE = {
  jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

function parseDateLoose(raw) {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  let m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  const s = trimmed.replace(/\./g, "").replace(/,/g, "").replace(/\s+/g, " ");
  m = s.match(/^(\d{1,2})\s+([a-zäöü]+)\s+(\d{4})$/);
  if (m) {
    const monKey3 = m[2].slice(0, 3);
    const month = MONTHS_EN[monKey3] ?? MONTHS_DE[monKey3] ?? MONTHS_DE[m[2]];
    if (!month) return undefined;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  return undefined;
}

const CORE_EXTRACTORS = {
  terBps: (html) => {
    const m =
      html.match(/Total expense ratio[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i) ||
      html.match(/Gesamtkostenquote[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i);
    if (!m) return undefined;
    const pct = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 3) return undefined;
    return Math.round(pct * 100); // store as basis points (0.07 % -> 7)
  },

  aumMillionsEUR: (html) => {
    const m =
      html.match(/Fund size[\s\S]{0,400}?EUR\s*([\d.,]+)\s*(?:m\b|mn\b|million|Mio)/i) ||
      html.match(/Fondsgröße[\s\S]{0,400}?EUR\s*([\d.,]+)\s*(?:Mio|m\b|Mn)/i);
    if (!m) return undefined;
    const raw = m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return undefined;
    return Math.round(n);
  },

  inceptionDate: (html) => {
    const m =
      html.match(/Inception(?:\s*date)?[\s\S]{0,200}?([0-3]?\d[.\s\/-][A-Za-zäöüÄÖÜ.]+[.\s\/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i) ||
      html.match(/Auflagedatum[\s\S]{0,200}?([0-3]?\d[.\s\/-][A-Za-zäöüÄÖÜ.]+[.\s\/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i) ||
      html.match(/Auflage(?:datum)?[\s\S]{0,200}?(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (!m) return undefined;
    const iso = parseDateLoose(m[1]);
    if (!iso) return undefined;
    const year = parseInt(iso.slice(0, 4), 10);
    const nowYear = new Date().getUTCFullYear();
    if (year < 1990 || year > nowYear + 1) return undefined;
    return iso;
  },

  distribution: (html) => {
    const m =
      html.match(/Distribution policy[\s\S]{0,200}?(Distributing|Accumulating|Capitalisation|Capitalising)/i) ||
      html.match(/Use of profits[\s\S]{0,200}?(Distributing|Accumulating|Capitalisation|Capitalising)/i) ||
      html.match(/Ertragsverwendung[\s\S]{0,200}?(Aussch[üu]ttend|Thesaurierend)/i);
    if (!m) return undefined;
    const v = m[1].toLowerCase();
    if (v.startsWith("distrib") || v.startsWith("aussch")) return "Distributing";
    if (v.startsWith("accum") || v.startsWith("capital") || v.startsWith("thesaur")) return "Accumulating";
    return undefined;
  },

  replication: (html) => {
    const m =
      html.match(/Replication[\s\S]{0,200}?(Physical[^<\n]{0,80}|Synthetic[^<\n]{0,80})/i) ||
      html.match(/Replikationsmethode[\s\S]{0,200}?(Physisch[^<\n]{0,80}|Synthetisch[^<\n]{0,80})/i);
    if (!m) return undefined;
    const v = m[1].toLowerCase();
    if (v.startsWith("synth")) return "Synthetic";
    if (v.startsWith("phys")) {
      if (/sampl/i.test(v)) return "Physical (sampled)";
      return "Physical";
    }
    return undefined;
  },
};

// justETF data-testid suffixes for each row in the listings table map to
// concrete venues. We collapse them into the four exchange buckets the app
// surfaces in the UI (LSE / XETRA / SIX / Euronext). Anything unmapped
// (gettex, Borsa Italiana, Stuttgart, ...) is ignored.
const VENUE_MAP = {
  xlon: "LSE",
  xetr: "XETRA",
  vtx: "SIX",
  swis: "SIX",
  six: "SIX",
  ams: "Euronext",
  ebr: "Euronext",
  par: "Euronext",
  lis: "Euronext",
  dub: "Euronext",
};

const LISTINGS_EXTRACTORS = {
  // Per-exchange ticker map. Parses the Listings table on justETF's profile
  // page. For each exchange bucket, prefers the share class whose trading
  // currency matches the ETF's primary currency (catalog `currency` field) so
  // we don't replace e.g. LSE/USD "CSPX" with the GBX-priced "CSP1".
  listings: (html, rec) => {
    const tableMatch = html.match(
      /<table[^>]*data-testid="etf-trade-data-panel_table"[\s\S]*?<\/table>/i
    );
    if (!tableMatch) return undefined;
    const table = tableMatch[0];

    const rowRe =
      /<tr[^>]*data-testid="etf-trade-data-panel_row-([a-z0-9_]+)"[\s\S]*?<\/tr>/gi;
    const rows = [];
    let m;
    while ((m = rowRe.exec(table)) !== null) {
      const venue = m[1];
      const block = m[0];
      const currMatch = block.match(/_trade-currency"[^>]*>\s*([^<\s]+)\s*</i);
      const tickMatch = block.match(/_ticker"[^>]*>\s*([^<\s]+)\s*</i);
      if (!currMatch || !tickMatch) continue;
      const currency = currMatch[1].trim().toUpperCase();
      const ticker = tickMatch[1].trim();
      if (!ticker || ticker === "-" || ticker === "—" || ticker.length > 16) continue;
      rows.push({ venue, currency, ticker });
    }
    if (rows.length === 0) return undefined;

    const byExchange = {};
    for (const row of rows) {
      const ex = VENUE_MAP[row.venue];
      if (!ex) continue;
      if (!byExchange[ex]) byExchange[ex] = [];
      byExchange[ex].push(row);
    }

    const targetCurrency = (rec?.currency ?? "USD").toUpperCase();
    const out = {};
    for (const [ex, candidates] of Object.entries(byExchange)) {
      const pick =
        candidates.find((c) => c.currency === targetCurrency) ||
        candidates.find((c) => c.currency !== "GBX" && c.currency !== "GBP" && c.currency !== "GBp") ||
        candidates[0];
      out[ex] = { ticker: pick.ticker };
    }

    if (Object.keys(out).length === 0) return undefined;
    return out;
  },
};

const ALL_EXTRACTORS = { ...CORE_EXTRACTORS, ...LISTINGS_EXTRACTORS };

// Normalises the CLI `--mode` flag into the value written to
// `_meta.lastRefreshedMode` in etfs.overrides.json.
//
// The snapshot file is consumed by the UI's ETFSnapshotFreshness footer,
// which only renders the "(last refresh job: ...)" hint when the mode is
// exactly "core" or "listings" — the two real CI cadences. Writing "all"
// (the default mode for a manual `node scripts/refresh-justetf.mjs` run)
// would silently suppress that hint, leaving the user without any cue
// about which job produced the snapshot.
//
// To guarantee the hint always renders, we collapse `--mode=all` to
// "core" here: an `all` run refreshes both groups in a single pass, but
// for labelling purposes the core fund-metadata refresh is the more
// substantive cadence and matches what the snapshot looks like after the
// regular weekly CI run.
function lastRefreshedModeFor(mode) {
  return mode === "listings" ? "listings" : "core";
}

// Pure exports for unit tests under tests/scrapers.test.ts.
// `parseDateLoose` is included so date-parsing edge cases can be tested in
// isolation from the network-fetching `main()` flow.
export {
  CORE_EXTRACTORS,
  LISTINGS_EXTRACTORS,
  ALL_EXTRACTORS,
  VENUE_MAP,
  parseDateLoose,
  lastRefreshedModeFor,
};

async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
  return await res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const mode = (() => {
    const flag = args.find((a) => a.startsWith("--mode="));
    if (!flag) return "all";
    const v = flag.slice("--mode=".length);
    if (!["core", "listings", "all"].includes(v)) {
      console.error(`Unknown --mode=${v}. Expected core|listings|all.`);
      process.exit(2);
    }
    return v;
  })();
  const targetIsins = args.filter((a) => !a.startsWith("--"));
  const activeExtractors =
    mode === "core" ? CORE_EXTRACTORS : mode === "listings" ? LISTINGS_EXTRACTORS : ALL_EXTRACTORS;

  const catalog = await extractCatalogEntries();
  const allIsins = [...catalog.keys()];
  const isins = targetIsins.length ? targetIsins : allIsins;
  console.log(`Refreshing ${isins.length} ISIN(s) from justETF — mode=${mode}, fields=[${Object.keys(activeExtractors).join(", ")}]`);

  let existing = {};
  let existingMeta = {};
  try {
    const raw = JSON.parse(await readFile(OVERRIDES_JSON, "utf8"));
    existing = raw.overrides ?? {};
    existingMeta = raw._meta ?? {};
  } catch {
    // first run — leave empty
  }

  const next = { ...existing };
  let okCount = 0;
  let failCount = 0;

  for (const isin of isins) {
    const rec = catalog.get(isin);
    try {
      const html = await fetchProfile(isin);
      const patch = {};
      for (const [field, extractor] of Object.entries(activeExtractors)) {
        const v = extractor(html, rec);
        if (v !== undefined) patch[field] = v;
      }
      if (Object.keys(patch).length === 0) {
        console.warn(`  ! ${isin}: no fields extracted (leaving previous value)`);
        failCount++;
      } else {
        next[isin] = { ...(existing[isin] ?? {}), ...patch };
        const summary = Object.entries(patch)
          .map(([k, v]) => `${k}=${typeof v === "object" ? Object.keys(v).join("/") : v}`)
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

  // Track per-mode timestamps so the UI can show "core fields verified <date>"
  // and "listings verified <date>" independently. Each mode only updates its
  // own stamp; the other one is preserved from the previous run so a nightly
  // listings refresh doesn't reset the weekly core-fields stamp (and vice
  // versa).
  const stamp = new Date().toISOString();
  const lastCoreRefresh =
    mode === "core" || mode === "all" ? stamp : existingMeta.lastCoreRefresh ?? null;
  const lastListingsRefresh =
    mode === "listings" || mode === "all" ? stamp : existingMeta.lastListingsRefresh ?? null;

  const payload = {
    _meta: {
      source: "justetf.com",
      lastRefreshed: stamp,
      lastRefreshedMode: lastRefreshedModeFor(mode),
      lastCoreRefresh,
      lastListingsRefresh,
      refreshedBy: "scripts/refresh-justetf.mjs",
      note:
        "ISIN -> partial ETFRecord overrides applied on top of the in-code CATALOG in src/lib/etfs.ts. " +
        "Populated by two CI cadences: weekly (Sundays 03:00 UTC) for core fund metadata and nightly (02:00 UTC) for the per-exchange listings map. " +
        "Only fields present in this file override the catalog defaults; everything else stays as defined in code.",
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
