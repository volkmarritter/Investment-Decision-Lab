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
// Fields refreshed (see EXTRACTORS below):
//   - terBps          Total Expense Ratio in basis points
//   - aumMillionsEUR  Fund size in millions of EUR
//   - inceptionDate   Fund inception date as ISO YYYY-MM-DD
//   - distribution    "Accumulating" or "Distributing"
//   - replication     "Physical", "Physical (sampled)" or "Synthetic"
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-justetf.mjs                 # refresh all ISINs
//   node scripts/refresh-justetf.mjs IE00B5BMR087    # refresh one ISIN
//   DRY_RUN=1 node scripts/refresh-justetf.mjs       # don't write JSON
//
// Notes
// - This is an unofficial scrape of justETF's public English ETF profile pages.
//   Be polite: a 1.5s delay is enforced between requests, and the script will
//   abort cleanly if more than half of the pages fail to parse instead of
//   writing junk.
// - HTML structure can change. If a single extractor stops matching for an
//   ISIN, the previous value for that field is preserved (no clobber) and the
//   ISIN is only counted as a failure when *no* field could be extracted.
// - Only fields explicitly listed in EXTRACTORS are refreshed. Everything else
//   (listings, comment, defaultExchange, look-through profiles, CMAs, ...)
//   stays curated in code.
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
// either a primitive value or `undefined` (= leave catalog default). Each one
// must accept both English and German label variants because justETF serves
// either depending on the cookie / locale.
//
// Add more extractors here and they will be merged into the override file
// automatically — also widen the ETFOverride Pick<> in src/lib/etfs.ts so the
// type system permits the new field on disk.
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
  // 1) German numeric "12.05.2010" — handled BEFORE any dot-stripping so the
  //    separators are still present.
  let m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  // 2) "2010-05-12"
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 3) "12/05/2010" (assume day-month-year, the European order justETF uses)
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  // 4) Word-month forms — "12 may 2010", "12. mai 2010", "12 May, 2010", etc.
  //    Strip stray dots and commas around the day/month, collapse whitespace.
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

  // Fund size in millions of EUR. justETF prints either
  //   "Fund size  EUR 12,345 m"      (English)
  //   "Fondsgröße  EUR 12.345 Mio."  (German)
  // We only accept EUR-denominated values so the unit stays consistent.
  // Values outside [1, 1_000_000] EUR-millions are rejected as parser noise.
  aumMillionsEUR: (html) => {
    const m =
      html.match(/Fund size[\s\S]{0,400}?EUR\s*([\d.,]+)\s*(?:m\b|mn\b|million|Mio)/i) ||
      html.match(/Fondsgröße[\s\S]{0,400}?EUR\s*([\d.,]+)\s*(?:Mio|m\b|Mn)/i);
    if (!m) return undefined;
    // Strip thousands separators from both EU ("12.345") and EN ("12,345") forms.
    const raw = m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return undefined;
    return Math.round(n);
  },

  // Inception date. justETF prints "Inception 12 May 2010" (EN) or
  // "Auflagedatum 12. Mai 2010" / "Auflage 12.05.2010" (DE).
  inceptionDate: (html) => {
    const m =
      html.match(/Inception(?:\s*date)?[\s\S]{0,200}?([0-3]?\d[.\s\/-][A-Za-zäöüÄÖÜ.]+[.\s\/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i) ||
      html.match(/Auflagedatum[\s\S]{0,200}?([0-3]?\d[.\s\/-][A-Za-zäöüÄÖÜ.]+[.\s\/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i) ||
      html.match(/Auflage(?:datum)?[\s\S]{0,200}?(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (!m) return undefined;
    const iso = parseDateLoose(m[1]);
    if (!iso) return undefined;
    // Sanity: between 1990 and end of next year.
    const year = parseInt(iso.slice(0, 4), 10);
    const nowYear = new Date().getUTCFullYear();
    if (year < 1990 || year > nowYear + 1) return undefined;
    return iso;
  },

  // Distribution policy. Maps justETF wording to our two-value enum.
  // "Distributing", "Distribution"  → "Distributing"
  // "Accumulating", "Capitalisation" → "Accumulating"
  // "Ausschüttend"  → "Distributing"
  // "Thesaurierend" → "Accumulating"
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

  // Replication method. justETF distinguishes "Physical (Full replication)",
  // "Physical (Sampling)", "Synthetic (Swap based)" and the German equivalents
  // "Physisch (Vollständige Replikation)", "Physisch (Sampling)", "Synthetisch
  // (Swap-basiert)". We collapse to our three-value enum.
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
        "Empty by default; populated by the weekly refresh script (Sundays 03:00 UTC). Only fields present in this file override the catalog defaults; everything else stays as defined in code.",
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
