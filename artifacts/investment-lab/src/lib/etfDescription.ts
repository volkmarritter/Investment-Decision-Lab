// ----------------------------------------------------------------------------
// etfDescription — deterministic, template-based 2–3 sentence description for
// ETFs that have no curated `comment` in the catalog.
// ----------------------------------------------------------------------------
//
// Why this exists: catalog ETFs (etfs.ts) carry a hand-written `comment`, but
// look-through-only ETFs (auto-fetched from justETF and added to the
// look-through pool, e.g. IE00BM67HT60) only have a name + a holdings table.
// When the operator opens such an ETF in the look-through dialog or the
// Build-tab ETF details popup, there is currently no human-readable
// description — they have to recognise the fund from its name or guess what
// it does from the holdings.
//
// We don't call an LLM here. The look-through profile already contains the
// signal needed (geo, sector, currency, top holdings); a deterministic
// template turns that into a 2–3 sentence summary that fills the gap.
//
// The curated `comment` in etfs.ts always wins — this helper is a fallback,
// not a replacement, and the consuming UI should mark its output as
// "auto-generated" so the operator can tell at a glance.
// ----------------------------------------------------------------------------

import type { LookthroughProfile } from "./lookthrough";

export interface ETFDescriptionInput {
  name: string;
  profile: LookthroughProfile | null;
  catalog?: {
    domicile?: string;
    distribution?: string;
    currency?: string;
  };
}

export interface ETFDescription {
  de: string;
  en: string;
}

// Geo / sector buckets that aggregate "everything else". They are useful in
// the table view (the rows still sum to ~100%) but uninformative as a
// "leading exposure" — saying "concentrated in Other (12%)" reads as a bug.
// We strip them out before picking the dominant entries.
function isAggregateBucket(label: string): boolean {
  const l = label.trim().toLowerCase();
  return (
    l === "other" ||
    l === "other dm" ||
    l === "other em" ||
    l.startsWith("other ")
  );
}

// Returns entries sorted by pct desc, with aggregate buckets stripped and any
// zero / negative values removed. The original map is not mutated.
function rankedEntries(
  map: Record<string, number> | undefined,
): Array<[string, number]> {
  if (!map) return [];
  return Object.entries(map)
    .filter(([k, v]) => v > 0 && !isAggregateBucket(k))
    .sort((a, b) => b[1] - a[1]);
}

