// ----------------------------------------------------------------------------
// lookthrough-scrape.ts
// ----------------------------------------------------------------------------
// Scrape one ETF's look-through reference data (top-10 holdings, country
// breakdown, sector breakdown, derived currency breakdown) from justETF.
// Used by the admin "look-through data pool" endpoint so admins can add
// bucket-agnostic ISINs to the look-through data set without editing the
// curated PROFILES table by hand.
//
// This is a TS port of the core scrape helpers in
// artifacts/investment-lab/scripts/refresh-lookthrough.mjs. The two stay
// behaviourally consistent — the monthly batch script keeps doing the
// heavy lifting; this one is a single-ISIN convenience for the live UI.
// ----------------------------------------------------------------------------

import { normalizeIsin, PreviewError } from "./etf-scrape";

const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

const BREAKDOWN_AJAX_PATHS: Record<"countries" | "sectors", string> = {
  countries: "holdingsSection-countries-loadMoreCountries",
  sectors: "holdingsSection-sectors-loadMoreSectors",
};

const BREAKDOWN_DELAY_MS = 750;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ExposureMap = Record<string, number>;

export interface TopHolding {
  name: string;
  pct: number;
}

export interface ScrapedLookthrough {
  isin: string;
  // Offizieller ETF-Name vom justETF-Profilkopf (z.B. "iShares Nasdaq 100
  // UCITS ETF (Acc)"). Optional, weil das Layout sich ändern kann — die
  // Look-through-Daten selbst hängen nicht davon ab. Wird in der Admin-
  // Pool-Tabelle neben der ISIN angezeigt, damit Auto-Refresh-Einträge
  // (die nicht im Katalog stehen) für den Operator identifizierbar sind.
  name?: string;
  topHoldings?: TopHolding[];
  geo?: ExposureMap;
  sector?: ExposureMap;
  currency?: ExposureMap;
  asOf: string; // ISO timestamp
  sourceUrl: string;
}

// ----- HTML helpers ---------------------------------------------------------

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Offizieller ETF-Name aus dem Profilkopf. justETF rendert ihn in einem
// stabilen <h1 data-testid="etf-profile-header_etf-name">…</h1>. Fallback
// auf den HTML-<title> (Format "<Name> | <WKN> | <ISIN>") falls der
// Header sich ändert — beide Pfade haben sich seit Monaten nicht bewegt.
export function extractEtfName(html: string): string | undefined {
  const h1 = html.match(
    /<h1[^>]*data-testid="etf-profile-header_etf-name"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  if (h1) {
    const text = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, "")).trim();
    if (text) return text;
  }
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    const text = decodeHtmlEntities(title[1]).trim();
    // "iShares Nasdaq 100 UCITS ETF (Acc) | A0YEDL | IE00B53SZB19" → name ist
    // alles vor dem ersten " | ". Wenn kein " | " da ist, ist es vermutlich
    // die Suchergebnisseite oder eine Fehlerseite — dann lieber undefined.
    const name = text.split(" | ")[0]?.trim();
    if (name && name.length > 3 && !/justetf/i.test(name)) return name;
  }
  return undefined;
}

export function extractTopHoldings(html: string): TopHolding[] | undefined {
  const tableMatch = html.match(
    /<table[^>]*data-testid="etf-holdings_top-holdings_table"[\s\S]*?<\/table>/i,
  );
  if (!tableMatch) return undefined;
  const table = tableMatch[0];
  const rowRe =
    /<tr[^>]*data-testid="etf-holdings_top-holdings_row"[\s\S]*?<\/tr>/gi;
  const out: TopHolding[] = [];
  let m: RegExpExecArray | null;
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
    if (trimmed[i].pct > trimmed[i - 1].pct + 0.05) return undefined;
  }
  return trimmed;
}

