// Aggregate the lookthrough equity geography into the 6 display regions:
// NA, Europe, UK (only if base=GBP), Switzerland (only if base=CHF), Japan, EM.
// Country names match the TopoJSON `properties.name` values from world-atlas.

import { BaseCurrency } from "./types";

export type RegionKey = "NA" | "Europe" | "UK" | "Switzerland" | "Japan" | "EM";

const NA_COUNTRIES = new Set(["United States of America", "Canada"]);

const EUROPE_COUNTRIES = new Set([
  "United Kingdom", "France", "Germany", "Switzerland", "Netherlands", "Italy",
  "Spain", "Sweden", "Denmark", "Belgium", "Norway", "Finland", "Ireland",
  "Austria", "Portugal", "Poland", "Greece", "Czechia", "Czech Republic",
  "Hungary", "Luxembourg", "Iceland", "Slovakia", "Slovenia", "Romania",
  "Bulgaria", "Croatia", "Lithuania", "Latvia", "Estonia",
]);

// Only the largest MSCI EM index constituents — together ~90% of EM index weight.
const EM_COUNTRIES = new Set([
  "China", "India", "Taiwan", "South Korea", "Brazil", "Saudi Arabia",
  "South Africa", "Mexico",
]);

const JAPAN_COUNTRIES = new Set(["Japan"]);

// Distribution of aggregate buckets by REGION (not country).
// Values are %; they sum to ~100 for the bucket.
const REGION_BUCKETS: Record<string, Partial<Record<RegionKey | "Other", number>>> = {
  Europe:        { Europe: 100 },
  "Europe ex-UK": { Europe: 100 },
  Eurozone:      { Europe: 100 },
  EM:            { EM: 100 },
  "EM (IG)":     { EM: 100 },
  // Other DM ~ Australia 30, Canada 28, HK 14, Singapore 10, Israel 8, Norway 5, NZ 3, Ireland 2
  "Other DM":    { NA: 28, Europe: 7, Other: 65 },
  Other:         { NA: 14, Europe: 4, EM: 35, Other: 47 },
};

// Map raw country names from profile data to TopoJSON canonical names.
const COUNTRY_ALIAS: Record<string, string> = {
  "United States": "United States of America",
};

const SKIP_KEYS = new Set([
  "Physical Gold (LBMA, London)",
  "Gold Bullion",
]);

function classifyCountry(
  topoName: string,
  baseCurrency: BaseCurrency,
): RegionKey | "Other" {
  if (NA_COUNTRIES.has(topoName)) return "NA";
  if (JAPAN_COUNTRIES.has(topoName)) return "Japan";
  if (topoName === "United Kingdom" && baseCurrency === "GBP") return "UK";
  if (topoName === "Switzerland" && baseCurrency === "CHF") return "Switzerland";
  if (EUROPE_COUNTRIES.has(topoName)) return "Europe";
  if (EM_COUNTRIES.has(topoName)) return "EM";
  return "Other";
}

export interface RegionWeights {
  weights: Record<RegionKey, number>;
  otherPct: number;
  // Country → region used for choropleth fill. Only the 6 active regions.
  countryToRegion: Map<string, RegionKey>;
}

export function buildRegionWeights(
  geoEquity: Array<[string, number]>,
  baseCurrency: BaseCurrency,
): RegionWeights {
  const weights: Record<RegionKey, number> = {
    NA: 0, Europe: 0, UK: 0, Switzerland: 0, Japan: 0, EM: 0,
  };
  let otherPct = 0;

  const addToRegion = (region: RegionKey | "Other", pct: number) => {
    if (region === "Other") {
      otherPct += pct;
    } else if (region === "UK" && baseCurrency !== "GBP") {
      weights.Europe += pct;
    } else if (region === "Switzerland" && baseCurrency !== "CHF") {
      weights.Europe += pct;
    } else {
      weights[region] += pct;
    }
  };

  for (const [rawName, pct] of geoEquity) {
    if (!pct || SKIP_KEYS.has(rawName)) continue;

    const bucket = REGION_BUCKETS[rawName];
    if (bucket) {
      const total = Object.values(bucket).reduce((a, b) => a + (b ?? 0), 0);
      for (const [region, weight] of Object.entries(bucket)) {
        if (!weight) continue;
        addToRegion(region as RegionKey | "Other", (pct * weight) / total);
      }
      // For aggregate Europe buckets, when base=GBP we want a piece in UK.
      // Approximate UK share of MSCI Europe ≈ 22%; Europe ex-UK has 0.
      if (baseCurrency === "GBP" && (rawName === "Europe")) {
        const ukShare = pct * 0.22;
        weights.Europe -= ukShare;
        weights.UK += ukShare;
      }
      // For aggregate Europe buckets, when base=CHF we want a piece in Switzerland.
      // Approximate Switzerland share of MSCI Europe ≈ 14%, Europe ex-UK ≈ 18%.
      if (baseCurrency === "CHF") {
        const chShare = rawName === "Europe" ? pct * 0.14
                      : rawName === "Europe ex-UK" ? pct * 0.18 : 0;
        if (chShare > 0) {
          weights.Europe -= chShare;
          weights.Switzerland += chShare;
        }
      }
    } else {
      const topoName = COUNTRY_ALIAS[rawName] ?? rawName;
      const region = classifyCountry(topoName, baseCurrency);
      addToRegion(region, pct);
    }
  }

  // Build the country-to-region lookup for the choropleth.
  const countryToRegion = new Map<string, RegionKey>();
  for (const c of NA_COUNTRIES) countryToRegion.set(c, "NA");
  for (const c of JAPAN_COUNTRIES) countryToRegion.set(c, "Japan");
  for (const c of EUROPE_COUNTRIES) countryToRegion.set(c, "Europe");
  for (const c of EM_COUNTRIES) countryToRegion.set(c, "EM");
  if (baseCurrency === "GBP") countryToRegion.set("United Kingdom", "UK");
  if (baseCurrency === "CHF") countryToRegion.set("Switzerland", "Switzerland");

  return { weights, otherPct, countryToRegion };
}

// One distinct base color per region; opacity is scaled by the region's weight
// so heavier regions look darker.
export const REGION_COLORS: Record<RegionKey, string> = {
  NA: "#1d4ed8",
  Europe: "#0891b2",
  UK: "#7c3aed",
  Switzerland: "#dc2626",
  Japan: "#db2777",
  EM: "#16a34a",
};

export function regionFill(
  region: RegionKey,
  pct: number,
  maxPct: number,
): string {
  const base = REGION_COLORS[region];
  // Scale opacity from 0.25 (low weight) to 1.0 (top region).
  const norm = maxPct > 0 ? Math.min(1, pct / maxPct) : 0;
  const opacity = 0.25 + 0.75 * norm;
  return hexWithOpacity(base, opacity);
}

function hexWithOpacity(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
}

export function regionLabel(region: RegionKey, lang: "en" | "de"): string {
  const en: Record<RegionKey, string> = {
    NA: "North America",
    Europe: "Europe",
    UK: "United Kingdom",
    Switzerland: "Switzerland",
    Japan: "Japan",
    EM: "Emerging Markets",
  };
  const de: Record<RegionKey, string> = {
    NA: "Nordamerika",
    Europe: "Europa",
    UK: "Vereinigtes Königreich",
    Switzerland: "Schweiz",
    Japan: "Japan",
    EM: "Schwellenländer",
  };
  return (lang === "de" ? de : en)[region];
}
