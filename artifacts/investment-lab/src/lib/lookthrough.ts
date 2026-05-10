import { ETFImplementation } from "./types";
import lookthroughOverridesFile from "@/data/lookthrough.overrides.json";

export type ExposureMap = Record<string, number>;

export interface LookthroughProfile {
  isEquity: boolean;
  geo: ExposureMap;
  sector: ExposureMap;
  currency: ExposureMap;
  topHoldings?: Array<{ name: string; pct: number }>;
  // ISO timestamp written by scripts/refresh-lookthrough.mjs whenever the
  // top-holdings list for this ISIN was last refreshed from justETF. Undefined
  // when the row is still served from the curated default below.
  topHoldingsAsOf?: string;
  // ISO timestamp written by scripts/refresh-lookthrough.mjs whenever the
  // geo + sector breakdown maps for this ISIN were last refreshed from
  // justETF (via the Wicket Ajax loadMore endpoint). Undefined when the
  // maps are still served from the curated default below.
  breakdownsAsOf?: string;
}

// Reference date for the curated currency breakdown and any geo / sector
// rows still served from the in-code defaults below (e.g. on a fresh
// checkout, or for ISINs the breakdown refresh hasn't covered yet).
// Geo + sector + top-holdings carry their own per-ISIN ISO timestamps
// (`breakdownsAsOf` / `topHoldingsAsOf`) once the monthly justETF refresh
// job has populated src/data/lookthrough.overrides.json.
export const LOOKTHROUGH_REFERENCE_DATE = "Q4 2024";

// Surfaced freshness metadata for the look-through override file. The UI
// reads this to show a "Top-10 holdings refreshed <date>" stamp on the
// TopHoldings card. On a fresh checkout (file present but no refresh has
// run) `lastRefreshed` is null and the UI falls back to LOOKTHROUGH_REFERENCE_DATE.
type LookthroughOverridesMeta = {
  source?: string;
  lastRefreshed?: string | null;
};
export const LOOKTHROUGH_OVERRIDES_META: LookthroughOverridesMeta =
  (lookthroughOverridesFile as { _meta?: LookthroughOverridesMeta })._meta ?? {};

