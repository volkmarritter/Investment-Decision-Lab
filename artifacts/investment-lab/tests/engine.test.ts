import { describe, it, expect } from "vitest";
import { buildPortfolio, computeNaturalBucketCount } from "../src/lib/portfolio";
import { defaultExchangeFor, DEFAULT_EXCHANGE_FOR_CURRENCY } from "../src/lib/exchange";
import { runValidation } from "../src/lib/validation";
import { PortfolioInput, BaseCurrency, RiskAppetite } from "../src/lib/types";
import { profileFor } from "../src/lib/lookthrough";

const baseInput = (overrides: Partial<PortfolioInput> = {}): PortfolioInput => ({
  baseCurrency: "CHF",
  riskAppetite: "High",
  horizon: 10,
  targetEquityPct: 60,
  numETFs: 10,
  numETFsMin: 8,
  preferredExchange: "SIX",
  thematicPreference: "None",
  includeCurrencyHedging: false,
  includeSyntheticETFs: false,
  lookThroughView: true,
  includeCrypto: false,
  includeListedRealEstate: false,
  includeCommodities: true,
  ...overrides,
});

const sumWeights = (xs: { weight: number }[]) =>
  Math.round(xs.reduce((s, x) => s + x.weight, 0) * 10) / 10;

// ---------------------------------------------------------------------------
// Default exchange auto-mapping
// ---------------------------------------------------------------------------
describe("defaultExchangeFor", () => {
  const cases: Array<[BaseCurrency, "None" | "LSE" | "XETRA" | "SIX"]> = [
    ["USD", "None"],
    ["EUR", "XETRA"],
    ["CHF", "SIX"],
    ["GBP", "LSE"],
  ];
  it.each(cases)("maps %s -> %s", (ccy, expected) => {
    expect(defaultExchangeFor(ccy)).toBe(expected);
  });

  it("covers every supported base currency", () => {
    expect(Object.keys(DEFAULT_EXCHANGE_FOR_CURRENCY).sort()).toEqual(
      ["CHF", "EUR", "GBP", "USD"]
    );
  });
});

