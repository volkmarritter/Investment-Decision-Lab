import { ETFImplementation } from "./types";

export type ExposureMap = Record<string, number>;

export interface LookthroughProfile {
  isEquity: boolean;
  geo: ExposureMap;
  sector: ExposureMap;
  topHoldings?: Array<{ name: string; pct: number }>;
}

const EQUAL_EQUITY_FALLBACK_GEO: ExposureMap = { Global: 100 };
const EQUAL_EQUITY_FALLBACK_SECTOR: ExposureMap = { Diversified: 100 };

const PROFILES: Record<string, LookthroughProfile> = {
  // S&P 500 (physical, synthetic and all hedged variants share the same underlying basket)
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
    topHoldings: [
      { name: "Apple", pct: 7 },
      { name: "Microsoft", pct: 7 },
      { name: "Nvidia", pct: 6 },
      { name: "Amazon", pct: 4 },
      { name: "Alphabet (A+C)", pct: 4 },
      { name: "Meta", pct: 3 },
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
  },
  // SPI (Swiss Performance Index) – very concentrated
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
    topHoldings: [
      { name: "Nestlé", pct: 19 },
      { name: "Roche", pct: 16 },
      { name: "Novartis", pct: 14 },
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
    topHoldings: [
      { name: "TSMC", pct: 9 },
      { name: "Tencent", pct: 4 },
      { name: "Samsung Electronics", pct: 3 },
    ],
  },
  // S&P 500 Information Technology Sector
  "IE00B3WJKG14": {
    isEquity: true,
    geo: { "United States": 100 },
    sector: { "Technology": 100 },
    topHoldings: [
      { name: "Apple", pct: 17 },
      { name: "Microsoft", pct: 17 },
      { name: "Nvidia", pct: 15 },
      { name: "Broadcom", pct: 5 },
    ],
  },
  // Healthcare Innovation
  "IE00BYZK4776": {
    isEquity: true,
    geo: { "United States": 60, "Europe": 18, "Japan": 8, "Other DM": 10, "EM": 4 },
    sector: { "Health Care": 100 },
  },
  // Clean Energy
  "IE00B1XNHC34": {
    isEquity: true,
    geo: { "United States": 40, "China": 14, "Europe": 28, "Other": 18 },
    sector: { "Utilities": 35, "Industrials": 30, "Technology": 25, "Materials": 10 },
  },
  // Cybersecurity
  "IE00BG0J4C88": {
    isEquity: true,
    geo: { "United States": 75, "Israel": 10, "Europe": 8, "Other": 7 },
    sector: { "Technology": 90, "Industrials": 10 },
  },
  // Global Aggregate Bond
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
  },
  // Gold ETC
  "IE00B579F325": {
    isEquity: false,
    geo: { "Physical Gold (LBMA, London)": 100 },
    sector: { "Gold Bullion": 100 },
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
  },
  // Bitcoin ETP
  "GB00BLD4ZL17": {
    isEquity: false,
    geo: { "Global (Decentralised)": 100 },
    sector: { "Bitcoin": 100 },
  },
};

// Synonym ISINs that share the same underlying basket (e.g. hedged share classes, synthetic variants)
const ALIAS: Record<string, string> = {
  "IE00B3YCGJ38": "IE00B5BMR087", // Invesco S&P 500 Synthetic
  "IE00BCRY6557": "IE00B5BMR087", // S&P 500 EUR Hedged
  "IE00BYX5MS15": "IE00B5BMR087", // S&P 500 GBP Hedged
  "IE00BDBRDM35": "IE00B3F81409", // Global Agg EUR Hedged
  "IE00BDBRDN42": "IE00B3F81409", // Global Agg CHF Hedged
  "IE00BDBRDP65": "IE00B3F81409", // Global Agg GBP Hedged
};
// IE00B3ZW0K18 is reused as a placeholder for the USA hedged variants in the catalog;
// route it to the S&P 500 underlying as well.
ALIAS["IE00B3ZW0K18"] = "IE00B5BMR087";

function profileFor(isin: string): LookthroughProfile | null {
  const key = ALIAS[isin] ?? isin;
  return PROFILES[key] ?? null;
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
}

export function buildLookthrough(
  etfs: ETFImplementation[],
  lang: "en" | "de" = "en"
): LookthroughResult {
  const de = lang === "de";
  let equityWeightTotal = 0;
  let fixedIncomeWeightTotal = 0;
  let otherWeightTotal = 0;

  const geoEq: ExposureMap = {};
  const sectorEq: ExposureMap = {};
  const geoFi: ExposureMap = {};
  const stockMap: Record<string, { pct: number; source: string }> = {};
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
    if (p.topHoldings) {
      for (const h of p.topHoldings) {
        const portfolioPct = (h.pct * e.weight) / 100;
        if (stockMap[h.name]) {
          stockMap[h.name].pct += portfolioPct;
          stockMap[h.name].source = `${stockMap[h.name].source}, ${e.exampleETF}`;
        } else {
          stockMap[h.name] = { pct: portfolioPct, source: e.exampleETF };
        }
      }
    }
  }

  const geoEquity = sortDesc(normaliseTo100(geoEq));
  const sectorEquity = sortDesc(normaliseTo100(sectorEq));
  const geoFixedIncome = sortDesc(normaliseTo100(geoFi));

  const topConcentrations = Object.entries(stockMap)
    .map(([name, v]) => ({ name, pctOfPortfolio: v.pct, source: v.source }))
    .filter((x) => x.pctOfPortfolio >= 0.5)
    .sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio)
    .slice(0, 8);

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
    // Combined US + Tech overlap
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

  // Suppress unused-variable warning from fallback maps (kept for clarity / future use)
  void EQUAL_EQUITY_FALLBACK_GEO;
  void EQUAL_EQUITY_FALLBACK_SECTOR;

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
  };
}