const PROFILES: Record<string, LookthroughProfile> = {
  // MSCI ACWI IMI — single-fund global equity (developed + emerging, all-cap)
  "IE00B3YLTY66": {
    isEquity: true,
    geo: {
      "United States": 62,
      "Japan": 5,
      "United Kingdom": 3,
      "China": 3,
      "Canada": 3,
      "France": 2.5,
      "Switzerland": 2,
      "Germany": 2,
      "India": 2,
      "Taiwan": 2,
      "Australia": 1.5,
      "South Korea": 1,
      "Netherlands": 1,
      "Other DM": 5,
      "Other EM": 5,
    },
    sector: {
      "Technology": 24,
      "Financials": 16,
      "Health Care": 11,
      "Cons. Discretionary": 11,
      "Industrials": 11,
      "Communication Svcs": 8,
      "Cons. Staples": 6,
      "Energy": 4,
      "Materials": 4,
      "Utilities": 3,
      "Real Estate": 2,
    },
    currency: {
      USD: 65,
      EUR: 8,
      JPY: 5,
      GBP: 4,
      CNY: 2,
      HKD: 1,
      CAD: 3,
      CHF: 2,
      INR: 2,
      TWD: 2,
      KRW: 1,
      AUD: 1.5,
      "Other": 3.5,
    },
    topHoldings: [
      { name: "Apple (AAPL)", pct: 4.3 },
      { name: "Microsoft (MSFT)", pct: 4.2 },
      { name: "Nvidia (NVDA)", pct: 3.8 },
      { name: "Amazon (AMZN)", pct: 2.5 },
      { name: "Alphabet (GOOGL+GOOG)", pct: 2.5 },
      { name: "Meta Platforms (META)", pct: 1.6 },
      { name: "TSMC", pct: 1.0 },
      { name: "Tesla (TSLA)", pct: 1.2 },
      { name: "Berkshire Hathaway (BRK.B)", pct: 1.0 },
      { name: "Broadcom (AVGO)", pct: 1.0 },
      { name: "Eli Lilly (LLY)", pct: 0.9 },
    ],
  },
  // S&P 500 — physical, synthetic and all hedged variants share the same underlying basket
  "IE00B5BMR087": {
    isEquity: true,
    geo: { "United States": 100 },
    sector: {
      "Technology": 30,
      "Financials": 13,
      "Health Care": 12,
      "Cons. Discretionary": 10,
      "Communication Svcs": 9,
      "Industrials": 8,
      "Cons. Staples": 6,
      "Energy": 4,
      "Utilities": 3,
      "Real Estate": 2,
      "Materials": 3,
    },
    currency: { USD: 100 },
    topHoldings: [
      { name: "Apple (AAPL)", pct: 7.0 },
      { name: "Microsoft (MSFT)", pct: 6.8 },
      { name: "Nvidia (NVDA)", pct: 6.2 },
      { name: "Amazon (AMZN)", pct: 4.0 },
      { name: "Alphabet (GOOGL+GOOG)", pct: 4.0 },
      { name: "Meta Platforms (META)", pct: 2.6 },
      { name: "Tesla (TSLA)", pct: 1.9 },
      { name: "Berkshire Hathaway (BRK.B)", pct: 1.7 },
      { name: "Broadcom (AVGO)", pct: 1.7 },
      { name: "Eli Lilly (LLY)", pct: 1.4 },
      { name: "JPMorgan Chase (JPM)", pct: 1.3 },
      { name: "UnitedHealth (UNH)", pct: 1.1 },
    ],
  },
  // MSCI Europe IMI
  "IE00B4K48X80": {
    isEquity: true,
    geo: {
      "United Kingdom": 23,
      "France": 17,
      "Germany": 15,
      "Switzerland": 15,
      "Netherlands": 7,
      "Sweden": 5,
      "Italy": 4,
      "Spain": 4,
      "Denmark": 4,
      "Other Europe": 6,
    },
    sector: {
      "Financials": 18,
      "Industrials": 17,
      "Health Care": 15,
      "Cons. Discretionary": 11,
      "Cons. Staples": 9,
      "Technology": 8,
      "Materials": 7,
      "Energy": 5,
      "Communication Svcs": 4,
      "Utilities": 4,
      "Real Estate": 2,
    },
    currency: {
      EUR: 38,
      GBP: 23,
      CHF: 15,
      SEK: 5,
      DKK: 4,
      NOK: 1,
      "Other EU": 14,
    },
    topHoldings: [
      { name: "Novo Nordisk", pct: 3.0 },
      { name: "Nestlé", pct: 2.6 },
      { name: "ASML", pct: 2.5 },
      { name: "LVMH", pct: 2.0 },
      { name: "Roche", pct: 2.0 },
      { name: "Novartis", pct: 2.0 },
      { name: "AstraZeneca", pct: 1.9 },
      { name: "Shell", pct: 1.9 },
      { name: "SAP", pct: 1.8 },
      { name: "HSBC", pct: 1.5 },
    ],
  },
  // SPI (Swiss Performance Index) — very concentrated
  "CH0237935652": {
    isEquity: true,
    geo: { "Switzerland": 100 },
    sector: {
      "Health Care": 33,
      "Cons. Staples": 18,
      "Financials": 17,
      "Industrials": 12,
      "Materials": 7,
      "Technology": 4,
      "Cons. Discretionary": 4,
      "Real Estate": 3,
      "Communication Svcs": 2,
    },
    currency: { CHF: 100 },
    topHoldings: [
      { name: "Nestlé", pct: 19 },
      { name: "Roche", pct: 16 },
      { name: "Novartis", pct: 14 },
      { name: "UBS", pct: 4.5 },
      { name: "Zurich Insurance", pct: 3.5 },
      { name: "ABB", pct: 3.5 },
      { name: "Richemont", pct: 3.0 },
      { name: "Sika", pct: 2.5 },
    ],
  },
  // FTSE 100 — UK large-cap (used by the Equity-UK bucket: GBP base
  // home-bias routing). Highly concentrated in financials, energy,
  // consumer staples and pharma; very international revenue mix despite
  // the UK domicile of the underlyings.
  "IE00B53HP851": {
    isEquity: true,
    geo: { "United Kingdom": 100 },
    sector: {
      "Financials": 22,
      "Cons. Staples": 17,
      "Energy": 13,
      "Health Care": 12,
      "Industrials": 10,
      "Materials": 8,
      "Cons. Discretionary": 7,
      "Communication Svcs": 5,
      "Utilities": 4,
      "Real Estate": 1,
      "Technology": 1,
    },
    currency: { GBP: 100 },
    topHoldings: [
      { name: "AstraZeneca", pct: 8.0 },
      { name: "Shell", pct: 7.0 },
      { name: "HSBC", pct: 6.5 },
      { name: "Unilever", pct: 5.0 },
      { name: "BP", pct: 3.8 },
      { name: "GSK", pct: 3.5 },
      { name: "RELX", pct: 3.0 },
      { name: "Diageo", pct: 2.8 },
      { name: "BAT (British American Tobacco)", pct: 2.6 },
      { name: "Rio Tinto", pct: 2.4 },
      { name: "Glencore", pct: 2.2 },
    ],
  },
  // MSCI Japan IMI
  "IE00B4L5YX21": {
    isEquity: true,
    geo: { "Japan": 100 },
    sector: {
      "Industrials": 23,
      "Cons. Discretionary": 18,
      "Technology": 14,
      "Financials": 11,
      "Health Care": 9,
      "Communication Svcs": 8,
      "Materials": 6,
      "Cons. Staples": 5,
      "Real Estate": 3,
      "Utilities": 2,
      "Energy": 1,
    },
    currency: { JPY: 100 },
    topHoldings: [
      { name: "Toyota Motor", pct: 4.0 },
      { name: "Sony Group", pct: 2.0 },
      { name: "Mitsubishi UFJ Financial", pct: 1.7 },
      { name: "Keyence", pct: 1.5 },
      { name: "Hitachi", pct: 1.4 },
      { name: "Tokyo Electron", pct: 1.3 },
      { name: "SoftBank Group", pct: 1.2 },
    ],
  },
  // MSCI EM IMI
  "IE00BKM4GZ66": {
    isEquity: true,
    geo: {
      "China": 27,
      "India": 19,
      "Taiwan": 18,
      "South Korea": 11,
      "Brazil": 5,
      "Saudi Arabia": 4,
      "Mexico": 3,
      "South Africa": 3,
      "Other EM": 10,
    },
    sector: {
      "Technology": 23,
      "Financials": 22,
      "Cons. Discretionary": 13,
      "Communication Svcs": 9,
      "Industrials": 7,
      "Materials": 7,
      "Energy": 5,
      "Cons. Staples": 5,
      "Health Care": 4,
      "Utilities": 3,
      "Real Estate": 2,
    },
    currency: {
      CNY: 18,
      HKD: 9,
      INR: 19,
      TWD: 18,
      KRW: 11,
      BRL: 5,
      SAR: 4,
      ZAR: 3,
      MXN: 3,
      "Other EM": 10,
    },
    topHoldings: [
      { name: "TSMC", pct: 9.0 },
      { name: "Tencent", pct: 4.0 },
      { name: "Samsung Electronics", pct: 3.0 },
      { name: "Alibaba", pct: 2.0 },
      { name: "Reliance Industries", pct: 1.5 },
      { name: "HDFC Bank", pct: 1.3 },
      { name: "Meituan", pct: 1.0 },
      { name: "ICICI Bank", pct: 0.9 },
    ],
  },
  // S&P 500 Information Technology Sector
  "IE00B3WJKG14": {
    isEquity: true,
    geo: { "United States": 100 },
    sector: { "Technology": 100 },
    currency: { USD: 100 },
    topHoldings: [
      { name: "Apple (AAPL)", pct: 17.0 },
      { name: "Microsoft (MSFT)", pct: 16.5 },
      { name: "Nvidia (NVDA)", pct: 15.0 },
      { name: "Broadcom (AVGO)", pct: 5.0 },
      { name: "Oracle (ORCL)", pct: 3.0 },
      { name: "AMD (AMD)", pct: 2.5 },
      { name: "Salesforce (CRM)", pct: 2.4 },
      { name: "Adobe (ADBE)", pct: 2.0 },
      { name: "Cisco (CSCO)", pct: 1.9 },
      { name: "Accenture (ACN)", pct: 1.8 },
    ],
  },
  // Healthcare Innovation
  "IE00BYZK4776": {
    isEquity: true,
    geo: { "United States": 60, "Europe": 18, "Japan": 8, "Other DM": 10, "EM": 4 },
    sector: { "Health Care": 100 },
    currency: { USD: 60, EUR: 12, GBP: 4, CHF: 2, JPY: 8, "Other": 14 },
  },
  // Clean Energy
  "IE00B1XNHC34": {
    isEquity: true,
    geo: { "United States": 40, "China": 14, "Europe": 28, "Other": 18 },
    sector: { "Utilities": 35, "Industrials": 30, "Technology": 25, "Materials": 10 },
    currency: { USD: 40, CNY: 14, EUR: 22, "Other": 24 },
  },
  // Cybersecurity
  "IE00BG0J4C88": {
    isEquity: true,
    geo: { "United States": 75, "Israel": 10, "Europe": 8, "Other": 7 },
    sector: { "Technology": 90, "Industrials": 10 },
    currency: { USD: 75, ILS: 10, EUR: 8, "Other": 7 },
  },
  // Global Aggregate Bond — unhedged USD share class
  "IE00B3F81409": {
    isEquity: false,
    geo: {
      "United States": 41,
      "Eurozone": 23,
      "Japan": 12,
      "United Kingdom": 5,
      "Other DM": 14,
      "EM (IG)": 5,
    },
    sector: {
      "Government": 55,
      "Corporate IG": 20,
      "Securitised": 12,
      "Government-related": 10,
      "Other": 3,
    },
    currency: { USD: 41, EUR: 23, JPY: 12, GBP: 5, "Other DM": 14, "EM IG": 5 },
  },
  // Gold ETC — globally priced in USD
  "IE00B579F325": {
    isEquity: false,
    geo: { "Physical Gold (LBMA, London)": 100 },
    sector: { "Gold Bullion": 100 },
    currency: { USD: 100 },
  },
  // Developed-market REITs
  "IE00B1FZS350": {
    isEquity: true,
    geo: {
      "United States": 60,
      "Japan": 11,
      "Australia": 7,
      "United Kingdom": 6,
      "Europe ex-UK": 10,
      "Other DM": 6,
    },
    sector: { "Real Estate": 100 },
    currency: { USD: 60, JPY: 11, AUD: 7, GBP: 6, EUR: 7, "Other DM": 9 },
    topHoldings: [
      { name: "Prologis", pct: 4.5 },
      { name: "Equinix", pct: 3.5 },
      { name: "Welltower", pct: 2.5 },
      { name: "Public Storage", pct: 2.0 },
      { name: "Realty Income", pct: 1.8 },
      { name: "Simon Property Group", pct: 1.6 },
    ],
  },
  // Bitcoin ETP — priced in USD globally
  "GB00BLD4ZL17": {
    isEquity: false,
    geo: { "Global (Decentralised)": 100 },
    sector: { "Bitcoin": 100 },
    currency: { USD: 100 },
  },
};