export function extractBreakdown(
  payload: string,
  kind: "countries" | "sectors",
): ExposureMap | undefined {
  if (!payload || (kind !== "countries" && kind !== "sectors")) return undefined;
  const tableRe = new RegExp(
    '<table[^>]*data-testid="etf-holdings_' + kind + '_table"[\\s\\S]*?<\\/table>',
    "i",
  );
  const tableMatch = payload.match(tableRe);
  if (!tableMatch) return undefined;
  const table = tableMatch[0];
  const rowRe = new RegExp(
    '<tr[^>]*data-testid="etf-holdings_' + kind + '_row"[\\s\\S]*?<\\/tr>',
    "gi",
  );
  const out: ExposureMap = {};
  let sum = 0;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(table)) !== null) {
    const block = m[0];
    const nameMatch = block.match(/_value_name"[^>]*>\s*([^<]+?)\s*</i);
    const pctMatch = block.match(/_value_percentage"[^>]*>\s*([\d.,]+)\s*%/i);
    if (!nameMatch || !pctMatch) continue;
    const name = decodeHtmlEntities(nameMatch[1]).trim();
    const pct = parseFloat(pctMatch[1].replace(",", "."));
    if (!name || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    if (out[name] !== undefined) continue;
    out[name] = Math.round(pct * 100) / 100;
    sum += pct;
  }
  if (Object.keys(out).length < 1) return undefined;
  if (sum < 95 || sum > 105) return undefined;
  return out;
}

function hasLoadMoreLink(html: string, kind: "countries" | "sectors"): boolean {
  const re = new RegExp(`data-testid="etf-holdings_${kind}_load-more_link"`);
  return re.test(html);
}

// ----- Country → currency map (mirror of the .mjs script) -------------------

const COUNTRY_TO_CURRENCY: Record<string, string> = {
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
  Other: "Other",
};

export function deriveCurrencyFromGeo(
  geo: ExposureMap | undefined,
): ExposureMap | undefined {
  if (!geo || typeof geo !== "object") return undefined;
  const out: ExposureMap = {};
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

// ----- HTTP helpers ---------------------------------------------------------

function captureCookies(res: Response): string {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie?.() ?? [];
  return all.map((line) => line.split(";")[0]).join("; ");
}

async function fetchProfile(
  isin: string,
): Promise<{ html: string; cookie: string }> {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  if (!res.ok) {
    throw new PreviewError(
      res.status === 404 ? 404 : 502,
      "upstream_http",
      `HTTP ${res.status} for ${isin}`,
    );
  }
  return { html: await res.text(), cookie: captureCookies(res) };
}

async function fetchBreakdownAjax(
  isin: string,
  kind: "countries" | "sectors",
  cookie: string,
): Promise<string> {
  const path = BREAKDOWN_AJAX_PATHS[kind];
  const url =
    `https://www.justetf.com/en/etf-profile.html?0-1.0-${path}` +
    `&isin=${isin}&_wicket=1`;
  const headers: Record<string, string> = {
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
  if (!res.ok) {
    throw new PreviewError(
      502,
      "upstream_http",
      `HTTP ${res.status} for ${isin} ${kind}`,
    );
  }
  return await res.text();
}

// ----- Public orchestrator --------------------------------------------------

export async function scrapeLookthrough(
  rawIsin: string,
): Promise<ScrapedLookthrough> {
  const isin = normalizeIsin(rawIsin);
  const sourceUrl = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const { html, cookie } = await fetchProfile(isin);

  const name = extractEtfName(html);
  const topHoldings = extractTopHoldings(html);

  // Geo + sector: try the static profile HTML first; if a "Show more" link
  // is present, fetch the full table via the Wicket Ajax endpoint.
  let geo = extractBreakdown(html, "countries");
  if (hasLoadMoreLink(html, "countries")) {
    try {
      const ajax = await fetchBreakdownAjax(isin, "countries", cookie);
      const fromAjax = extractBreakdown(ajax, "countries");
      if (fromAjax) geo = fromAjax;
    } catch {
      // fall back to whatever we got from the static HTML
    }
    await sleep(BREAKDOWN_DELAY_MS);
  }

  let sector = extractBreakdown(html, "sectors");
  if (hasLoadMoreLink(html, "sectors")) {
    try {
      const ajax = await fetchBreakdownAjax(isin, "sectors", cookie);
      const fromAjax = extractBreakdown(ajax, "sectors");
      if (fromAjax) sector = fromAjax;
    } catch {
      // fall back to whatever we got from the static HTML
    }
  }

  const currency = deriveCurrencyFromGeo(geo);

  return {
    isin,
    name,
    topHoldings,
    geo,
    sector,
    currency,
    asOf: new Date().toISOString(),
    sourceUrl,
  };
}
