// Tests for the deterministic ETF description helper.
//
// The helper feeds the look-through dialog and the Build-tab ETF details
// popup with a 2–3 sentence summary whenever the catalog row has no curated
// `comment`. Because the same template runs in production for every
// look-through-only ETF, regressions here directly land in user-facing prose
// (typos, wrong concentration thresholds, dropped sentence). These tests pin
// the contract: shape (length, sentence count), content (top region/sector
// surfaced, top holdings appended), DE/EN parity, and the null-on-no-data
// fallback.
import { describe, it, expect } from "vitest";
import { describeEtf } from "@/lib/etfDescription";
import type { LookthroughProfile } from "@/lib/lookthrough";

// Shape of the Xtrackers MSCI World Information Technology fund
// (IE00BM67HT60) — the canonical "look-through-only, sector-concentrated"
// case from the task description. Numbers are simplified but mirror the
// real profile: heavy US weight, dominant Technology sector.
const TECH_PROFILE: LookthroughProfile = {
  isEquity: true,
  geo: {
    "United States": 78,
    Japan: 4,
    Taiwan: 4,
    Netherlands: 3,
    Other: 11,
  },
  sector: {
    Technology: 88,
    "Telecommunication": 6,
    Industrials: 4,
    Other: 2,
  },
  currency: { USD: 78, JPY: 4, TWD: 4, EUR: 3, Other: 11 },
  topHoldings: [
    { name: "NVIDIA Corp.", pct: 12.4 },
    { name: "Apple", pct: 11.1 },
    { name: "Microsoft", pct: 9.7 },
    { name: "Broadcom Inc.", pct: 4.2 },
    { name: "Taiwan Semiconductor Manufacturing Co., Ltd.", pct: 3.8 },
  ],
};

// Shape of a broad world equity ETF (MSCI World / ACWI style): no single
// sector dominates, no single country dominates beyond the US.
const WORLD_PROFILE: LookthroughProfile = {
  isEquity: true,
  geo: {
    "United States": 57,
    Japan: 6,
    "United Kingdom": 4,
    France: 3,
    Switzerland: 3,
    Germany: 2,
    Other: 25,
  },
  sector: {
    Technology: 25,
    Financials: 15,
    Industrials: 12,
    "Cons. Discretionary": 10,
    "Health Care": 9,
    "Communication Svcs": 8,
    Other: 21,
  },
  currency: { USD: 57, EUR: 8, JPY: 6, GBP: 4, Other: 25 },
  topHoldings: [
    { name: "Apple", pct: 4.3 },
    { name: "Microsoft", pct: 4.2 },
    { name: "NVIDIA", pct: 3.8 },
  ],
};

// Shape of a global aggregate bond ETF: isEquity false, sector map empty
// (sector breakdowns are equity-only in the look-through model).
const BOND_PROFILE: LookthroughProfile = {
  isEquity: false,
  geo: {
    "United States": 45,
    Japan: 12,
    France: 7,
    Germany: 6,
    "United Kingdom": 5,
    Other: 25,
  },
  sector: {},
  currency: { USD: 45, EUR: 20, JPY: 12, GBP: 5, Other: 18 },
};

// Profile with no usable structured data — geo + sector both empty. The
// helper should return null rather than emit a vacuous "ETF with no
// dominant exposure." sentence.
const EMPTY_PROFILE: LookthroughProfile = {
  isEquity: true,
  geo: {},
  sector: {},
  currency: {},
};

