// Aggregate the lookthrough equity geography into the 6 display regions:
// NA, Europe, UK (only if base=GBP), Switzerland (only if base=CHF), Japan, EM.
// Country names match the TopoJSON `properties.name` values from world-atlas.
//
// Note (Task #298, 2026-05): the country sets below are kept in 1:1 sync
// with the engine's `COUNTRY_TO_EQUITY_KEY` table in `metrics.ts`. Any
// country the engine routes to an `equity_*` bucket must also have a
// region assignment here, and the disagreements that existed before
// Task #298 (Poland / Greece / Hungary / Czechia in Europe on the map
// but routed to `equity_em` by the engine; Ireland and APAC-developed
// landing in "Other / Residual") are removed. The drift-guard test in
// `tests/engine.test.ts` asserts that every key of
// `COUNTRY_TO_EQUITY_KEY` resolves to a non-`"Other"` region here.

import { BaseCurrency } from "./types";

export type RegionKey = "NA" | "Europe" | "UK" | "Switzerland" | "Japan" | "EM";

const NA_COUNTRIES = new Set(["United States of America", "Canada"]);

// Continental Europe + UK + Switzerland + Ireland (Task #298, 2026-05).
// Mirrors `COUNTRY_TO_EQUITY_KEY` in metrics.ts: every developed
// European country routed to `equity_eu` (or to its own `equity_uk` /
// `equity_ch` bucket) is also classified as "Europe" here. Poland,
// Greece, Hungary, Czechia and Czech Republic moved to EM (see below).
const EUROPE_COUNTRIES = new Set([
  "United Kingdom", "France", "Germany", "Switzerland", "Netherlands", "Italy",
  "Spain", "Sweden", "Denmark", "Belgium", "Norway", "Finland",
  "Austria", "Portugal", "Ireland",
  "Luxembourg", "Iceland", "Slovakia", "Slovenia", "Romania",
  "Bulgaria", "Croatia", "Lithuania", "Latvia", "Estonia",
]);

// Full MSCI EM constituent set, mirroring `equity_em` in metrics.ts
// (Task #298, 2026-05). Poland, Greece, Hungary, Czechia and Czech
// Republic are EM here — MSCI reclassified Poland in 2018 and Greece
// in 2013; the engine has been treating all four as `equity_em` since
// Task #294, the geomap was the last piece holding the old MSCI Europe
// classification.
const EM_COUNTRIES = new Set([
  "China", "India", "Taiwan", "South Korea", "Brazil", "Saudi Arabia",
  "South Africa", "Mexico", "Indonesia", "Thailand", "Malaysia",
  "United Arab Emirates", "Qatar", "Kuwait", "Egypt", "Turkey",
  "Chile", "Colombia", "Peru", "Philippines", "Vietnam",
  "Poland", "Greece", "Hungary", "Czechia", "Czech Republic",
]);

const JAPAN_COUNTRIES = new Set(["Japan"]);

// Asia-Pacific developed ex-Japan (Task #298, 2026-05). The engine has
// no separate `equity_apxj` CMA bucket and routes these countries to
// `equity_jp` as the closest developed-Asia proxy; the geomap follows
// suit by classifying them as the "Japan" RegionKey (i.e. they get the
// Japan colour on the choropleth and their weight is added to the Japan
// legend tile, which is now labelled "Japan + Asia-Pacific").
const APAC_COUNTRIES = new Set([
  "Australia", "Hong Kong", "Singapore", "New Zealand",
]);