// Task #238 — per-ISIN look-through profiles for ETFs whose underlying
// basket is genuinely identical to a curated PROFILES sibling, plus
// per-ISIN profiles for currency-hedged share classes. There is NO
// substitution lookup: each ISIN gets its OWN entry in PROFILES below
// via Object.assign at module load. Where two index trackers from
// different issuers track the same index (e.g. Xtrackers S&P 500 vs.
// iShares S&P 500), they share underlying basket data because that's
// a market reality — not because we're papering over missing data.
//
// For currency-hedged share classes we override only the `currency`
// map (the FX hedge re-denominates exposure to the share-class
// currency); geo/sector/topHoldings stay the same as the unhedged
// sibling because the underlying basket is unchanged.
//
// `validateLookthroughCoverage()` in src/lib/etfs.ts asserts that
// every catalog default + alternative + pool ISIN has its own profile
// entry; the "every catalog ISIN is covered" Vitest case in
// tests/engine.test.ts hard-fails CI if a gap is introduced.
function variantOf(
  base: string,
  opts: { currency?: ExposureMap } = {},
): LookthroughProfile {
  const src = PROFILES[base];
  if (!src) {
    throw new Error(
      `lookthrough: variantOf base="${base}" not in PROFILES — ` +
        `add the curated profile before referencing it as a variant base.`,
    );
  }
  return {
    isEquity: src.isEquity,
    geo: src.geo,
    sector: src.sector,
    currency: opts.currency ?? src.currency,
    ...(src.topHoldings ? { topHoldings: src.topHoldings } : {}),
    ...(src.topHoldingsAsOf ? { topHoldingsAsOf: src.topHoldingsAsOf } : {}),
    ...(src.breakdownsAsOf ? { breakdownsAsOf: src.breakdownsAsOf } : {}),
  };
}

// Per-ISIN profiles for funds that share an underlying basket with a
// curated sibling. Each ISIN owns its own profile entry — they are
// merged into PROFILES below, NOT looked up indirectly.
const SHARED_BASKET_PROFILES: Record<string, LookthroughProfile> = {
  // S&P 500 trackers — same underlying basket as iShares Core S&P 500
  // (IE00B5BMR087). Different issuers / replication methods, identical
  // index, so per-ISIN data is identical by construction.
  "IE00B3YCGJ38": variantOf("IE00B5BMR087"), // Invesco S&P 500 (synthetic, default of Equity-USA)
  "LU0490618542": variantOf("IE00B5BMR087"), // Xtrackers S&P 500 Swap
  "LU1681048804": variantOf("IE00B5BMR087"), // Amundi S&P 500 Swap
  // S&P 500 currency-hedged share classes — basket unchanged, currency
  // re-denominated to the hedge currency (small residual reflects hedge
  // cost / monthly reset slippage).
  "IE00BCRY6557": variantOf("IE00B5BMR087", { currency: { EUR: 98, USD: 2 } }),
  "IE00BYX5MS15": variantOf("IE00B5BMR087", { currency: { GBP: 98, USD: 2 } }),
  "IE00B3ZW0K18": variantOf("IE00B5BMR087", { currency: { EUR: 98, USD: 2 } }),

  // MSCI EM — Amundi tracker shares same underlying as iShares MSCI EM
  // IMI (IE00BKM4GZ66). Index identical.
  "LU2573967036": variantOf("IE00BKM4GZ66"),

  // Global Aggregate Bond — currency-hedged share classes of the same
  // underlying basket as iShares Global Aggregate Bond (IE00B3F81409).
  "IE00BDBRDM35": variantOf("IE00B3F81409", { currency: { EUR: 98, USD: 2 } }),
  "IE00BDBRDN42": variantOf("IE00B3F81409", { currency: { CHF: 98, USD: 2 } }),
  "IE00BDBRDP65": variantOf("IE00B3F81409", { currency: { GBP: 98, USD: 2 } }),
  "IE00BD1JRY91": variantOf("IE00B3F81409", { currency: { CHF: 98, USD: 2 } }),
  // Vanguard Global Aggregate Bond EUR Hedged share classes (Acc + Dist)
  // — same Bloomberg Global Aggregate index as the iShares default
  // (IE00B3F81409), different issuer + EUR-hedged share class. Identical
  // underlying basket; currency re-denominated to EUR by the hedge.
  // Task #249.
  "IE00BG47KH54": variantOf("IE00B3F81409", { currency: { EUR: 98, USD: 2 } }),
  "IE00BG47KB92": variantOf("IE00B3F81409", { currency: { EUR: 98, USD: 2 } }),

  // Physical-gold ETCs — every entry is a single-asset, fully-allocated
  // physical-gold wrapper. Sector / geo are identical by definition (gold
  // bullion); currency reflects the share-class quote currency (CHF for
  // ZKB / UBS, EUR for Euwax, USD for the rest).
  "IE00B4ND3602": variantOf("IE00B579F325"),
  "JE00B1VS3770": variantOf("IE00B579F325"),
  "DE000A0S9GB0": variantOf("IE00B579F325"),
  "CH0044781232": variantOf("IE00B579F325", { currency: { CHF: 100 } }),
  "CH0047533523": variantOf("IE00B579F325", { currency: { CHF: 100 } }),
  "IE00BDFL4P12": variantOf("IE00B579F325"),
  "DE000A0H0728": variantOf("IE00B579F325", { currency: { EUR: 100 } }),

  // Physical-bitcoin ETPs — every entry is a single-asset, physically-
  // backed BTC wrapper. Underlying is BTC by construction; currency is
  // the share-class quote currency.
  "GB00BJYDH287": variantOf("GB00BLD4ZL17", { currency: { GBP: 100 } }),
  "CH1199067674": variantOf("GB00BLD4ZL17", { currency: { CHF: 100 } }),
  "CH0454664001": variantOf("GB00BLD4ZL17", { currency: { CHF: 100 } }),
  "DE000A27Z304": variantOf("GB00BLD4ZL17", { currency: { EUR: 100 } }),
};