// ---------------------------------------------------------------------------
// Portfolio engine — invariants
// ---------------------------------------------------------------------------
describe("buildPortfolio — invariants", () => {
  it("default inputs produce a non-empty allocation summing to ~100%", () => {
    const out = buildPortfolio(baseInput());
    expect(out.allocation.length).toBeGreaterThan(0);
    expect(sumWeights(out.allocation)).toBeCloseTo(100, 0);
  });

  it("ETF implementation is produced for every non-cash bucket", () => {
    const out = buildPortfolio(baseInput());
    const nonCash = out.allocation.filter((a) => a.assetClass !== "Cash");
    expect(out.etfImplementation.length).toBe(nonCash.length);
    for (const e of out.etfImplementation) {
      expect(e.isin).toBeTruthy();
      expect(e.ticker).toBeTruthy();
    }
  });

  it("never produces negative weights", () => {
    const out = buildPortfolio(baseInput({ riskAppetite: "Low", horizon: 3 }));
    for (const a of out.allocation) {
      expect(a.weight).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Risk-appetite caps
// ---------------------------------------------------------------------------
describe("buildPortfolio — risk caps", () => {
  const equityPctOf = (input: PortfolioInput) =>
    sumWeights(
      buildPortfolio(input).allocation.filter((a) => a.assetClass === "Equity")
    );

  const cases: Array<[RiskAppetite, number]> = [
    ["Low", 40],
    ["Moderate", 70],
    ["High", 90],
    ["Very High", 100],
  ];

  it.each(cases)("'%s' caps equity at <= %s%%", (risk, cap) => {
    const eq = equityPctOf(baseInput({ riskAppetite: risk, targetEquityPct: 100 }));
    expect(eq).toBeLessThanOrEqual(cap + 0.5);
  });

  it("Low risk disables crypto sleeve", () => {
    const out = buildPortfolio(baseInput({ riskAppetite: "Low", includeCrypto: true }));
    expect(out.allocation.find((a) => a.assetClass === "Digital Assets")).toBeUndefined();
  });

  it("Low risk disables commodities (gold) sleeve", () => {
    const out = buildPortfolio(baseInput({ riskAppetite: "Low", includeCommodities: true }));
    expect(out.allocation.find((a) => a.assetClass === "Commodities")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Home bias
// ---------------------------------------------------------------------------
describe("buildPortfolio — home bias by base currency", () => {
  it("CHF base creates a Switzerland equity bucket", () => {
    const out = buildPortfolio(baseInput({ baseCurrency: "CHF" }));
    expect(out.allocation.find((a) => a.region === "Switzerland")).toBeDefined();
  });

  it("USD base does NOT create a Switzerland equity bucket", () => {
    const out = buildPortfolio(baseInput({ baseCurrency: "USD" }));
    expect(out.allocation.find((a) => a.region === "Switzerland")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Global+Home equity fallback
// ---------------------------------------------------------------------------
describe("buildPortfolio — Global+Home equity fallback", () => {
  it("collapses regional equity into Global+Home when numETFs is too small", () => {
    const out = buildPortfolio(
      baseInput({
        baseCurrency: "CHF",
        numETFs: 4,
        includeCommodities: false,
        includeCrypto: false,
        includeListedRealEstate: false,
      })
    );
    const regions = out.allocation.map((a) => a.region);
    expect(regions).toContain("Global");
    expect(regions).toContain("Home");
    // Total equity preserved
    expect(
      sumWeights(out.allocation.filter((a) => a.assetClass === "Equity"))
    ).toBeCloseTo(60, 0);
  });

  it("does NOT collapse when numETFs is large enough", () => {
    const out = buildPortfolio(baseInput({ numETFs: 12 }));
    const equityRegions = out.allocation
      .filter((a) => a.assetClass === "Equity")
      .map((a) => a.region);
    expect(equityRegions).not.toContain("Global");
    expect(equityRegions).not.toContain("Home");
  });
});

// ---------------------------------------------------------------------------
// Look-through coverage — every ETF the engine can pick must be mapped
// ---------------------------------------------------------------------------
describe("look-through coverage", () => {
  const matrix: PortfolioInput[] = [];
  for (const ccy of ["USD", "EUR", "CHF", "GBP"] as BaseCurrency[]) {
    for (const risk of ["Low", "Moderate", "High", "Very High"] as RiskAppetite[]) {
      for (const numETFs of [3, 5, 8, 12]) {
        for (const synth of [false, true]) {
          matrix.push(
            baseInput({
              baseCurrency: ccy,
              riskAppetite: risk,
              numETFs,
              includeSyntheticETFs: synth,
              includeCrypto: risk !== "Low",
              includeListedRealEstate: true,
              includeCommodities: risk !== "Low",
              thematicPreference: "Technology",
            })
          );
        }
      }
    }
  }

  it("every selected ETF has a look-through profile", () => {
    const unmapped = new Set<string>();
    for (const input of matrix) {
      const out = buildPortfolio(input);
      for (const e of out.etfImplementation) {
        // Only equity / fixed income flow through look-through; commodities &
        // crypto are intentionally not mapped (treated as own buckets).
        if (
          e.assetClass !== "Equity" &&
          e.assetClass !== "Fixed Income"
        ) continue;
        if (!profileFor(e.isin)) {
          unmapped.add(`${e.exampleETF} (${e.isin})`);
        }
      }
    }
    expect(Array.from(unmapped)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Natural bucket count helper
// ---------------------------------------------------------------------------
describe("computeNaturalBucketCount", () => {
  it("returns at least 3 for a basic portfolio (equity + bonds + cash)", () => {
    const n = computeNaturalBucketCount(baseInput({ numETFs: 3 }));
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("grows when satellites are enabled", () => {
    const lean = computeNaturalBucketCount(
      baseInput({
        includeCrypto: false,
        includeListedRealEstate: false,
        includeCommodities: false,
        thematicPreference: "None",
      })
    );
    const fat = computeNaturalBucketCount(
      baseInput({
        includeCrypto: true,
        includeListedRealEstate: true,
        includeCommodities: true,
        thematicPreference: "Technology",
      })
    );
    expect(fat).toBeGreaterThan(lean);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe("runValidation", () => {
  it("accepts a sane default input", () => {
    const v = runValidation(baseInput());
    expect(v.isValid).toBe(true);
  });
});