// Distribution of aggregate buckets by REGION (not country).
// Values are %; they sum to ~100 for the bucket.
const REGION_BUCKETS: Record<string, Partial<Record<RegionKey | "Other", number>>> = {
  Europe:        { Europe: 100 },
  "Europe ex-UK": { Europe: 100 },
  Eurozone:      { Europe: 100 },
  // Engine-aliases for the same continental-EU concept (Task #298 follow-up,
  // 2026-05). The engine routes "Other Europe" / "Other EU" → equity_eu;
  // mirror that here so the drift-guard test passes and so any upstream
  // profile carrying these labels is honoured by the geomap.
  "Other Europe": { Europe: 100 },
  "Other EU":     { Europe: 100 },
  EM:            { EM: 100 },
  "EM (IG)":     { EM: 100 },
  "Other EM":    { EM: 100 },
  // Note: aggregate "Other DM" and "Other" labels from upstream profile
  // data are intentionally NOT split into NA/Europe/EM here (Task #241,
  // 2026-05). Pre-2026-05 we silently re-routed e.g. 28 % of an "Other DM"
  // slice into NA — that quietly inflated North-America exposure on the
  // Look-Through map for global-developed funds whose justETF profile
  // already aggregates everything past the top ~10 countries into one
  // "Other" bucket. They now fall through to classifyCountry → "Other"
  // and are surfaced honestly via `otherPct` (and the dedicated "Other /
  // Residual" legend tile in GeoExposureMap).
};

// Map raw country names from profile data to TopoJSON canonical names.
const COUNTRY_ALIAS: Record<string, string> = {
  "United States": "United States of America",
  // Engine-side aliases for EM countries (Task #298, 2026-05) so a
  // profile listing "UAE" or "USA" classifies the same way as the
  // canonical TopoJSON name.
  "USA": "United States of America",
  "UAE": "United Arab Emirates",
};

const SKIP_KEYS = new Set([
  "Physical Gold (LBMA, London)",
  "Gold Bullion",
]);

export function classifyCountry(
  topoName: string,
  baseCurrency: BaseCurrency,
): RegionKey | "Other" {
  if (NA_COUNTRIES.has(topoName)) return "NA";
  if (JAPAN_COUNTRIES.has(topoName)) return "Japan";
  if (APAC_COUNTRIES.has(topoName)) return "Japan";
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
  // Per-region list of countries that actually contributed non-zero
  // weight, with their pct. Used by the legend tiles to (a) display a
  // truthful country-by-country tooltip and (b) drive the dynamic
  // `regionLabel(...)` qualifier (e.g. "Japan + Asia-Pacific" only
  // when an APAC-developed country is genuinely in the look-through;
  // plain "Japan" otherwise).
  regionCountries: Record<RegionKey, Array<{ country: string; pct: number }>>;
  // Per-region break-down rolled in from aggregate buckets ("Europe",
  // "EM", …) where the upstream profile lumps multiple countries into
  // a single row. Surfaced in the tile tooltip so the user can see
  // "from aggregate Europe row: 12.3%" alongside the country list.
  regionAggregates: Record<RegionKey, number>;
}