// Per-ISIN profiles for funds whose underlying basket is GENUINELY
// distinct from the catalog bucket default — these are NOT siblings of
// the default and would be misrepresented by sharing its data. Curated
// from the issuer factsheets (Q4 2024 reference date, see
// LOOKTHROUGH_REFERENCE_DATE).
const DISTINCT_PROFILES: Record<string, LookthroughProfile> = {
  // Xtrackers MSCI World Swap — MSCI World, NOT S&P 500. Pool entry of
  // Equity-Global. ~70% US, broad DM mix.
  "LU0274208692": {
    isEquity: true,
    geo: {
      "United States": 70,
      "Japan": 6,
      "United Kingdom": 4,
      "Canada": 3,
      "France": 3,
      "Switzerland": 3,
      "Germany": 2.5,
      "Australia": 2,
      "Netherlands": 1.5,
      "Other DM": 5,
    },
    sector: {
      "Technology": 25,
      "Financials": 16,
      "Health Care": 11,
      "Cons. Discretionary": 11,
      "Industrials": 11,
      "Communication Svcs": 8,
      "Cons. Staples": 6,
      "Energy": 4,
      "Materials": 4,
      "Utilities": 2,
      "Real Estate": 2,
    },
    currency: {
      USD: 70,
      EUR: 8,
      JPY: 6,
      GBP: 4,
      CAD: 3,
      CHF: 3,
      AUD: 2,
      "Other": 4,
    },
    topHoldings: [
      { name: "Apple (AAPL)", pct: 4.7 },
      { name: "Microsoft (MSFT)", pct: 4.5 },
      { name: "Nvidia (NVDA)", pct: 4.1 },
      { name: "Amazon (AMZN)", pct: 2.7 },
      { name: "Alphabet (GOOGL+GOOG)", pct: 2.7 },
      { name: "Meta Platforms (META)", pct: 1.7 },
      { name: "Tesla (TSLA)", pct: 1.3 },
      { name: "Berkshire Hathaway (BRK.B)", pct: 1.1 },
      { name: "Broadcom (AVGO)", pct: 1.1 },
      { name: "Eli Lilly (LLY)", pct: 1.0 },
    ],
  },

  // Amundi Nasdaq-100 Swap — Nasdaq-100 (US large-cap, tech-heavy
  // single-listing). DISTINCT from broad S&P 500 IT (IE00B3WJKG14)
  // and from broad S&P 500: roughly 60% tech / comm-svcs but with
  // Nasdaq-listed cons-disc and consumer-staples positions.
  "LU1681038243": {
    isEquity: true,
    geo: { "United States": 100 },
    sector: {
      "Technology": 50,
      "Communication Svcs": 16,
      "Cons. Discretionary": 14,
      "Health Care": 7,
      "Cons. Staples": 5,
      "Industrials": 5,
      "Utilities": 2,
      "Financials": 1,
    },
    currency: { USD: 100 },
    topHoldings: [
      { name: "Apple (AAPL)", pct: 9.0 },
      { name: "Microsoft (MSFT)", pct: 8.5 },
      { name: "Nvidia (NVDA)", pct: 8.0 },
      { name: "Amazon (AMZN)", pct: 5.5 },
      { name: "Meta Platforms (META)", pct: 5.0 },
      { name: "Alphabet (GOOGL+GOOG)", pct: 5.0 },
      { name: "Broadcom (AVGO)", pct: 4.5 },
      { name: "Tesla (TSLA)", pct: 3.5 },
      { name: "Costco (COST)", pct: 2.5 },
      { name: "Netflix (NFLX)", pct: 1.7 },
    ],
  },

  // Global X Robotics & AI — narrow sub-theme (industrial automation,
  // semis, AI-platform). DISTINCT from broad S&P 500 IT: ~30 holdings,
  // significant Japanese / Korean industrial automation weight.
  "IE00BLCHJB90": {
    isEquity: true,
    geo: {
      "United States": 50,
      "Japan": 22,
      "Switzerland": 6,
      "South Korea": 5,
      "Taiwan": 5,
      "Germany": 4,
      "United Kingdom": 3,
      "Other DM": 5,
    },
    sector: {
      "Technology": 60,
      "Industrials": 30,
      "Health Care": 5,
      "Communication Svcs": 5,
    },
    currency: {
      USD: 50,
      JPY: 22,
      CHF: 6,
      KRW: 5,
      TWD: 5,
      EUR: 7,
      GBP: 3,
      "Other": 2,
    },
    topHoldings: [
      { name: "Nvidia (NVDA)", pct: 9.0 },
      { name: "Intuitive Surgical (ISRG)", pct: 7.5 },
      { name: "ABB", pct: 6.0 },
      { name: "Keyence", pct: 5.5 },
      { name: "Fanuc", pct: 5.0 },
      { name: "SMC Corp", pct: 4.5 },
      { name: "Tesla (TSLA)", pct: 4.0 },
      { name: "Yaskawa Electric", pct: 3.5 },
      { name: "Symbotic (SYM)", pct: 3.0 },
    ],
  },

  // First Trust Nasdaq Clean Edge Green Energy — US clean-energy sub-
  // theme. DISTINCT from MSCI ESG global equity (IE00B1XNHC34): ~80%
  // US, concentrated in solar / EV-supply / utility-renewables.
  "IE00BDBRT036": {
    isEquity: true,
    geo: {
      "United States": 78,
      "Canada": 6,
      "Israel": 5,
      "China": 5,
      "Other": 6,
    },
    sector: {
      "Industrials": 35,
      "Technology": 25,
      "Utilities": 18,
      "Cons. Discretionary": 12,
      "Materials": 10,
    },
    currency: {
      USD: 78,
      CAD: 6,
      ILS: 5,
      CNY: 5,
      "Other": 6,
    },
    topHoldings: [
      { name: "Tesla (TSLA)", pct: 9.0 },
      { name: "First Solar", pct: 8.5 },
      { name: "Enphase Energy", pct: 7.0 },
      { name: "ON Semiconductor", pct: 5.5 },
      { name: "Albemarle", pct: 5.0 },
      { name: "GE Vernova", pct: 4.5 },
      { name: "Brookfield Renewable", pct: 4.0 },
      { name: "ChargePoint", pct: 2.5 },
    ],
  },

  // iShares Euro Government Bond 3-7yr — EUR-denominated EU sovereign
  // bonds, 3-7yr maturity. DISTINCT from Global Aggregate Bond
  // (IE00B3F81409): single-currency, single-sector (govt only),
  // intermediate-duration, no corporate / securitised exposure.
  "IE00B3VTML14": {
    isEquity: false,
    geo: {
      "France": 24,
      "Italy": 22,
      "Germany": 20,
      "Spain": 14,
      "Netherlands": 6,
      "Belgium": 5,
      "Austria": 3,
      "Other Eurozone": 6,
    },
    sector: { "Government": 100 },
    currency: { EUR: 100 },
  },

  // Xtrackers II Global Government Bond UCITS — sovereign-only global
  // bond aggregate. DISTINCT from iShares Core Global Aggregate Bond
  // (IE00B3F81409): excludes corporates and securitised, government-only
  // by mandate. Geo / currency mix mirrors the FTSE WGBI: ~40% USD, ~25%
  // JPY, balance Eurozone + UK + other DM. Unhedged USD share class, so
  // currency follows the underlying issuer mix. Task #249 (curated from
  // Xtrackers factsheet — justETF does not publish a holdings breakdown
  // for this Luxembourg SICAV-based ETF).
  "LU0378818131": {
    isEquity: false,
    geo: {
      "United States": 40,
      "Japan": 22,
      "Eurozone": 22,
      "United Kingdom": 6,
      "Other DM": 10,
    },
    sector: { "Government": 95, "Government-related": 5 },
    currency: {
      USD: 40,
      JPY: 22,
      EUR: 22,
      GBP: 6,
      "Other DM": 10,
    },
  },

  // Xtrackers II Eurozone Government Bond UCITS 1C — Eurozone sovereign
  // bonds only, all maturities (broader than IE00B3VTML14 which is
  // 3-7yr). DISTINCT from Global Aggregate Bond: single-currency,
  // single-sector, no corporate / securitised / non-EZ exposure.
  // Task #249 (curated from Xtrackers factsheet, country mix matches
  // iBoxx EUR Sovereigns weights).
  "LU0290355717": {
    isEquity: false,
    geo: {
      "France": 24,
      "Italy": 22,
      "Germany": 20,
      "Spain": 14,
      "Netherlands": 6,
      "Belgium": 5,
      "Austria": 3,
      "Other Eurozone": 6,
    },
    sector: { "Government": 100 },
    currency: { EUR: 100 },
  },
};

// Per-ISIN profiles for off-catalog funds that the user-reported
// nine-position portfolio test (Task #238 round 3) hits via the
// Explain import. These ETFs are not in the Build catalog buckets, so
// `validateLookthroughCoverage` does not flag them — but the import
// flow still surfaces them and they need their own per-ISIN profile.
const OFF_CATALOG_PROFILES: Record<string, LookthroughProfile> = {
  // SPDR S&P US Dividend Aristocrats UCITS ETF — US large/mid-cap
  // value tilt; sector mix is heavy on Industrials, Cons. Staples and
  // Utilities versus broad S&P 500.
  "IE00B3VWP018": {
    isEquity: true,
    geo: { "United States": 100 },
    sector: {
      "Industrials": 22,
      "Cons. Staples": 19,
      "Utilities": 14,
      "Financials": 11,
      "Materials": 9,
      "Health Care": 8,
      "Cons. Discretionary": 7,
      "Energy": 4,
      "Real Estate": 3,
      "Technology": 2,
      "Communication Svcs": 1,
    },
    currency: { USD: 100 },
  },
  // Amundi Index MSCI Emerging Markets UCITS ETF DR — broad EM equity,
  // basket dominated by China / Taiwan / India / Korea.
  "LU1230136894": {
    isEquity: true,
    geo: {
      "China": 27,
      "Taiwan": 19,
      "India": 18,
      "South Korea": 12,
      "Brazil": 5,
      "Saudi Arabia": 4,
      "South Africa": 3,
      "Mexico": 2,
      "Other EM": 10,
    },
    sector: {
      "Technology": 24,
      "Financials": 22,
      "Cons. Discretionary": 13,
      "Communication Svcs": 9,
      "Industrials": 7,
      "Materials": 7,
      "Energy": 5,
      "Cons. Staples": 5,
      "Health Care": 4,
      "Utilities": 3,
      "Real Estate": 1,
    },
    currency: {
      CNY: 27, TWD: 19, INR: 18, KRW: 12, BRL: 5,
      SAR: 4, ZAR: 3, MXN: 2, USD: 6, "Other": 4,
    },
  },
  // Vanguard U.K. Gilt UCITS ETF — UK government bonds, GBP-denominated.
  "IE00B42WWV65": {
    isEquity: false,
    geo: { "United Kingdom": 100 },
    sector: { "Government": 100 },
    currency: { GBP: 100 },
  },
};

