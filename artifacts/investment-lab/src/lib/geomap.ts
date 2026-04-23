// Maps lookthrough geoEquity buckets to country-level effective exposure weights
// keyed by the country names used in the world-atlas TopoJSON (countries-110m).

const REGION_SPLITS: Record<string, Record<string, number>> = {
  Europe: {
    "United Kingdom": 22,
    France: 17,
    Germany: 15,
    Switzerland: 14,
    Netherlands: 9,
    Italy: 7,
    Spain: 6,
    Sweden: 5,
    Denmark: 3,
    Belgium: 2,
  },
  "Europe ex-UK": {
    France: 22,
    Germany: 19,
    Switzerland: 18,
    Netherlands: 11,
    Italy: 9,
    Spain: 8,
    Sweden: 6,
    Denmark: 4,
    Belgium: 3,
  },
  Eurozone: {
    France: 25,
    Germany: 28,
    Netherlands: 12,
    Italy: 12,
    Spain: 10,
    Belgium: 5,
    Ireland: 4,
    Finland: 4,
  },
  EM: {
    China: 28,
    India: 20,
    Taiwan: 18,
    "South Korea": 11,
    Brazil: 5,
    "Saudi Arabia": 4,
    "South Africa": 3,
    Mexico: 3,
    Thailand: 2,
    Indonesia: 2,
    "United Arab Emirates": 2,
    Malaysia: 2,
  },
  "EM (IG)": {
    China: 30,
    "South Korea": 15,
    Mexico: 10,
    Indonesia: 8,
    Brazil: 8,
    "Saudi Arabia": 7,
    Malaysia: 6,
    Thailand: 6,
    "United Arab Emirates": 5,
    Poland: 5,
  },
  "Other DM": {
    Australia: 30,
    Canada: 28,
    "Hong Kong S.A.R.": 14,
    Singapore: 10,
    Israel: 8,
    Norway: 5,
    "New Zealand": 3,
    Ireland: 2,
  },
  Other: {
    Australia: 18,
    Canada: 18,
    China: 14,
    India: 8,
    "Hong Kong S.A.R.": 8,
    Singapore: 6,
    Israel: 6,
    Brazil: 4,
    Taiwan: 6,
    "South Korea": 6,
    Mexico: 3,
    "South Africa": 3,
  },
};

// Map our internal country names to TopoJSON `properties.name` values.
const COUNTRY_ALIAS: Record<string, string> = {
  "United States": "United States of America",
  "South Korea": "South Korea",
  "Hong Kong": "Hong Kong S.A.R.",
};

const SKIP_KEYS = new Set([
  "Physical Gold (LBMA, London)",
  "Gold Bullion",
]);

export interface CountryWeight {
  name: string; // matches TopoJSON properties.name
  pct: number; // share of equity sleeve (0-100)
}

export function buildCountryWeights(
  geoEquity: Array<[string, number]>,
): { countries: CountryWeight[]; unallocatedPct: number } {
  const acc = new Map<string, number>();
  let unallocated = 0;

  for (const [rawName, pct] of geoEquity) {
    if (!pct || SKIP_KEYS.has(rawName)) continue;
    const split = REGION_SPLITS[rawName];
    if (split) {
      const total = Object.values(split).reduce((a, b) => a + b, 0);
      for (const [country, weight] of Object.entries(split)) {
        const allocated = (pct * weight) / total;
        acc.set(country, (acc.get(country) ?? 0) + allocated);
      }
    } else {
      const mapped = COUNTRY_ALIAS[rawName] ?? rawName;
      acc.set(mapped, (acc.get(mapped) ?? 0) + pct);
    }
  }

  const countries: CountryWeight[] = Array.from(acc.entries())
    .map(([name, pct]) => ({ name, pct }))
    .sort((a, b) => b.pct - a.pct);

  return { countries, unallocatedPct: unallocated };
}

// Color thresholds for the choropleth (% of equity sleeve).
export const COLOR_STOPS: Array<{ max: number; fill: string; label: string }> = [
  { max: 0.5, fill: "hsl(var(--muted))", label: "< 0.5%" },
  { max: 2, fill: "#dbeafe", label: "0.5–2%" },
  { max: 5, fill: "#93c5fd", label: "2–5%" },
  { max: 10, fill: "#3b82f6", label: "5–10%" },
  { max: 25, fill: "#1d4ed8", label: "10–25%" },
  { max: 100, fill: "#172554", label: "> 25%" },
];

export function colorFor(pct: number): string {
  for (const stop of COLOR_STOPS) {
    if (pct < stop.max) return stop.fill;
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].fill;
}
