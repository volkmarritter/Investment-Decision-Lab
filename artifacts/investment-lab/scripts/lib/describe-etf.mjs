// ----------------------------------------------------------------------------
// describe-etf.mjs — Node port of src/lib/etfDescription.ts
// ----------------------------------------------------------------------------
// Task #207 — the auto-backfill needs the same deterministic 2-3 sentence
// summary that the runtime UI falls back to. Importing the TS source from
// a Node script would require a build step or a TS loader; instead this
// module mirrors the algorithm 1:1. The pair is covered by an
// equivalence test (`tests/describeEtfNodePort.test.ts`) that asserts
// both implementations produce byte-identical output for a representative
// set of profiles, so a refactor of either side is caught immediately.
//
// Keep this file in sync with src/lib/etfDescription.ts.
// ----------------------------------------------------------------------------

const REGION_DOMINANT = 60;
const SECTOR_DOMINANT = 40;
const SECTOR_LEADING = 25;

const COUNTRY_DE = {
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

const SECTOR_DE = {
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

const isAggregateBucket = (label) => {
  const l = String(label).trim().toLowerCase();
  return (
    l === "other" ||
    l === "other dm" ||
    l === "other em" ||
    l.startsWith("other ")
  );
};

const rankedEntries = (map) => {
  if (!map) return [];
  return Object.entries(map)
    .filter(([k, v]) => v > 0 && !isAggregateBucket(k))
    .sort((a, b) => b[1] - a[1]);
};

const fmtPct = (v) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`;
};

const joinEn = (items) => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

const joinDe = (items) => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} und ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
};

const deCountry = (l) => COUNTRY_DE[l] ?? l;
const deSector = (l) => SECTOR_DE[l] ?? l;

function regionPhrase(geo) {
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

function sectorPhrase(sector) {
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
    return { en: `led by ${en}`, de: `angeführt von ${de}` };
  }
  return {
    en: "spans a broad multi-sector mix",
    de: "deckt einen breiten Mehrsektoren-Mix ab",
  };
}

function holdingsPhrase(topHoldings) {
  if (!topHoldings || topHoldings.length < 3) return null;
  const top = [...topHoldings].sort((a, b) => b.pct - a.pct).slice(0, 3);
  const en = joinEn(top.map((h) => h.name));
  const de = joinDe(top.map((h) => h.name));
  return {
    en: `Largest single-name exposures include ${en}.`,
    de: `Die größten Einzelpositionen sind ${de}.`,
  };
}

export function describeEtf(input) {
  const { profile } = input;
  if (!profile) return null;

  const geoEntries = rankedEntries(profile.geo);
  const sectorEntries = rankedEntries(profile.sector);
  if (geoEntries.length === 0 && sectorEntries.length === 0) return null;

  const isEquity = profile.isEquity === true;
  const isFixedIncome =
    profile.isEquity === false && sectorEntries.length === 0;

  const distRaw = String(input.catalog?.distribution ?? "").toLowerCase();
  const isAccumulating = distRaw === "accumulating";
  const isDistributing = distRaw === "distributing";

  const distEn = isAccumulating ? "accumulating " : isDistributing ? "distributing " : "";
  const distDe = isAccumulating ? "thesaurierender " : isDistributing ? "ausschüttender " : "";

  const nounEn = isEquity ? "equity ETF" : isFixedIncome ? "fixed-income ETF" : "ETF";
  const nounDe = isEquity ? "Aktien-ETF" : isFixedIncome ? "Renten-ETF" : "ETF";

  const leadEn = `${distEn}${nounEn}`;
  const leadDe = `${distDe}${nounDe}`;
  const capEn = leadEn.charAt(0).toUpperCase() + leadEn.slice(1);
  const capDe = leadDe.charAt(0).toUpperCase() + leadDe.slice(1);

  const region = regionPhrase(profile.geo);

  let s1En, s1De;
  if (region) {
    s1En = `${capEn} ${region.en}.`;
    s1De = `${capDe} ${region.de}.`;
  } else {
    s1En = `${capEn} with no dominant regional exposure.`;
    s1De = `${capDe} ohne dominante regionale Allokation.`;
  }

  const sentences = { en: [s1En], de: [s1De] };
  if (isEquity) {
    const sec = sectorPhrase(profile.sector);
    if (sec) {
      sentences.en.push(`The portfolio is ${sec.en}.`);
      sentences.de.push(`Das Portfolio ist ${sec.de}.`);
    }
  }
  const holdings = holdingsPhrase(profile.topHoldings);
  if (holdings) {
    sentences.en.push(holdings.en);
    sentences.de.push(holdings.de);
  }

  return { en: sentences.en.join(" "), de: sentences.de.join(" ") };
}