Object.assign(
  PROFILES,
  SHARED_BASKET_PROFILES,
  DISTINCT_PROFILES,
  OFF_CATALOG_PROFILES,
);

// ISINs that represent currency-hedged share classes — for these the FX exposure
// after hedging is the share-class currency, not the underlying currency map.
const HEDGED_ISINS = new Set<string>([
  "IE00BCRY6557",
  "IE00BYX5MS15",
  "IE00B3ZW0K18",
  "IE00BDBRDM35",
  "IE00BDBRDN42",
  "IE00BDBRDP65",
  // Vanguard Global Aggregate Bond EUR Hedged Acc / Dist (Task #249)
  "IE00BG47KH54",
  "IE00BG47KB92",
]);

// ----------------------------------------------------------------------------
// Optional refresh overrides (see scripts/refresh-lookthrough.mjs).
// The PROFILES above are the curated source of truth. The monthly refresh
// job writes ISIN-keyed partial profiles into
// src/data/lookthrough.overrides.json; we shallow-merge each present field
// on top of the matching profile at module load. Refreshed fields:
//   - topHoldings + topHoldingsAsOf (parsed from the static profile HTML)
//   - geo, sector + breakdownsAsOf  (parsed from the static profile HTML
//     when complete, or the Wicket Ajax loadMore endpoint with a session
//     cookie when justETF renders a "Show more" link — see
//     refresh-lookthrough.mjs)
//   - currency                       (re-bucketed from the just-refreshed
//     geo map via a country -> local-listing-currency table inside the
//     refresh script. justETF doesn't publish a per-ETF currency table
//     directly, so this is a derived approximation. Skipped — and
//     therefore left to the curated value below — for the
//     currency-hedged share classes in HEDGED_ISINS, whose hedge-currency
//     map is authoritative.)
// ----------------------------------------------------------------------------
type LookthroughOverride = {
  topHoldings?: Array<{ name: string; pct: number }>;
  topHoldingsAsOf?: string;
  geo?: ExposureMap;
  sector?: ExposureMap;
  currency?: ExposureMap;
  breakdownsAsOf?: string;
  // Optional asset-class hint. When omitted, the merge step below treats
  // the entry as equity (isEquity = true) for backward compatibility with
  // pre-Task-#127 admin-pool entries that were always equity ETFs. Bond /
  // money-market / inflation-linked ETFs (added in bulk via
  // scripts/scrape-popular-etfs-pool.mjs) explicitly set isEquity:false
  // so they route to the fixed-income geo path in `analyzeLookthrough`
  // instead of polluting the equity geo/sector cards.
  isEquity?: boolean;
};
const RAW_LOOKTHROUGH_OVERRIDES =
  (lookthroughOverridesFile as { overrides?: Record<string, LookthroughOverride> }).overrides ?? {};

// Bucket-agnostic look-through profiles added via the admin "Look-through
// data pool" UI. These are FULL profiles (not patches): the admin endpoint
// scrapes the ETF page and writes topHoldings + geo + sector + currency
// in one shot. They are folded into PROFILES below so that
// `profileFor(isin)` returns a complete entry — which makes the ETF
// override dialog's amber "data missing" warning auto-clear once an
// operator has added the ISIN here.
//
// Pool entries are not bucket-bound: they don't appear in any bucket's
// implementations list and are only consumed when the user picks the ISIN
// as a Methodology override. They are picked up by the monthly refresh job
// (scripts/refresh-lookthrough.mjs) the same way as `overrides` ISINs, but
// the script writes refreshed data BACK into pool[isin], not overrides[isin].
const RAW_LOOKTHROUGH_POOL =
  (lookthroughOverridesFile as { pool?: Record<string, LookthroughOverride> }).pool ?? {};

// Snapshot freshness metadata written by scripts/refresh-lookthrough.mjs.
// Per-ISIN top-holdings stamps live on each profile (`topHoldingsAsOf`); this
// file-level value is the timestamp of the last refresh job run, used as a
// fallback when no per-ISIN stamp is available.
export interface LookthroughSnapshotMeta {
  lastRefreshed: string | null;
}
const _LT_META = (lookthroughOverridesFile as {
  _meta?: { lastRefreshed?: string | null };
})._meta ?? {};
const _LT_SNAPSHOT_META: LookthroughSnapshotMeta = {
  lastRefreshed: _LT_META.lastRefreshed ?? null,
};
export function getLookthroughSnapshotMeta(): LookthroughSnapshotMeta {
  return _LT_SNAPSHOT_META;
}

// Returns the per-ISIN top-holdings as-of stamp if the monthly refresh has
// populated it; null when the row is still served from the curated default.
export function topHoldingsStampFor(isin: string): string | null {
  return profileFor(isin)?.topHoldingsAsOf ?? null;
}

// Returns the per-ISIN geo + sector breakdown as-of stamp if the monthly
// refresh has populated it; null when those maps are still served from the
// curated default below.
export function breakdownsStampFor(isin: string): string | null {
  return profileFor(isin)?.breakdownsAsOf ?? null;
}

// Collect override ISINs whose curated PROFILES entry is missing — see the
// orphan warning emitted right after the merge loop. We can't warn inline
// because emitting one line per orphan would be noisy in tests and the dev
// console; we batch the names into a single warning instead.
const orphanOverrideIsins: string[] = [];
for (const [isin, patch] of Object.entries(RAW_LOOKTHROUGH_OVERRIDES)) {
  const target = PROFILES[isin];
  if (!target || !patch) {
    // An override exists for an ISIN that has no curated profile. The
    // refresh job will still keep writing top-10 holdings + breakdown
    // maps for it every month, but the merge loop has nowhere to apply
    // them, so the data never reaches the UI. This typically means the
    // curated PROFILES entry was renamed or removed and the override
    // wasn't cleaned up — see the orphan warning below.
    if (!target && patch) orphanOverrideIsins.push(isin);
    continue;
  }
  if (patch.topHoldings && patch.topHoldings.length > 0) {
    target.topHoldings = patch.topHoldings;
  }
  if (patch.topHoldingsAsOf) {
    target.topHoldingsAsOf = patch.topHoldingsAsOf;
  }
  if (patch.geo && Object.keys(patch.geo).length > 0) {
    target.geo = patch.geo;
  }
  if (patch.sector && Object.keys(patch.sector).length > 0) {
    target.sector = patch.sector;
  }
  if (patch.currency && Object.keys(patch.currency).length > 0) {
    target.currency = patch.currency;
  }
  if (patch.breakdownsAsOf) {
    target.breakdownsAsOf = patch.breakdownsAsOf;
  }
}