describe("describeEtf — sector-concentrated equity ETF", () => {
  const out = describeEtf({
    name: "Xtrackers MSCI World Information Technology UCITS ETF 1C",
    profile: TECH_PROFILE,
  });

  it("returns a non-null description", () => {
    expect(out).not.toBeNull();
  });

  it("English version surfaces the dominant sector with its percentage", () => {
    expect(out!.en).toMatch(/Technology/);
    expect(out!.en).toMatch(/88%/);
  });

  it("English version surfaces the dominant region (United States, ≥60%)", () => {
    // US is 78%, above the REGION_DOMINANT (60) threshold, so the prose
    // should call it "concentrated in" rather than listing top-3 regions.
    expect(out!.en).toMatch(/concentrated in United States/);
    expect(out!.en).toMatch(/78%/);
  });

  it("appends the top-3 single-name holdings as the third sentence", () => {
    expect(out!.en).toMatch(/NVIDIA Corp\./);
    expect(out!.en).toMatch(/Apple/);
    expect(out!.en).toMatch(/Microsoft/);
  });

  it("emits exactly 3 sentences (lead, sector, holdings)", () => {
    // Split on ". " so we don't double-count the trailing period.
    const sentences = out!.en.split(/\.\s+/).filter((s) => s.trim());
    expect(sentences.length).toBe(3);
  });
});

describe("describeEtf — broad world equity ETF", () => {
  const out = describeEtf({
    name: "iShares Core MSCI World UCITS ETF",
    profile: WORLD_PROFILE,
  });

  it("returns a non-null description", () => {
    expect(out).not.toBeNull();
  });

  it("uses 'led by' phrasing for the sector mix when no single sector ≥40%", () => {
    // Top sector (Tech 25%) is below SECTOR_DOMINANT but above
    // SECTOR_LEADING, so we should see the multi-sector lead phrasing.
    expect(out!.en).toMatch(/led by Technology/);
  });

  it("lists multiple top regions (top1 < 60%) instead of 'concentrated in'", () => {
    // US is 57%, below the REGION_DOMINANT threshold — the prose should
    // list the top-3 regions, not the single-country phrasing.
    expect(out!.en).not.toMatch(/concentrated in United States/);
    expect(out!.en).toMatch(/United States/);
    expect(out!.en).toMatch(/Japan/);
    expect(out!.en).toMatch(/largest weights in/);
  });

  it("classifies as 'equity ETF'", () => {
    expect(out!.en).toMatch(/equity ETF/i);
  });
});

describe("describeEtf — bond ETF", () => {
  const out = describeEtf({
    name: "iShares Global Aggregate Bond UCITS ETF",
    profile: BOND_PROFILE,
  });

  it("returns a non-null description", () => {
    expect(out).not.toBeNull();
  });

  it("classifies as 'fixed-income ETF', not equity", () => {
    expect(out!.en).toMatch(/fixed-income ETF/i);
    expect(out!.en).not.toMatch(/equity ETF/);
  });

  it("does not produce a sector sentence (sector map is empty for bonds)", () => {
    expect(out!.en).not.toMatch(/dominated by/);
    expect(out!.en).not.toMatch(/led by/);
    expect(out!.en).not.toMatch(/multi-sector/);
  });

  it("DE version uses 'Renten-ETF'", () => {
    expect(out!.de).toMatch(/Renten-ETF/);
  });
});

describe("describeEtf — insufficient data", () => {
  it("returns null when the profile is null", () => {
    expect(describeEtf({ name: "Mystery ETF", profile: null })).toBeNull();
  });

  it("returns null when geo and sector maps are both empty", () => {
    expect(
      describeEtf({ name: "Mystery ETF", profile: EMPTY_PROFILE }),
    ).toBeNull();
  });

  it("returns null when the geo map only contains an 'Other' bucket", () => {
    // 'Other' is an aggregate label — it's not a real region the prose
    // can name. Treated the same as no geo data at all.
    const otherOnly: LookthroughProfile = {
      isEquity: true,
      geo: { Other: 100 },
      sector: {},
      currency: {},
    };
    expect(
      describeEtf({ name: "Mystery ETF", profile: otherOnly }),
    ).toBeNull();
  });
});