// Format a percentage to one decimal place, trimming a trailing ".0" to keep
// the prose tidy ("57%" reads better than "57.0%" in a sentence).
function fmtPct(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

// English Oxford-comma list joiner: ["A","B","C"] -> "A, B and C".
function joinEn(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// German list joiner: ["A","B","C"] -> "A, B und C".
function joinDe(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} und ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

// Concentration thresholds — picked so a 95%-US S&P 500 fund reads as
// "concentrated in the United States" while a 57%-US ACWI fund reads as
// "with the largest weights in the United States, Japan and the UK".
const REGION_DOMINANT = 60;
const SECTOR_DOMINANT = 40;
const SECTOR_LEADING = 25;

// English country / region label translation. Most labels in the look-through
// data are already English country names so this is a small map of the few
// cases where the catalog uses an abbreviation. For unmapped labels we pass
// the original through unchanged.
const COUNTRY_DE: Record<string, string> = {
  "United States": "USA",
  "United Kingdom": "Großbritannien",
  Japan: "Japan",
  China: "China",
  "South Korea": "Südkorea",
  Taiwan: "Taiwan",
  India: "Indien",
  Switzerland: "Schweiz",
  France: "Frankreich",
  Germany: "Deutschland",
  Netherlands: "Niederlande",
  Canada: "Kanada",
  Australia: "Australien",
  Spain: "Spanien",
  Sweden: "Schweden",
  Italy: "Italien",
  Brazil: "Brasilien",
  "South Africa": "Südafrika",
  "Saudi Arabia": "Saudi-Arabien",
  Mexico: "Mexiko",
  "Hong Kong": "Hongkong",
  Belgium: "Belgien",
  Denmark: "Dänemark",
  Finland: "Finnland",
  Ireland: "Irland",
};

// Sector label translations. Same idea: most labels in the data are already
// English; we cover the common ones. Unmapped sectors fall through unchanged.
const SECTOR_DE: Record<string, string> = {
  Technology: "Technologie",
  Financials: "Finanzwerte",
  "Health Care": "Gesundheitswesen",
  Healthcare: "Gesundheitswesen",
  Industrials: "Industrie",
  "Cons. Discretionary": "zyklischer Konsum",
  "Consumer Discretionary": "zyklischer Konsum",
  "Cons. Staples": "Basiskonsumgüter",
  "Consumer Staples": "Basiskonsumgüter",
  "Communication Svcs": "Kommunikationsdienste",
  Telecommunication: "Telekommunikation",
  Energy: "Energie",
  Materials: "Grundstoffe",
  "Basic Materials": "Grundstoffe",
  Utilities: "Versorger",
  "Real Estate": "Immobilien",
};

function deCountry(label: string): string {
  return COUNTRY_DE[label] ?? label;
}
function deSector(label: string): string {
  return SECTOR_DE[label] ?? label;
}

// Build the region-exposure phrase. Returns a `{ de, en }` fragment that
// fits inside the first sentence ("... concentrated in X (NN%)" /
// "... with the largest weights in A, B and C" / "... broadly diversified
// across regions"). Returns null when the geo map is empty / non-informative.
function regionPhrase(
  geo: Record<string, number> | undefined,
): { de: string; en: string } | null {
  const entries = rankedEntries(geo);
  if (entries.length === 0) return null;
  const [topLabel, topPct] = entries[0];
  if (topPct >= REGION_DOMINANT) {
    return {
      en: `concentrated in ${topLabel} (${fmtPct(topPct)})`,
      de: `konzentriert auf ${deCountry(topLabel)} (${fmtPct(topPct)})`,
    };
  }
  const top = entries.slice(0, 3);
  const sumTop = top.reduce((a, [, v]) => a + v, 0);
  if (sumTop < 30) {
    return {
      en: "broadly diversified across regions",
      de: "breit über Regionen gestreut",
    };
  }
  const en = joinEn(top.map(([k, v]) => `${k} (${fmtPct(v)})`));
  const de = joinDe(top.map(([k, v]) => `${deCountry(k)} (${fmtPct(v)})`));
  return {
    en: `with the largest weights in ${en}`,
    de: `mit den größten Gewichten in ${de}`,
  };
}

// Build the sector-exposure phrase for equity ETFs. Returns null when the
// sector map is empty (we don't claim "broad multi-sector" without data —
// silence is more honest).
function sectorPhrase(
  sector: Record<string, number> | undefined,
): { de: string; en: string } | null {
  const entries = rankedEntries(sector);
  if (entries.length === 0) return null;
  const [topLabel, topPct] = entries[0];
  if (topPct >= SECTOR_DOMINANT) {
    return {
      en: `dominated by ${topLabel} (${fmtPct(topPct)})`,
      de: `dominiert von ${deSector(topLabel)} (${fmtPct(topPct)})`,
    };
  }
  if (topPct >= SECTOR_LEADING) {
    const top = entries.slice(0, 3);
    const en = joinEn(top.map(([k, v]) => `${k} (${fmtPct(v)})`));
    const de = joinDe(top.map(([k, v]) => `${deSector(k)} (${fmtPct(v)})`));
    return {
      en: `led by ${en}`,
      de: `angeführt von ${de}`,
    };
  }
  return {
    en: "spans a broad multi-sector mix",
    de: "deckt einen breiten Mehrsektoren-Mix ab",
  };
}

// Pick the top 3 holdings (by pct) for the optional third sentence. Returns
// null when there aren't at least 3 entries — a 1- or 2-name list reads as
// noise once the sector + geo prose has already named the same exposures.
function holdingsPhrase(
  topHoldings: Array<{ name: string; pct: number }> | undefined,
): { de: string; en: string } | null {
  if (!topHoldings || topHoldings.length < 3) return null;
  const top = [...topHoldings].sort((a, b) => b.pct - a.pct).slice(0, 3);
  const en = joinEn(top.map((h) => h.name));
  const de = joinDe(top.map((h) => h.name));
  return {
    en: `Largest single-name exposures include ${en}.`,
    de: `Die größten Einzelpositionen sind ${de}.`,
  };
}

// Public helper. Returns null when there isn't enough structured data to say
// anything useful: no profile at all, or a profile whose geo AND sector maps
// are both empty (e.g. a brand-new pool entry that only has a name + ISIN).
export function describeEtf(input: ETFDescriptionInput): ETFDescription | null {
  const { profile } = input;
  if (!profile) return null;

  const geoEntries = rankedEntries(profile.geo);
  const sectorEntries = rankedEntries(profile.sector);
  if (geoEntries.length === 0 && sectorEntries.length === 0) return null;

  // Lead noun: equity vs non-equity. "Fixed-income" is a strong claim we
  // only make when isEquity is explicitly false AND the sector map is empty
  // (sector data is equity-only in the look-through model). Anything else
  // falls back to the neutral "ETF".
  const isEquity = profile.isEquity === true;
  const isFixedIncome =
    profile.isEquity === false && sectorEntries.length === 0;

  const distRaw = (input.catalog?.distribution ?? "").toLowerCase();
  const isAccumulating = distRaw === "accumulating";
  const isDistributing = distRaw === "distributing";

  // First-word qualifier. "Accumulating equity ETF ..." reads naturally and
  // adds 1 word of signal that the FactCell grid (only present in the Build
  // dialog) duplicates. The look-through dialog has no such grid, so this
  // qualifier earns its keep there.
  const distEn = isAccumulating
    ? "accumulating "
    : isDistributing
      ? "distributing "
      : "";
  const distDe = isAccumulating
    ? "thesaurierender "
    : isDistributing
      ? "ausschüttender "
      : "";

  const nounEn = isEquity
    ? "equity ETF"
    : isFixedIncome
      ? "fixed-income ETF"
      : "ETF";
  const nounDe = isEquity
    ? "Aktien-ETF"
    : isFixedIncome
      ? "Renten-ETF"
      : "ETF";

  // Capitalise the first letter of the lead noun phrase when no qualifier is
  // present (otherwise the qualifier already starts the sentence with a
  // lowercase word, which we then capitalise below).
  const leadEn = `${distEn}${nounEn}`;
  const leadDe = `${distDe}${nounDe}`;
  const capEn = leadEn.charAt(0).toUpperCase() + leadEn.slice(1);
  const capDe = leadDe.charAt(0).toUpperCase() + leadDe.slice(1);

  const region = regionPhrase(profile.geo);

  // Sentence 1: lead noun + region phrase. If we have no region phrase but
  // do have sector data, fall back to a sector-led sentence so we still
  // produce something useful.
  let sentence1En: string;
  let sentence1De: string;
  if (region) {
    sentence1En = `${capEn} ${region.en}.`;
    sentence1De = `${capDe} ${region.de}.`;
  } else {
    // No usable geo data — produce a region-free lead that the sector
    // sentence below will follow on from. We still need *some* sentence.
    sentence1En = `${capEn} with no dominant regional exposure.`;
    sentence1De = `${capDe} ohne dominante regionale Allokation.`;
  }

  // Sentence 2: sector phrase, equity ETFs only. Bonds + commodities are
  // categorised differently and the sector map is typically empty there.
  const sentences: { en: string[]; de: string[] } = {
    en: [sentence1En],
    de: [sentence1De],
  };
  if (isEquity) {
    const sector = sectorPhrase(profile.sector);
    if (sector) {
      sentences.en.push(`The portfolio is ${sector.en}.`);
      sentences.de.push(`Das Portfolio ist ${sector.de}.`);
    }
  }

  // Sentence 3 (optional): top holdings.
  const holdings = holdingsPhrase(profile.topHoldings);
  if (holdings) {
    sentences.en.push(holdings.en);
    sentences.de.push(holdings.de);
  }

  return {
    en: sentences.en.join(" "),
    de: sentences.de.join(" "),
  };
}