// Fold pool entries (added via the admin "Look-through data pool" UI
// AND via scripts/scrape-popular-etfs-pool.mjs for the orphan-instrument
// bulk-add) into PROFILES as brand-new entries.
//
// Minimum required: geo + sector. topHoldings is optional — justETF only
// publishes a top-holdings table for equity ETFs; bond / commodity /
// synthetic ETFs return valid geo+sector but no holdings. Without this
// relaxation the runtime would silently drop ~14 bond ETFs whose pool
// JSON looks valid but lacks the holdings list. (See
// scripts/scrape-popular-etfs-pool.mjs `buildPoolEntry` for the
// matching writer-side gate.)
//
// Currency falls back to {} when omitted (rare — derived at the api-server
// scrape lib via deriveCurrencyFromGeo).
//
// `isEquity` defaults to true for backward compatibility with pre-Task-#127
// admin-pool entries (which were all equity ETFs). Bond / money-market /
// inflation-linked entries written by the popular-ETFs scraper carry
// `isEquity:false` so analyzeLookthrough routes them to the fixed-income
// geo path (line ~849 — gated by `e.assetClass === "Fixed Income"`)
// rather than polluting equity geo/sector cards. Sector is captured but
// not currently consumed for fixed income — that's correct, bonds don't
// have stock sectors.
// Task #238 round 6 — defensive name-based isEquity inference. The
// monthly refresh + admin backfill writers SHOULD set `isEquity:false`
// for bond / money-market / commodity entries, but some legacy
// backfill rows landed without that flag (see the bond ETFs added on
// 2026-05-10 — LU0378818131, IE00BG47KH54, etc.). If the entry's
// `name` contains an obvious fixed-income / commodity keyword and
// `isEquity` was not explicitly set, we override the default-true
// fallback to `false` so analyzeLookthrough routes the position to
// the fixed-income geo path instead of polluting equity geo/sector
// cards. Curated PROFILES entries skip this loop entirely
// (`if (PROFILES[isin]) continue;`), so this heuristic only applies
// to pool-loaded rows.
const BOND_NAME_HINT =
  /\b(bond|aggregate|treasury|gilts?|bund|btp|oat|govie|corporate\s+credit|high\s+yield|inflation[- ]?linked|tips|money\s+market|t-?bill)\b/i;
const COMMODITY_NAME_HINT =
  /\b(gold|silver|platinum|palladium|oil|brent|wti|natural\s+gas|copper|commodit|wheat|corn)\b/i;
function inferIsEquityFromName(
  isin: string,
  entry: LookthroughOverride & { name?: string },
): boolean {
  if (typeof entry.isEquity === "boolean") return entry.isEquity;
  const name = typeof entry.name === "string" ? entry.name : "";
  if (BOND_NAME_HINT.test(name) || COMMODITY_NAME_HINT.test(name)) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        `[lookthrough] Pool entry ${isin} ("${name}") is missing explicit isEquity. ` +
          `Inferred isEquity:false from the name keyword. Set isEquity:false in ` +
          `lookthrough.overrides.json to silence this warning.`,
      );
    }
    return false;
  }
  return true;
}

for (const [isin, entry] of Object.entries(RAW_LOOKTHROUGH_POOL)) {
  if (!entry) continue;
  if (PROFILES[isin]) continue; // a curated profile takes precedence
  const hasMinimum =
    entry.geo &&
    Object.keys(entry.geo).length > 0 &&
    entry.sector &&
    Object.keys(entry.sector).length > 0;
  if (!hasMinimum) continue;
  PROFILES[isin] = {
    isEquity: inferIsEquityFromName(isin, entry),
    geo: entry.geo!,
    sector: entry.sector!,
    currency: entry.currency ?? {},
    topHoldings: entry.topHoldings,
    topHoldingsAsOf: entry.topHoldingsAsOf,
    breakdownsAsOf: entry.breakdownsAsOf,
  };
}

// Surface orphan overrides (ISINs the refresh job is still writing for, but
// that no longer have a curated profile to merge onto). Exported so the
// monthly refresh action's CI test step can read it back via the test in
// tests/lookthrough-overrides.test.ts and surface the names in the workflow
// log — see .github/workflows/refresh-lookthrough.yml.
export function getOrphanOverrideIsins(): string[] {
  return [...orphanOverrideIsins];
}

if (orphanOverrideIsins.length > 0) {
  // Single batched warning so each test run / dev server boot prints one
  // line, not N. Names every orphan ISIN so the maintainer can decide
  // whether to restore the curated profile or delete the stale override.
  console.warn(
    `[lookthrough] ${orphanOverrideIsins.length} override ISIN(s) in lookthrough.overrides.json have no matching curated profile in PROFILES — their refreshed holdings/breakdowns will never reach the UI: ${orphanOverrideIsins.join(", ")}. ` +
      `If a curated ISIN was renamed or removed, either restore the PROFILES entry or delete the orphan override.`
  );
}

// ---------------------------------------------------------------------------
// Raw look-through-key getters (Task #122 — unify ETF master list and
// look-through pool). Exposed for validateCatalog() in etfs.ts so the
// catalog validator can enforce the structural invariant
//
//   ∀ ISIN ∈ pool ∪ overrides:  ISIN ∈ INSTRUMENTS
//
// without lookthrough.ts having to import INSTRUMENTS itself (which would
// re-trigger the curated PROFILES merge loop on every test that mocks the
// JSON file). Returning fresh arrays keeps the JSON keys read-only from
// the validator's perspective.
// ---------------------------------------------------------------------------
const POOL_ISIN_KEYS: string[] = Object.keys(RAW_LOOKTHROUGH_POOL);
const OVERRIDE_ISIN_KEYS: string[] = Object.keys(RAW_LOOKTHROUGH_OVERRIDES);
export function getLookthroughPoolIsins(): string[] {
  return [...POOL_ISIN_KEYS];
}
export function getLookthroughOverrideIsins(): string[] {
  return [...OVERRIDE_ISIN_KEYS];
}

// Task #238 — runtime registry for on-demand-scraped profiles.
// When the user pastes a manual ISIN in Explain that the catalog
// doesn't ship a profile for, ExplainPortfolio fires a public
// /api/lookthrough-scrape/:isin call and registers the result here
// so the next buildLookthrough sees a usable profile and the
// destructive "unmapped ETFs" alert clears for that row.
//
// Task #238 round 8 — runtime profiles are now ALSO persisted to
// `window.localStorage` under RUNTIME_LT_STORAGE_KEY so an off-catalog
// scrape result survives reload within the same browser session. This
// addresses the "off-catalog scrape must persist" durability concern
// without adding a public-route write to the canonical pool overrides
// (which the round-4 reviewer correctly flagged as an admin-boundary
// bypass — public users have no admin token, and persisting via the
// public route would let any unauthenticated caller mutate the
// curated catalog). The localStorage cache is per-browser, per-ISIN,
// non-authoritative: the canonical pool overrides remain the single
// source of truth that everyone's app loads from disk; localStorage
// only patches in user-typed off-catalog rows that the central pool
// doesn't cover yet. Operators can still promote an ISIN to the
// canonical pool via the admin add-flows.
const RUNTIME_PROFILES: Record<string, LookthroughProfile> = {};
const RUNTIME_LT_STORAGE_KEY = "investment-lab.lookthrough.runtime.v1";

// Subscription mechanism so React components can re-read `profileFor`
// after a successful runtime scrape registers a new off-catalog profile.
// Without this, a `useMemo` in a component (e.g. useEtfInfo's `pool`
// computation) would observe RUNTIME_PROFILES *before* the on-demand
// scrape resolves and stay stuck on the stale `null` for the rest of
// the row's lifetime — even though the geo / sector cards already
// populated correctly. That is exactly the misleading "no look-through
// data" notice the operator reported on 2026-05.
let runtimeVersion = 0;
const runtimeListeners = new Set<() => void>();

function bumpRuntimeVersion(): void {
  runtimeVersion += 1;
  for (const l of runtimeListeners) {
    try {
      l();
    } catch {
      // Listener errors must not block other subscribers or the
      // register/clear caller. Silent by design.
    }
  }
}

export function getRuntimeLookthroughVersion(): number {
  return runtimeVersion;
}

export function subscribeRuntimeLookthrough(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => {
    runtimeListeners.delete(listener);
  };
}

function hasLocalStorage(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !==
      "undefined"
  );
}

function persistRuntimeProfiles(): void {
  if (!hasLocalStorage()) return;
  try {
    (globalThis as { localStorage: Storage }).localStorage.setItem(
      RUNTIME_LT_STORAGE_KEY,
      JSON.stringify(RUNTIME_PROFILES),
    );
  } catch {
    // Quota / SecurityError (private browsing). The runtime registry
    // still works in-memory for the current tab; we just lose the
    // reload-survival benefit. Silent by design — not actionable.
  }
}