describe("describeEtf — DE / EN parity", () => {
  it("returns both languages for the tech-sector profile", () => {
    const out = describeEtf({ name: "Tech ETF", profile: TECH_PROFILE });
    expect(out).not.toBeNull();
    expect(out!.en.length).toBeGreaterThan(20);
    expect(out!.de.length).toBeGreaterThan(20);
  });

  it("DE version translates 'United States' to 'USA'", () => {
    const out = describeEtf({ name: "Tech ETF", profile: TECH_PROFILE });
    expect(out!.de).toMatch(/USA/);
    expect(out!.de).toMatch(/Technologie/);
  });

  it("DE version emits the same number of sentences as EN", () => {
    const out = describeEtf({ name: "Tech ETF", profile: TECH_PROFILE });
    const enCount = out!.en.split(/\.\s+/).filter((s) => s.trim()).length;
    const deCount = out!.de.split(/\.\s+/).filter((s) => s.trim()).length;
    expect(deCount).toBe(enCount);
  });

  it("DE version classifies bond ETFs distinctly from equity ETFs", () => {
    const equity = describeEtf({ name: "World", profile: WORLD_PROFILE });
    const bond = describeEtf({ name: "Bond", profile: BOND_PROFILE });
    expect(equity!.de).toMatch(/Aktien-ETF/);
    expect(bond!.de).toMatch(/Renten-ETF/);
  });
});

describe("describeEtf — catalog metadata qualifier", () => {
  it("prefixes the lead noun with 'accumulating' when supplied", () => {
    const out = describeEtf({
      name: "Test",
      profile: WORLD_PROFILE,
      catalog: { distribution: "Accumulating" },
    });
    expect(out!.en).toMatch(/^Accumulating equity ETF/);
    expect(out!.de).toMatch(/^Thesaurierender Aktien-ETF/);
  });

  it("prefixes the lead noun with 'distributing' when supplied", () => {
    const out = describeEtf({
      name: "Test",
      profile: WORLD_PROFILE,
      catalog: { distribution: "Distributing" },
    });
    expect(out!.en).toMatch(/^Distributing equity ETF/);
    expect(out!.de).toMatch(/^Ausschüttender Aktien-ETF/);
  });

  it("falls back to plain 'Equity ETF' when no distribution is supplied", () => {
    const out = describeEtf({ name: "Test", profile: WORLD_PROFILE });
    expect(out!.en).toMatch(/^Equity ETF/);
    expect(out!.de).toMatch(/^Aktien-ETF/);
  });
});

describe("describeEtf — determinism", () => {
  it("returns the exact same string on repeated calls (no flicker)", () => {
    const a = describeEtf({ name: "Tech", profile: TECH_PROFILE });
    const b = describeEtf({ name: "Tech", profile: TECH_PROFILE });
    expect(a!.en).toBe(b!.en);
    expect(a!.de).toBe(b!.de);
  });

  it("ignores the fund name (per task constraint: don't parse names)", () => {
    // Two different names + same profile should produce the same prose,
    // proving the helper is purely structured-data-driven.
    const a = describeEtf({ name: "Foo", profile: WORLD_PROFILE });
    const b = describeEtf({
      name: "Bar UCITS ETF 1C (Acc) — long messy suffix",
      profile: WORLD_PROFILE,
    });
    expect(a!.en).toBe(b!.en);
    expect(a!.de).toBe(b!.de);
  });

  it("does not mutate the input profile maps", () => {
    const profile: LookthroughProfile = {
      isEquity: true,
      geo: { ...WORLD_PROFILE.geo },
      sector: { ...WORLD_PROFILE.sector },
      currency: { ...WORLD_PROFILE.currency },
      topHoldings: WORLD_PROFILE.topHoldings
        ? [...WORLD_PROFILE.topHoldings]
        : undefined,
    };
    const geoBefore = JSON.stringify(profile.geo);
    const sectorBefore = JSON.stringify(profile.sector);
    describeEtf({ name: "Test", profile });
    expect(JSON.stringify(profile.geo)).toBe(geoBefore);
    expect(JSON.stringify(profile.sector)).toBe(sectorBefore);
  });
});