export function buildRegionWeights(
  geoEquity: Array<[string, number]>,
  baseCurrency: BaseCurrency,
): RegionWeights {
  const weights: Record<RegionKey, number> = {
    NA: 0, Europe: 0, UK: 0, Switzerland: 0, Japan: 0, EM: 0,
  };
  const regionAggregates: Record<RegionKey, number> = {
    NA: 0, Europe: 0, UK: 0, Switzerland: 0, Japan: 0, EM: 0,
  };
  // Per-region accumulator of country → pct. We aggregate by country
  // name (not raw row label) so multiple raw rows for the same country
  // collapse into a single tooltip entry.
  const regionCountriesMap: Record<RegionKey, Map<string, number>> = {
    NA: new Map(), Europe: new Map(), UK: new Map(),
    Switzerland: new Map(), Japan: new Map(), EM: new Map(),
  };
  let otherPct = 0;

  const addToRegion = (
    region: RegionKey | "Other",
    pct: number,
    country: string | null,
  ) => {
    if (region === "Other") {
      otherPct += pct;
      return;
    }
    let target: RegionKey = region;
    if (region === "UK" && baseCurrency !== "GBP") target = "Europe";
    else if (region === "Switzerland" && baseCurrency !== "CHF") target = "Europe";
    weights[target] += pct;
    if (country) {
      regionCountriesMap[target].set(
        country,
        (regionCountriesMap[target].get(country) ?? 0) + pct,
      );
    } else {
      regionAggregates[target] += pct;
    }
  };

  for (const [rawName, pct] of geoEquity) {
    if (!pct || SKIP_KEYS.has(rawName)) continue;

    const bucket = REGION_BUCKETS[rawName];
    if (bucket) {
      const total = Object.values(bucket).reduce((a, b) => a + (b ?? 0), 0);
      for (const [region, weight] of Object.entries(bucket)) {
        if (!weight) continue;
        addToRegion(region as RegionKey | "Other", (pct * weight) / total, null);
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
      addToRegion(region, pct, region === "Other" ? null : topoName);
    }
  }

  const regionCountries: Record<RegionKey, Array<{ country: string; pct: number }>> = {
    NA: [], Europe: [], UK: [], Switzerland: [], Japan: [], EM: [],
  };
  for (const r of Object.keys(regionCountriesMap) as RegionKey[]) {
    regionCountries[r] = Array.from(regionCountriesMap[r].entries())
      .map(([country, pct]) => ({ country, pct }))
      .sort((a, b) => b.pct - a.pct);
  }

  // Build the country-to-region lookup for the choropleth.
  const countryToRegion = new Map<string, RegionKey>();
  for (const c of NA_COUNTRIES) countryToRegion.set(c, "NA");
  for (const c of JAPAN_COUNTRIES) countryToRegion.set(c, "Japan");
  for (const c of APAC_COUNTRIES) countryToRegion.set(c, "Japan");
  for (const c of EUROPE_COUNTRIES) countryToRegion.set(c, "Europe");
  for (const c of EM_COUNTRIES) countryToRegion.set(c, "EM");
  if (baseCurrency === "GBP") countryToRegion.set("United Kingdom", "UK");
  if (baseCurrency === "CHF") countryToRegion.set("Switzerland", "Switzerland");

  return { weights, otherPct, countryToRegion, regionCountries, regionAggregates };
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

// Reflect-reality labelling (Task #298 follow-up, 2026-05): the Japan
// tile is widened to "Japan + Asia-Pacific" ONLY when an APAC-developed
// proxy country (Australia, Hong Kong, Singapore, New Zealand) actually
// shows up in the look-through. A pure Japan-only ETF/portfolio (or one
// where no APAC country has non-zero pct) keeps the plain "Japan"
// label so the legend never implies coverage that isn't there. All
// other regions use a single fixed label.
export function regionLabel(
  region: RegionKey,
  lang: "en" | "de",
  presentCountries?: ReadonlyArray<{ country: string }>,
): string {
  if (region === "Japan") {
    const hasApac = (presentCountries ?? []).some((c) => APAC_COUNTRIES.has(c.country));
    if (presentCountries && !hasApac) {
      return lang === "de" ? "Japan" : "Japan";
    }
    return lang === "de" ? "Japan + Asien-Pazifik" : "Japan + Asia-Pacific";
  }
  const en: Record<Exclude<RegionKey, "Japan">, string> = {
    NA: "North America",
    Europe: "Europe",
    UK: "United Kingdom",
    Switzerland: "Switzerland",
    EM: "Emerging Markets",
  };
  const de: Record<Exclude<RegionKey, "Japan">, string> = {
    NA: "Nordamerika",
    Europe: "Europa",
    UK: "Vereinigtes Königreich",
    Switzerland: "Schweiz",
    EM: "Schwellenländer",
  };
  return (lang === "de" ? de : en)[region];
}

// Re-export the country sets so the GeoExposureMap tile tooltip and
// the unit tests can reason about region membership without
// duplicating the list.
export { APAC_COUNTRIES };