function hydrateRuntimeProfiles(): void {
  if (!hasLocalStorage()) return;
  try {
    const raw = (globalThis as { localStorage: Storage }).localStorage.getItem(
      RUNTIME_LT_STORAGE_KEY,
    );
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [isin, profile] of Object.entries(parsed)) {
      if (
        profile &&
        typeof profile === "object" &&
        typeof (profile as LookthroughProfile).isEquity === "boolean" &&
        (profile as LookthroughProfile).geo &&
        (profile as LookthroughProfile).sector
      ) {
        RUNTIME_PROFILES[isin.toUpperCase()] = profile as LookthroughProfile;
      }
    }
  } catch {
    // Corrupt JSON or unexpected shape — drop the cache silently and
    // let the user re-trigger the scrape. Not a security boundary.
  }
}
hydrateRuntimeProfiles();

export function registerRuntimeLookthroughProfile(
  isin: string,
  profile: LookthroughProfile,
): void {
  if (!isin) return;
  RUNTIME_PROFILES[isin.toUpperCase()] = profile;
  persistRuntimeProfiles();
  bumpRuntimeVersion();
}

export function clearRuntimeLookthroughProfiles(): void {
  for (const k of Object.keys(RUNTIME_PROFILES)) delete RUNTIME_PROFILES[k];
  if (hasLocalStorage()) {
    try {
      (globalThis as { localStorage: Storage }).localStorage.removeItem(
        RUNTIME_LT_STORAGE_KEY,
      );
    } catch {
      // see persistRuntimeProfiles — silent on storage errors.
    }
  }
  bumpRuntimeVersion();
}

export function profileFor(isin: string): LookthroughProfile | null {
  // Task #238 — strict per-ISIN lookup. No alias / sibling fallback.
  // Every catalog ISIN must own a profile entry in PROFILES (curated
  // primaries, SHARED_BASKET_PROFILES variants, or DISTINCT_PROFILES);
  // off-catalog manual ISINs land in RUNTIME_PROFILES via the
  // on-demand scrape path.
  return PROFILES[isin] ?? RUNTIME_PROFILES[isin.toUpperCase()] ?? null;
}

function isHedged(etf: ETFImplementation): boolean {
  if (HEDGED_ISINS.has(etf.isin)) return true;
  // Fallback heuristic for any catalog additions that don't get added to the set above.
  return /Hedged/i.test(etf.exampleETF);
}

function addInto(target: ExposureMap, source: ExposureMap, weight: number) {
  for (const [k, v] of Object.entries(source)) {
    target[k] = (target[k] ?? 0) + (v * weight) / 100;
  }
}

function normaliseTo100(map: ExposureMap): ExposureMap {
  const sum = Object.values(map).reduce((a, b) => a + b, 0);
  if (sum <= 0) return map;
  const out: ExposureMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = (v / sum) * 100;
  return out;
}

function sortDesc(map: ExposureMap): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

export interface CurrencyRow {
  currency: string;
  pctOfPortfolio: number;
  hedgedPct: number;
  unhedgedPct: number;
}

export interface CurrencyOverview {
  rows: CurrencyRow[];
  hedgedShareOfPortfolio: number;
  unmappedWeight: number;
  baseCurrency: string;
}

export interface UnmappedEtfRow {
  // Always upper-cased ISIN of the position the look-through engine
  // could not aggregate. The pair {isin, weight} is the actionable
  // bit — the operator/user needs to know which ETF dropped out and
  // how much portfolio weight it carried so they can decide whether
  // to fix it (admin: scrape the look-through profile) or live with
  // the gap (it's a tiny satellite).
  isin: string;
  name: string;
  weight: number;
}

export interface LookthroughResult {
  equityWeightTotal: number;
  fixedIncomeWeightTotal: number;
  otherWeightTotal: number;
  geoEquity: Array<[string, number]>;
  sectorEquity: Array<[string, number]>;
  geoFixedIncome: Array<[string, number]>;
  topConcentrations: Array<{ name: string; pctOfPortfolio: number; source: string }>;
  // Legacy human-readable strings (kept for backward compat with the
  // observations list and any test that still consumes it).
  unmapped: string[];
  // Task #238 — structured loud-fail. Replaces the silent observation
  // footnote with a per-row record the UI can render as a prominent
  // alert and the test suite can assert against.
  unmappedEtfs: UnmappedEtfRow[];
  observations: string[];
  currencyOverview: CurrencyOverview;
}

/** Runtime bucket strings on `ETFImplementation.bucket` are formed as
 *  `${assetClass} - ${region}` (see `lib/manualWeights.ts.bucketKey`).
 *  These constants mirror the two buckets that get re-routed to a
 *  synthetic currency row by `buildCurrencyOverview`. Keep the spaces. */
const GOLD_BUCKET = "Commodities - Gold";
const EM_EQUITY_BUCKET = "Equity - EM";

/** Synthetic row labels surfaced in the currency overview. Intentionally
 *  not localised — they live alongside raw ISO currency codes like USD /
 *  EUR which we also render verbatim in both languages. Exported so
 *  tests and downstream renderers can reference them by name. */
export const XAU_GOLD_KEY = "XAU (Gold)";
export const EM_CURRENCIES_KEY = "EM Currencies";

function buildCurrencyOverview(
  etfs: ETFImplementation[],
  baseCurrency: string,
  useLookThroughCurrency: boolean = true
): CurrencyOverview {
  const hedgedMap: ExposureMap = {};
  const unhedgedMap: ExposureMap = {};
  let hedgedShare = 0;
  let unmapped = 0;

  for (const e of etfs) {
    // Hedged sleeve is handled first and unconditionally: after hedging,
    // FX exposure is fully neutralised to the share-class currency, so
    // we never need a curated underlying-currency profile here. This
    // also guarantees that flipping the look-through toggle leaves the
    // hedged share of the portfolio unchanged.
    if (isHedged(e)) {
      const target = e.currency || baseCurrency;
      hedgedMap[target] = (hedgedMap[target] ?? 0) + e.weight;
      hedgedShare += e.weight;
      continue;
    }

    // Synthetic bucket #1 — Gold (both modes). Physical-gold ETCs are
    // globally priced in USD but they are not USD currency exposure;
    // surfacing them under their own "XAU (Gold)" row keeps the USD
    // line honest in both look-through and ETF-only views. Detected by
    // bucket equality on the runtime "Commodities - Gold" string (note
    // the spaces — the ETFImplementation bucket is built as
    // `${assetClass} - ${region}`, not the catalog key "Commodities-Gold").
    if (e.bucket === GOLD_BUCKET) {
      unhedgedMap[XAU_GOLD_KEY] = (unhedgedMap[XAU_GOLD_KEY] ?? 0) + e.weight;
      continue;
    }

    const p = profileFor(e.isin);
    if (useLookThroughCurrency) {
      if (!p) {
        // No curated profile → cannot decompose the underlying currencies,
        // so the weight is reported as "unmapped" in look-through mode.
        unmapped += e.weight;
        continue;
      }
      // Look-through ON: split the unhedged weight across the curated
      // breakdown of underlying currencies (so an unhedged MSCI World USD
      // ETF contributes USD + EUR + JPY + GBP + CHF + ... in the right
      // proportions). EM ETFs intentionally fall through here so the
      // curated CNY / INR / TWD / KRW / ... split is preserved when
      // look-through is on; only the no-look-through branch below
      // re-routes EM equity to the synthetic "EM Currencies" bucket.
      addInto(unhedgedMap, p.currency, e.weight);
    } else {
      // Synthetic bucket #2 — EM equity in no-look-through mode only.
      // Without look-through, the EM IMI / FTSE EM / Xtrackers EM
      // share-class currency (USD) would otherwise inflate USD with
      // weight that is really CNY/INR/TWD/KRW/.../etc exposure. Group
      // it under one honest synthetic bucket so the table reads true
      // even with look-through off. We deliberately do NOT do this in
      // the look-through branch above, where the curated per-country
      // split is the more informative answer.
      if (e.bucket === EM_EQUITY_BUCKET) {
        unhedgedMap[EM_CURRENCIES_KEY] =
          (unhedgedMap[EM_CURRENCIES_KEY] ?? 0) + e.weight;
        continue;
      }
      // Look-through OFF (default branch): count the full unhedged
      // weight as the ETF's own share-class currency. No split — this
      // is the "ETF currency only" view that the per-side toggle
      // exposes in Build and Compare. We fall back to baseCurrency only
      // if the share-class currency is missing, so weight is never
      // silently dropped.
      const target = e.currency || baseCurrency;
      unhedgedMap[target] = (unhedgedMap[target] ?? 0) + e.weight;
    }
  }

  const combined: Record<string, { hedged: number; unhedged: number }> = {};
  for (const [k, v] of Object.entries(hedgedMap)) {
    combined[k] = combined[k] || { hedged: 0, unhedged: 0 };
    combined[k].hedged += v;
  }
  for (const [k, v] of Object.entries(unhedgedMap)) {
    combined[k] = combined[k] || { hedged: 0, unhedged: 0 };
    combined[k].unhedged += v;
  }

  const rows: CurrencyRow[] = Object.entries(combined)
    .map(([currency, v]) => ({
      currency,
      hedgedPct: v.hedged,
      unhedgedPct: v.unhedged,
      pctOfPortfolio: v.hedged + v.unhedged,
    }))
    .sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio);

  return {
    rows,
    hedgedShareOfPortfolio: hedgedShare,
    unmappedWeight: unmapped,
    baseCurrency,
  };
}

