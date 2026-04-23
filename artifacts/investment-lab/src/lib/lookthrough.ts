import { ETFImplementation } from "./types";

export type ExposureMap = Record<string, number>;

export interface LookthroughProfile {
  isEquity: boolean;
  geo: ExposureMap;
  sector: ExposureMap;
  currency: ExposureMap;
  topHoldings?: Array<{ name: string; pct: number }>;
}

// Reference date for the look-through data set below. Surfaced in the UI so users
// know exactly how stale the underlying weights may be relative to live factsheets.
export const LOOKTHROUGH_REFERENCE_DATE = "Q4 2024";

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

// Synonym ISINs that share the same underlying basket
const ALIAS: Record<string, string> = {
  "IE00B3YCGJ38": "IE00B5BMR087", // Invesco S&P 500 Synthetic
  "IE00BCRY6557": "IE00B5BMR087", // S&P 500 EUR Hedged
  "IE00BYX5MS15": "IE00B5BMR087", // S&P 500 GBP Hedged
  "IE00B3ZW0K18": "IE00B5BMR087", // S&P 500 CHF Hedged variant slot
  "IE00BDBRDM35": "IE00B3F81409", // Global Agg EUR Hedged
  "IE00BDBRDN42": "IE00B3F81409", // Global Agg CHF Hedged
  "IE00BDBRDP65": "IE00B3F81409", // Global Agg GBP Hedged
};

// ISINs that represent currency-hedged share classes — for these the FX exposure
// after hedging is the share-class currency, not the underlying currency map.
const HEDGED_ISINS = new Set<string>([
  "IE00BCRY6557",
  "IE00BYX5MS15",
  "IE00B3ZW0K18",
  "IE00BDBRDM35",
  "IE00BDBRDN42",
  "IE00BDBRDP65",
]);

export function profileFor(isin: string): LookthroughProfile | null {
  const key = ALIAS[isin] ?? isin;
  return PROFILES[key] ?? null;
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

export interface LookthroughResult {
  equityWeightTotal: number;
  fixedIncomeWeightTotal: number;
  otherWeightTotal: number;
  geoEquity: Array<[string, number]>;
  sectorEquity: Array<[string, number]>;
  geoFixedIncome: Array<[string, number]>;
  topConcentrations: Array<{ name: string; pctOfPortfolio: number; source: string }>;
  unmapped: string[];
  observations: string[];
  currencyOverview: CurrencyOverview;
}

function buildCurrencyOverview(
  etfs: ETFImplementation[],
  baseCurrency: string
): CurrencyOverview {
  const hedgedMap: ExposureMap = {};
  const unhedgedMap: ExposureMap = {};
  let hedgedShare = 0;
  let unmapped = 0;

  for (const e of etfs) {
    const p = profileFor(e.isin);
    if (!p) {
      unmapped += e.weight;
      continue;
    }
    if (isHedged(e)) {
      // After hedging, FX exposure is the share-class currency (typically the base ccy).
      const target = e.currency || baseCurrency;
      hedgedMap[target] = (hedgedMap[target] ?? 0) + e.weight;
      hedgedShare += e.weight;
    } else {
      addInto(unhedgedMap, p.currency, e.weight);
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
  baseCurrency: string = "USD"
): LookthroughResult {
  const de = lang === "de";
  let equityWeightTotal = 0;
  let fixedIncomeWeightTotal = 0;
  let otherWeightTotal = 0;

  const geoEq: ExposureMap = {};
  const sectorEq: ExposureMap = {};
  const geoFi: ExposureMap = {};
  const stockMap: Record<string, { pct: number; sources: Set<string> }> = {};
  const unmapped: string[] = [];

  for (const e of etfs) {
    const p = profileFor(e.isin);
    if (!p) {
      unmapped.push(`${e.exampleETF} (${e.isin})`);
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
    observations.push(
      de
        ? `Hinweis: Für ${unmapped.length} Position(en) liegen keine Look-Through-Daten vor — sie wurden in der Aggregation pauschal als "${equityWeightTotal > 0 ? "Aktien-Diversifiziert" : "Sonstige"}" behandelt oder ausgelassen.`
        : `Note: ${unmapped.length} position(s) had no look-through data available — they were treated as broad ${equityWeightTotal > 0 ? "diversified equity" : "other"} or excluded from aggregation.`
    );
  }
  if (observations.length === 0) {
    observations.push(
      de
        ? "Keine signifikanten Konzentrations- oder Überlappungsmuster im Look-Through erkannt."
        : "No significant concentration or overlap patterns detected on a look-through basis."
    );
  }

  const currencyOverview = buildCurrencyOverview(etfs, baseCurrency);

  return {
    equityWeightTotal,
    fixedIncomeWeightTotal,
    otherWeightTotal,
    geoEquity,
    sectorEquity,
    geoFixedIncome,
    topConcentrations,
    unmapped,
    observations,
    currencyOverview,
  };
}
