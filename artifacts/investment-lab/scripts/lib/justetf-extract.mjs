// ----------------------------------------------------------------------------
// justetf-extract.mjs
// ----------------------------------------------------------------------------
// PURE module — zero side-effects on import. Holds the regex extractors and
// the network fetch helper used by:
//
//   - scripts/refresh-justetf.mjs   (CLI: scheduled scrapes that write the
//                                    override JSON in src/data/)
//   - artifacts/api-server          (admin pane preview endpoint, which
//                                    scrapes one ISIN on demand and returns
//                                    the parsed fields without writing)
//
// Why a separate file (rather than just exporting from refresh-justetf.mjs)?
// The api-server is bundled by esbuild. Bundling refresh-justetf.mjs would
// flatten its `process.argv[1] === fileURLToPath(import.meta.url)` CLI guard
// into "always true" (because both sides resolve to the bundled
// dist/index.mjs), causing the script's main() to fire at server boot.
// Keeping the pure helpers here means the api-server never imports the CLI
// entrypoint at all.
// ----------------------------------------------------------------------------

export const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

const MONTHS_EN = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTHS_DE = {
  jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

export function parseDateLoose(raw) {
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

export const CORE_EXTRACTORS = {
  terBps: (html) => {
    const m =
      html.match(/Total expense ratio[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i) ||
      html.match(/Gesamtkostenquote[\s\S]{0,400}?(\d+(?:[.,]\d+)?)\s*%/i);
    if (!m) return undefined;
    const pct = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 3) return undefined;
    return Math.round(pct * 100); // basis points
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

export const VENUE_MAP = {
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

export const LISTINGS_EXTRACTORS = {
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

export const ALL_EXTRACTORS = { ...CORE_EXTRACTORS, ...LISTINGS_EXTRACTORS };

// Extractors used ONLY by the admin pane's "Suggest an ISIN" preview.
// Not part of any scheduled refresh because these fields stay curated in
// code (name, currency, domicile are part of the catalog seed, not
// refreshable values).
export const PREVIEW_EXTRACTORS = {
  name: (html) => {
    const m = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
    if (!m) return undefined;
    const name = m[1].replace(/&amp;/g, "&").trim();
    if (!name || name.length > 200) return undefined;
    return name;
  },
  currency: (html) => {
    const m =
      html.match(/Fund currency[\s\S]{0,200}?>\s*([A-Z]{3})\s*</i) ||
      html.match(/Fondsw[äa]hrung[\s\S]{0,200}?>\s*([A-Z]{3})\s*</i);
    if (!m) return undefined;
    return m[1];
  },
  domicile: (html) => {
    const m =
      html.match(/Fund domicile[\s\S]{0,200}?>\s*([A-Za-z ]{3,40}?)\s*</i) ||
      html.match(/Fondsdomizil[\s\S]{0,200}?>\s*([A-Za-z ]{3,40}?)\s*</i);
    if (!m) return undefined;
    const v = m[1].trim();
    if (!v) return undefined;
    return v;
  },
};

// Normalises the CLI `--mode` flag into the value written to
// `_meta.lastRefreshedMode` in etfs.overrides.json. See refresh-justetf.mjs
// header comment for why "all" collapses to "core".
export function lastRefreshedModeFor(mode) {
  return mode === "listings" ? "listings" : "core";
}

export async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
  return await res.text();
}