export function buildLookthrough(
  etfs: ETFImplementation[],
  lang: "en" | "de" = "en",
  baseCurrency: string = "USD",
  options: { useLookThroughCurrency?: boolean } = {}
): LookthroughResult {
  const useLookThroughCurrency = options.useLookThroughCurrency ?? true;
  const de = lang === "de";
  let equityWeightTotal = 0;
  let fixedIncomeWeightTotal = 0;
  let otherWeightTotal = 0;

  const geoEq: ExposureMap = {};
  const sectorEq: ExposureMap = {};
  const geoFi: ExposureMap = {};
  const stockMap: Record<string, { pct: number; sources: Set<string> }> = {};
  const unmapped: string[] = [];
  const unmappedEtfs: UnmappedEtfRow[] = [];

  for (const e of etfs) {
    const p = profileFor(e.isin);
    if (!p) {
      unmapped.push(`${e.exampleETF} (${e.isin})`);
      unmappedEtfs.push({
        isin: e.isin.toUpperCase(),
        name: e.exampleETF,
        weight: e.weight,
      });
      continue;
    }
    if (p.isEquity) {
      equityWeightTotal += e.weight;
      addInto(geoEq, p.geo, e.weight);
      addInto(sectorEq, p.sector, e.weight);
    } else if (e.assetClass === "Fixed Income") {
      fixedIncomeWeightTotal += e.weight;
      addInto(geoFi, p.geo, e.weight);
    } else {
      otherWeightTotal += e.weight;
    }
    if (p.topHoldings && p.isEquity) {
      for (const h of p.topHoldings) {
        const portfolioPct = (h.pct * e.weight) / 100;
        if (stockMap[h.name]) {
          stockMap[h.name].pct += portfolioPct;
          stockMap[h.name].sources.add(e.exampleETF);
        } else {
          stockMap[h.name] = { pct: portfolioPct, sources: new Set([e.exampleETF]) };
        }
      }
    }
  }

  const geoEquity = sortDesc(normaliseTo100(geoEq));
  const sectorEquity = sortDesc(normaliseTo100(sectorEq));
  const geoFixedIncome = sortDesc(normaliseTo100(geoFi));

  const topConcentrations = Object.entries(stockMap)
    .map(([name, v]) => ({
      name,
      pctOfPortfolio: v.pct,
      source: Array.from(v.sources).join(", "),
    }))
    .sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio)
    .slice(0, 10);

  const observations: string[] = [];
  if (geoEquity.length > 0 && geoEquity[0][1] >= 60) {
    observations.push(
      de
        ? `Geografische Konzentration: ${geoEquity[0][0]} macht ${geoEquity[0][1].toFixed(0)}% des Aktienanteils aus — typisch bei US-lastigen Welt-Indizes wie dem S&P 500 oder MSCI World.`
        : `Geographic concentration: ${geoEquity[0][0]} represents ${geoEquity[0][1].toFixed(0)}% of the equity sleeve — typical for US-heavy global indices such as the S&P 500 or MSCI World.`
    );
  }
  const tech = sectorEquity.find(([k]) => k === "Technology");
  if (tech && tech[1] >= 25) {
    observations.push(
      de
        ? `Sektor-Konzentration: Technologie macht ${tech[1].toFixed(0)}% des Aktienanteils aus, oft getrieben durch wenige Mega-Caps (Apple, Microsoft, Nvidia, Alphabet, Meta).`
        : `Sector concentration: Technology accounts for ${tech[1].toFixed(0)}% of equity exposure, typically driven by a handful of mega-caps (Apple, Microsoft, Nvidia, Alphabet, Meta).`
    );
  }
  if (topConcentrations.length > 0 && topConcentrations[0].pctOfPortfolio >= 2) {
    const t = topConcentrations[0];
    observations.push(
      de
        ? `Einzeltitelrisiko: ${t.name} entspricht etwa ${t.pctOfPortfolio.toFixed(1)}% des Gesamtportfolios durch Look-Through über die ausgewählten ETFs.`
        : `Single-stock exposure: ${t.name} represents approximately ${t.pctOfPortfolio.toFixed(1)}% of the total portfolio on a look-through basis across the selected ETFs.`
    );
  }
  if (
    sectorEquity.find(([k]) => k === "Technology") &&
    geoEquity.find(([k]) => k === "United States" && (geoEquity[0]?.[1] ?? 0) >= 50)
  ) {
    const techWeight = sectorEquity.find(([k]) => k === "Technology")?.[1] ?? 0;
    if (techWeight >= 30) {
      observations.push(
        de
          ? `Überlappung: Eine US-Allokation kombiniert mit einem expliziten Technologie-Tilt verstärkt das Engagement in denselben Mega-Cap-Tech-Aktien — der Look-Through zeigt die wahre, nicht-additive Konzentration.`
          : `Overlap: a US allocation combined with an explicit Technology tilt amplifies exposure to the same mega-cap tech names — the look-through shows the true, non-additive concentration.`
      );
    }
  }
  if (unmapped.length > 0) {
    // Task #238: be explicit. The destructive "unmapped ETFs" alert
    // above the look-through card is the canonical surface — this
    // observation just nudges the operator to look at it. Older copy
    // ("treated as broad diversified equity or excluded") understated
    // the gap; under Task #238 unmapped positions are NOT silently
    // folded into any aggregate.
    observations.push(
      de
        ? `Achtung: ${unmapped.length} Position(en) haben kein Look-through-Profil und sind aus der Geo-/Sektor-/Einzeltitel-Aggregation ausgenommen. Siehe destruktive Warnung über dieser Karte für ISIN-Liste und Behebung.`
        : `Heads-up: ${unmapped.length} position(s) have no look-through profile and are EXCLUDED from the geo / sector / single-stock aggregates. See the destructive alert above this card for the ISIN list and how to fix it.`
    );
  }
  if (observations.length === 0) {
    observations.push(
      de
        ? "Keine signifikanten Konzentrations- oder Überlappungsmuster im Look-Through erkannt."
        : "No significant concentration or overlap patterns detected on a look-through basis."
    );
  }

  const currencyOverview = buildCurrencyOverview(etfs, baseCurrency, useLookThroughCurrency);

  return {
    equityWeightTotal,
    fixedIncomeWeightTotal,
    otherWeightTotal,
    geoEquity,
    sectorEquity,
    geoFixedIncome,
    topConcentrations,
    unmapped,
    unmappedEtfs,
    observations,
    currencyOverview,
  };
}
