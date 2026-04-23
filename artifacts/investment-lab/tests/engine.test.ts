import { describe, it, expect } from "vitest";
import { buildPortfolio, computeNaturalBucketCount } from "../src/lib/portfolio";
import { defaultExchangeFor, DEFAULT_EXCHANGE_FOR_CURRENCY } from "../src/lib/exchange";
import { runValidation } from "../src/lib/validation";
import { PortfolioInput, BaseCurrency, RiskAppetite } from "../src/lib/types";
import { profileFor, buildLookthrough } from "../src/lib/lookthrough";
import { getETFDetails } from "../src/lib/etfs";
import { runStressTest, SCENARIOS } from "../src/lib/scenarios";
import { estimateFees, getETFTer } from "../src/lib/fees";
import { buildAiPrompt } from "../src/lib/aiPrompt";
import {
  mapAllocationToAssets,
  computeMetrics,
  computeFrontier,
  buildCorrelationMatrix,
  BENCHMARK,
  portfolioReturn,
  portfolioVol,
} from "../src/lib/metrics";
import { diffPortfolios } from "../src/lib/compare";
import { analyzePortfolio } from "../src/lib/explain";

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

  it("rejects numETFs below 3", () => {
    const v = runValidation(baseInput({ numETFs: 2, numETFsMin: 2 }));
    expect(v.isValid).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it("rejects numETFs above 15", () => {
    const v = runValidation(baseInput({ numETFs: 20, numETFsMin: 8 }));
    expect(v.isValid).toBe(false);
  });

  it("rejects horizon < 1", () => {
    const v = runValidation(baseInput({ horizon: 0 }));
    expect(v.isValid).toBe(false);
  });

  it("rejects targetEquity that wildly exceeds the risk cap", () => {
    const v = runValidation(baseInput({ riskAppetite: "Low", targetEquityPct: 95 }));
    expect(v.isValid).toBe(false);
  });

  it("warns when crypto is enabled with Low risk", () => {
    const v = runValidation(
      baseInput({ riskAppetite: "Low", targetEquityPct: 30, includeCrypto: true })
    );
    expect(v.warnings.some((w) => /crypto|krypto/i.test(w.message))).toBe(true);
  });

  it("warns about complexity only when the engine actually produces > 10 ETFs", () => {
    // Natural buckets are large enough (CHF eq regions + bond + cash + gold + REIT + crypto + thematic ~ 11)
    const high = runValidation(
      baseInput({
        numETFs: 12,
        numETFsMin: 8,
        riskAppetite: "Very High",
        targetEquityPct: 80,
        includeCrypto: true,
        includeListedRealEstate: true,
        includeCommodities: true,
        thematicPreference: "Sustainability",
      })
    );
    expect(high.warnings.some((w) => /complex/i.test(w.message))).toBe(true);
  });

  it("does NOT warn about complexity when Max is high but the engine produces fewer ETFs", () => {
    // Screenshot scenario: Min 8, Max 11, but natural buckets ~ 9, so engine builds 9 ETFs.
    const v = runValidation(
      baseInput({
        numETFs: 11,
        numETFsMin: 8,
        riskAppetite: "Very High",
        targetEquityPct: 80,
        baseCurrency: "CHF",
        includeCrypto: false,
        includeListedRealEstate: false,
        thematicPreference: "None",
      })
    );
    expect(v.warnings.some((w) => /complex/i.test(w.message))).toBe(false);
  });

  it("warns when satellites are requested with too few ETFs", () => {
    const v = runValidation(
      baseInput({ numETFs: 4, numETFsMin: 4, includeCrypto: true, includeListedRealEstate: true })
    );
    expect(v.warnings.some((w) => /sleeves|bausteine/i.test(w.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ETF selection (etfs.ts) — hedged / synthetic / preferred-exchange logic
// ---------------------------------------------------------------------------
describe("getETFDetails — share-class selection", () => {
  it("hedged + EUR base picks the EUR-hedged S&P 500 (IE00B3ZW0K18)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "EUR", includeCurrencyHedging: true, preferredExchange: "XETRA" })
    );
    expect(d.isin).toBe("IE00B3ZW0K18");
    expect(d.currency).toBe("EUR");
  });

  it("hedged + GBP base picks the GBP-hedged S&P 500 (IE00BYX5MS15)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "GBP", includeCurrencyHedging: true, preferredExchange: "LSE" })
    );
    expect(d.isin).toBe("IE00BYX5MS15");
  });

  it("synthetic + USD base picks the synthetic S&P 500 (IE00B3YCGJ38)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "USD", includeSyntheticETFs: true })
    );
    expect(d.isin).toBe("IE00B3YCGJ38");
    expect(d.replication).toBe("Synthetic");
  });

  it("hedged wins over synthetic when both are enabled (non-USD)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({
        baseCurrency: "EUR",
        includeCurrencyHedging: true,
        includeSyntheticETFs: true,
        preferredExchange: "XETRA",
      })
    );
    expect(d.replication).toBe("Physical");
    expect(d.currency).toBe("EUR");
  });

  it("USD base + no hedging + no synthetic picks the physical CSPX (IE00B5BMR087)", () => {
    const d = getETFDetails("Equity", "USA", baseInput({ baseCurrency: "USD" }));
    expect(d.isin).toBe("IE00B5BMR087");
  });

  it("Switzerland always selects the SPI ETF on SIX", () => {
    const d = getETFDetails("Equity", "Switzerland", baseInput({ baseCurrency: "CHF" }));
    expect(d.isin).toBe("CH0237935652");
    expect(d.exchange).toBe("SIX");
  });

  it("Fixed Income picks the CHF-hedged aggregate when hedging + CHF base", () => {
    const d = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({ baseCurrency: "CHF", includeCurrencyHedging: true, preferredExchange: "SIX" })
    );
    expect(d.isin).toBe("IE00BDBRDN42");
  });

  it("Fixed Income picks the unhedged global aggregate when no hedging", () => {
    const d = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({ baseCurrency: "USD", includeCurrencyHedging: false })
    );
    expect(d.isin).toBe("IE00B3F81409");
  });

  it("preferredExchange=XETRA returns the XETRA ticker for an S&P 500 ETF", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "USD", preferredExchange: "XETRA" })
    );
    expect(d.exchange).toBe("XETRA");
    expect(d.ticker).toBe("SXR8");
  });

  it("preferredExchange=None falls back to the default exchange", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "USD", preferredExchange: "None" })
    );
    expect(d.exchange).toBe("LSE");
    expect(d.ticker).toBe("CSPX");
  });

  it("thematic Technology picks IUIT (IE00B3WJKG14)", () => {
    const d = getETFDetails(
      "Equity",
      "Technology",
      baseInput({ thematicPreference: "Technology" })
    );
    expect(d.isin).toBe("IE00B3WJKG14");
  });

  it("Real Estate, Commodities and Digital Assets all resolve to a real ETF", () => {
    const re = getETFDetails("Real Estate", "Global REITs", baseInput());
    const co = getETFDetails("Commodities", "Gold", baseInput());
    const da = getETFDetails("Digital Assets", "Broad Crypto", baseInput());
    expect(re.isin).toBe("IE00B1FZS350");
    expect(co.isin).toBe("IE00B579F325");
    expect(da.isin).toBe("GB00BLD4ZL17");
  });
});

// ---------------------------------------------------------------------------
// Engine math — cash%, EM tilt, sustainability, gold carve-out, satellites
// ---------------------------------------------------------------------------
describe("buildPortfolio — engine math", () => {
  const weightOf = (out: ReturnType<typeof buildPortfolio>, assetClass: string, region?: string) =>
    out.allocation
      .filter((a) => a.assetClass === assetClass && (region == null || a.region === region))
      .reduce((s, a) => s + a.weight, 0);

  it("cash bucket follows (10-h)*1.5 + Low?5 formula, clamped to [2,20]", () => {
    // h=10, Moderate -> (10-10)*1.5 + 0 = 0 -> clamped to 2
    const a = buildPortfolio(baseInput({ horizon: 10, riskAppetite: "Moderate" }));
    expect(weightOf(a, "Cash")).toBeCloseTo(2, 0);
    // h=1, Low -> (10-1)*1.5 + 5 = 18.5
    const b = buildPortfolio(
      baseInput({ horizon: 1, riskAppetite: "Low", targetEquityPct: 30, includeCommodities: false })
    );
    expect(weightOf(b, "Cash")).toBeCloseTo(18.5, 0);
    // h=20, High -> (10-20)*1.5 = -15 -> clamped to 2
    const c = buildPortfolio(baseInput({ horizon: 20, riskAppetite: "High" }));
    expect(weightOf(c, "Cash")).toBeCloseTo(2, 0);
  });

  it("long horizon (>=10) tilts more equity into EM than short horizon", () => {
    const longH = buildPortfolio(baseInput({ horizon: 15, numETFs: 10 }));
    const shortH = buildPortfolio(baseInput({ horizon: 5, numETFs: 10 }));
    expect(weightOf(longH, "Equity", "EM")).toBeGreaterThan(weightOf(shortH, "Equity", "EM"));
  });

  it("Sustainability theme reduces USA equity vs no theme (same numETFs)", () => {
    const susta = buildPortfolio(
      baseInput({ thematicPreference: "Sustainability", numETFs: 10 })
    );
    const none = buildPortfolio(baseInput({ thematicPreference: "None", numETFs: 10 }));
    expect(weightOf(susta, "Equity", "USA")).toBeLessThan(weightOf(none, "Equity", "USA"));
  });

  it("gold sleeve is carved out of bonds (≤ 5% and ≤ 15% of bonds)", () => {
    const out = buildPortfolio(
      baseInput({ riskAppetite: "High", includeCommodities: true, horizon: 10 })
    );
    const gold = weightOf(out, "Commodities");
    const bonds = weightOf(out, "Fixed Income");
    expect(gold).toBeGreaterThan(0);
    expect(gold).toBeLessThanOrEqual(5 + 0.5);
    expect(gold).toBeLessThanOrEqual((bonds + gold) * 0.15 + 0.5);
  });

  it("crypto sleeve sizing scales with risk: Moderate=1, High=2, Very High=3", () => {
    const m = buildPortfolio(baseInput({ riskAppetite: "Moderate", includeCrypto: true }));
    const h = buildPortfolio(baseInput({ riskAppetite: "High", includeCrypto: true }));
    const v = buildPortfolio(baseInput({ riskAppetite: "Very High", includeCrypto: true }));
    expect(weightOf(m, "Digital Assets")).toBeCloseTo(1, 0);
    expect(weightOf(h, "Digital Assets")).toBeCloseTo(2, 0);
    expect(weightOf(v, "Digital Assets")).toBeCloseTo(3, 0);
  });

  it("thematic sleeve is 3% when numETFs<=5 and 5% when larger", () => {
    const small = buildPortfolio(
      baseInput({ thematicPreference: "Technology", numETFs: 5, numETFsMin: 5 })
    );
    const large = buildPortfolio(
      baseInput({ thematicPreference: "Technology", numETFs: 10 })
    );
    const themaSmall = small.allocation
      .filter((a) => a.region === "Technology")
      .reduce((s, a) => s + a.weight, 0);
    const themaLarge = large.allocation
      .filter((a) => a.region === "Technology")
      .reduce((s, a) => s + a.weight, 0);
    expect(themaSmall).toBeCloseTo(3, 0);
    expect(themaLarge).toBeCloseTo(5, 0);
  });

  it("REIT sleeve is 6% when listed real estate is included", () => {
    const out = buildPortfolio(baseInput({ includeListedRealEstate: true, numETFs: 10 }));
    expect(weightOf(out, "Real Estate")).toBeCloseTo(6, 0);
  });
});

// ---------------------------------------------------------------------------
// Principled equity-region construction (risk-parity + Sharpe + home tilt)
// ---------------------------------------------------------------------------
describe("equity-region construction (principled, not fixed)", () => {
  const equityWeightOf = (out: ReturnType<typeof buildPortfolio>, region: string) =>
    out.allocation
      .filter((a) => a.assetClass === "Equity" && a.region === region)
      .reduce((s, a) => s + a.weight, 0);

  const equityTotal = (out: ReturnType<typeof buildPortfolio>) =>
    out.allocation
      .filter((a) => a.assetClass === "Equity")
      .reduce((s, a) => s + a.weight, 0);

  it("no equity region exceeds 65% of the equity sleeve (concentration cap)", () => {
    const inputs = [
      baseInput({ baseCurrency: "USD", numETFs: 12 }),
      baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "XETRA" }),
      baseInput({ baseCurrency: "CHF", numETFs: 12 }),
      baseInput({ baseCurrency: "GBP", numETFs: 12, preferredExchange: "LSE" }),
    ];
    for (const inp of inputs) {
      const out = buildPortfolio(inp);
      const eq = equityTotal(out);
      const regions = ["USA", "Europe", "Switzerland", "Japan", "EM"];
      for (const r of regions) {
        const w = equityWeightOf(out, r);
        if (w > 0) expect(w).toBeLessThanOrEqual(eq * 0.65 + 0.5);
      }
    }
  });

  it("home-bias overlay: each base currency gives the highest weight to its home region (relative to a USD-base reference)", () => {
    const usd = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
    const eur = buildPortfolio(baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "XETRA" }));
    const chf = buildPortfolio(baseInput({ baseCurrency: "CHF", numETFs: 12 }));
    const gbp = buildPortfolio(baseInput({ baseCurrency: "GBP", numETFs: 12, preferredExchange: "LSE" }));

    expect(equityWeightOf(usd, "USA")).toBeGreaterThan(equityWeightOf(eur, "USA"));
    expect(equityWeightOf(eur, "Europe")).toBeGreaterThan(equityWeightOf(usd, "Europe"));
    expect(equityWeightOf(gbp, "Europe")).toBeGreaterThan(equityWeightOf(usd, "Europe"));
    expect(equityWeightOf(chf, "Switzerland")).toBeGreaterThan(0);
    expect(equityWeightOf(usd, "Switzerland")).toBe(0);
  });

  it("market-cap anchor: USA is the largest equity region for a USD-base investor (no theme, neutral horizon)", () => {
    const out = buildPortfolio(
      baseInput({ baseCurrency: "USD", horizon: 5, thematicPreference: "None", numETFs: 12 })
    );
    const usa = equityWeightOf(out, "USA");
    const others = ["Europe", "Japan", "EM"].map((r) => equityWeightOf(out, r));
    for (const w of others) expect(usa).toBeGreaterThan(w);
  });

  it("equity-region weights remain stable (sum to coreEquity ± rounding)", () => {
    const out = buildPortfolio(baseInput({ numETFs: 12 }));
    const eq = equityTotal(out);
    // satellites: none included by default in baseInput -> equityPct = targetEquityPct (60)
    expect(eq).toBeGreaterThan(55);
    expect(eq).toBeLessThan(65);
  });
});

// ---------------------------------------------------------------------------
// Stress test (scenarios.ts)
// ---------------------------------------------------------------------------
describe("runStressTest", () => {
  it("returns a result for every defined scenario", () => {
    const out = buildPortfolio(baseInput());
    const results = runStressTest(out.allocation);
    expect(results.length).toBe(SCENARIOS.length);
    expect(results.map((r) => r.id).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  it("equity-heavy portfolio loses materially in the GFC scenario", () => {
    const out = buildPortfolio(baseInput({ riskAppetite: "High", targetEquityPct: 80 }));
    const gfc = runStressTest(out.allocation).find((r) => r.id === "gfc")!;
    expect(gfc.total).toBeLessThan(-15);
  });

  it("Equity_Home regions fall back to USA shocks (no Home shock defined)", () => {
    // Force the Global+Home fallback with CHF base (Home maps to Switzerland... but let's use USD)
    const out = buildPortfolio(
      baseInput({
        baseCurrency: "USD",
        numETFs: 4,
        includeCommodities: false,
        includeCrypto: false,
        includeListedRealEstate: false,
      })
    );
    const homeAlloc = out.allocation.find((a) => a.region === "Home");
    expect(homeAlloc).toBeDefined();
    const gfc = runStressTest(out.allocation).find((r) => r.id === "gfc")!;
    const homeContribKey = `Equity - Home`;
    const c = gfc.contributions.find((x) => x.key === homeContribKey)!;
    // GFC USA shock is -37
    expect(c.shock).toBe(-37);
  });

  it("Cash receives the cash shock (positive in GFC)", () => {
    const out = buildPortfolio(baseInput());
    const gfc = runStressTest(out.allocation).find((r) => r.id === "gfc")!;
    const cash = gfc.contributions.find((x) => x.key.startsWith("Cash"))!;
    expect(cash.shock).toBe(2);
  });

  it("contributions are sorted by absolute size, descending", () => {
    const out = buildPortfolio(baseInput());
    const gfc = runStressTest(out.allocation).find((r) => r.id === "gfc")!;
    for (let i = 1; i < gfc.contributions.length; i++) {
      expect(Math.abs(gfc.contributions[i - 1].contribution)).toBeGreaterThanOrEqual(
        Math.abs(gfc.contributions[i].contribution)
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Fees (fees.ts)
// ---------------------------------------------------------------------------
describe("estimateFees", () => {
  it("blended TER is a weighted average of per-bucket TERs", () => {
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Fixed Income", region: "Global", weight: 50 },
    ];
    const r = estimateFees(alloc, 10, 100_000);
    const usTer = getETFTer("Equity", "USA"); // 12
    const fiTer = getETFTer("Fixed Income", "Global"); // 15
    expect(r.blendedTerBps).toBeCloseTo((usTer + fiTer) / 2, 1);
  });

  it("hedging adds extra bps to hedge-able sleeves only (Equity / FI / Real Estate)", () => {
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
      { assetClass: "Cash", region: "USD", weight: 10 },
    ];
    const noHedge = estimateFees(alloc, 10, 100_000);
    const hedged = estimateFees(alloc, 10, 100_000, { hedged: true, hedgingCostBps: 15 });
    // Equity (60%) + FI (30%) = 90% gets +15 bps -> +13.5 bps blended
    expect(hedged.blendedTerBps - noHedge.blendedTerBps).toBeCloseTo(13.5, 1);
  });

  it("projection has horizon+1 entries and final-after-fees < final-zero-fee", () => {
    const out = buildPortfolio(baseInput());
    const r = estimateFees(out.allocation, 10, 100_000);
    expect(r.projection.length).toBe(11);
    expect(r.projectedFinalValueAfterFees).toBeLessThan(r.projectedFinalValueZeroFee);
    expect(r.projectedTotalFees).toBeGreaterThan(0);
  });

  it("annualFee is investmentAmount * blended TER", () => {
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const r = estimateFees(alloc, 10, 100_000);
    expect(r.annualFee).toBeCloseTo(100_000 * (r.blendedTerBps / 10_000), 2);
  });
});

// ---------------------------------------------------------------------------
// Metrics (metrics.ts)
// ---------------------------------------------------------------------------
describe("metrics", () => {
  it("mapAllocationToAssets routes regions to the correct asset key", () => {
    const exp = mapAllocationToAssets([
      { assetClass: "Equity", region: "USA", weight: 30 },
      { assetClass: "Equity", region: "Europe", weight: 20 },
      { assetClass: "Equity", region: "Switzerland", weight: 10 },
      { assetClass: "Equity", region: "Japan", weight: 10 },
      { assetClass: "Equity", region: "EM", weight: 10 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
      { assetClass: "Cash", region: "USD", weight: 5 },
    ]);
    const get = (k: string) => exp.find((e) => e.key === k)?.weight ?? 0;
    expect(get("equity_us")).toBeCloseTo(0.3);
    expect(get("equity_eu")).toBeCloseTo(0.2);
    expect(get("equity_ch")).toBeCloseTo(0.1);
    expect(get("equity_jp")).toBeCloseTo(0.1);
    expect(get("equity_em")).toBeCloseTo(0.1);
    expect(get("bonds")).toBeCloseTo(0.15);
    expect(get("cash")).toBeCloseTo(0.05);
  });

  it("computeMetrics returns sane numbers for a default portfolio", () => {
    const out = buildPortfolio(baseInput());
    const m = computeMetrics(out.allocation);
    expect(m.expReturn).toBeGreaterThan(0);
    expect(m.expReturn).toBeLessThan(0.20);
    expect(m.vol).toBeGreaterThan(0);
    expect(m.sharpe).toBeGreaterThan(0);
    expect(m.maxDrawdown).toBeLessThanOrEqual(0);
    expect(m.maxDrawdown).toBeGreaterThanOrEqual(-0.85);
  });

  it("benchmark portfolio has beta ≈ 1 and tracking error ≈ 0", () => {
    const benchAlloc = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 18 },
      { assetClass: "Equity", region: "Switzerland", weight: 4 },
      { assetClass: "Equity", region: "Japan", weight: 4 },
      { assetClass: "Equity", region: "EM", weight: 14 },
    ];
    const m = computeMetrics(benchAlloc);
    expect(m.beta).toBeCloseTo(1, 2);
    expect(m.trackingError).toBeLessThan(0.001);
    expect(m.expReturn).toBeCloseTo(portfolioReturn(BENCHMARK), 4);
    expect(m.vol).toBeCloseTo(portfolioVol(BENCHMARK), 4);
  });

  it("frontier returns 21 points (0..100 step 5), each with computed return/vol", () => {
    const out = buildPortfolio(baseInput());
    const f = computeFrontier(out.allocation);
    expect(f.points.length).toBe(21);
    expect(f.points[0].equityPct).toBe(0);
    expect(f.points[20].equityPct).toBe(100);
    expect(f.current).toBeDefined();
    for (const p of f.points) {
      expect(p.vol).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.ret)).toBe(true);
    }
  });

  it("correlation matrix is square, diagonal=1, and symmetric", () => {
    const out = buildPortfolio(baseInput());
    const { labels, matrix } = buildCorrelationMatrix(out.allocation);
    expect(matrix.length).toBe(labels.length);
    for (let i = 0; i < matrix.length; i++) {
      expect(matrix[i].length).toBe(labels.length);
      expect(matrix[i][i]).toBe(1);
      for (let j = 0; j < matrix.length; j++) {
        expect(matrix[i][j]).toBeCloseTo(matrix[j][i], 6);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Compare (compare.ts)
// ---------------------------------------------------------------------------
describe("diffPortfolios", () => {
  it("identical portfolios produce zero deltas everywhere", () => {
    const a = buildPortfolio(baseInput());
    const b = buildPortfolio(baseInput());
    const d = diffPortfolios(a, b);
    expect(d.equityDelta).toBeCloseTo(0, 1);
    for (const r of d.rows) expect(r.delta).toBeCloseTo(0, 1);
  });

  it("equityDelta = equityB - equityA", () => {
    const a = buildPortfolio(baseInput({ riskAppetite: "Low", targetEquityPct: 30 }));
    const b = buildPortfolio(baseInput({ riskAppetite: "Very High", targetEquityPct: 95 }));
    const eqA = a.allocation.filter((x) => x.assetClass === "Equity").reduce((s, x) => s + x.weight, 0);
    const eqB = b.allocation.filter((x) => x.assetClass === "Equity").reduce((s, x) => s + x.weight, 0);
    const d = diffPortfolios(a, b);
    expect(d.equityDelta).toBeCloseTo(eqB - eqA, 1);
    expect(d.observations.length).toBeGreaterThan(0);
  });

  it("observation flags when one portfolio has a crypto sleeve and the other does not", () => {
    const a = buildPortfolio(baseInput({ includeCrypto: false }));
    const b = buildPortfolio(baseInput({ riskAppetite: "High", includeCrypto: true }));
    const d = diffPortfolios(a, b);
    expect(d.observations.some((o) => /digital assets/i.test(o))).toBe(true);
  });

  it("rows are sorted by absolute delta descending", () => {
    const a = buildPortfolio(baseInput({ riskAppetite: "Low", targetEquityPct: 30 }));
    const b = buildPortfolio(baseInput({ riskAppetite: "Very High", targetEquityPct: 95 }));
    const d = diffPortfolios(a, b);
    for (let i = 1; i < d.rows.length; i++) {
      expect(Math.abs(d.rows[i - 1].delta)).toBeGreaterThanOrEqual(Math.abs(d.rows[i].delta));
    }
  });
});

// ---------------------------------------------------------------------------
// Explain (explain.ts)
// ---------------------------------------------------------------------------
describe("analyzePortfolio", () => {
  it("flags Inconsistent when weights don't sum to 100", () => {
    const r = analyzePortfolio(
      [
        { assetClass: "Equity", region: "USA", weight: 50 },
        { assetClass: "Fixed Income", region: "Global", weight: 30 },
      ],
      "Moderate",
      "USD"
    );
    expect(r.verdict).toBe("Inconsistent");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("warns about concentration when a single position is > 25%", () => {
    const r = analyzePortfolio(
      [
        { assetClass: "Equity", region: "USA", weight: 70 },
        { assetClass: "Fixed Income", region: "Global", weight: 25 },
        { assetClass: "Cash", region: "USD", weight: 5 },
      ],
      "High",
      "USD"
    );
    expect(r.warnings.some((w) => /concentration/i.test(w))).toBe(true);
  });

  it("warns when stated risk is Low but equity > 50%", () => {
    const r = analyzePortfolio(
      [
        { assetClass: "Equity", region: "USA", weight: 60 },
        { assetClass: "Fixed Income", region: "Global", weight: 30 },
        { assetClass: "Cash", region: "USD", weight: 10 },
      ],
      "Low",
      "USD"
    );
    expect(r.warnings.some((w) => /low.*inconsistent|inconsistent/i.test(w))).toBe(true);
  });

  it("warns when there are no bonds or cash", () => {
    const r = analyzePortfolio(
      [
        { assetClass: "Equity", region: "USA", weight: 60 },
        { assetClass: "Equity", region: "Europe", weight: 40 },
      ],
      "High",
      "USD"
    );
    expect(r.warnings.some((w) => /no bonds|stabilizing/i.test(w))).toBe(true);
  });

  it("returns Coherent for a balanced portfolio with sane risk", () => {
    const r = analyzePortfolio(
      [
        { assetClass: "Equity", region: "USA", weight: 22 },
        { assetClass: "Equity", region: "Europe", weight: 15 },
        { assetClass: "Equity", region: "EM", weight: 13 },
        { assetClass: "Fixed Income", region: "Global", weight: 25 },
        { assetClass: "Fixed Income", region: "EUR", weight: 15 },
        { assetClass: "Cash", region: "USD", weight: 10 },
      ],
      "Moderate",
      "USD"
    );
    expect(r.verdict).toBe("Coherent");
    expect(r.errors.length).toBe(0);
    expect(r.warnings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Look-through aggregation (lookthrough.ts)
// ---------------------------------------------------------------------------
describe("buildLookthrough", () => {
  it("equity sleeve aggregates to ~100% of geoEquity for an equity-only portfolio", () => {
    const out = buildPortfolio(
      baseInput({ riskAppetite: "Very High", targetEquityPct: 100, horizon: 15 })
    );
    const lt = buildLookthrough(out.etfImplementation, "en", "CHF");
    const totalGeo = lt.geoEquity.reduce((s, [, v]) => s + v, 0);
    expect(totalGeo).toBeCloseTo(100, 0);
  });

  it("currency overview reports a hedged share when hedging is on (non-USD base)", () => {
    const out = buildPortfolio(
      baseInput({
        baseCurrency: "EUR",
        includeCurrencyHedging: true,
        preferredExchange: "XETRA",
      })
    );
    const lt = buildLookthrough(out.etfImplementation, "en", "EUR");
    expect(lt.currencyOverview.hedgedShareOfPortfolio).toBeGreaterThan(0);
  });

  it("USD-base portfolio with hedging off has zero hedged share", () => {
    const out = buildPortfolio(baseInput({ baseCurrency: "USD", includeCurrencyHedging: false }));
    const lt = buildLookthrough(out.etfImplementation, "en", "USD");
    expect(lt.currencyOverview.hedgedShareOfPortfolio).toBe(0);
  });

  it("default portfolio with USA exposure produces non-empty top-stock concentrations", () => {
    const out = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 8 }));
    const lt = buildLookthrough(out.etfImplementation, "en", "USD");
    expect(lt.topConcentrations.length).toBeGreaterThan(0);
  });
});

describe("AI Prompt builder (buildAiPrompt)", () => {
  it("substitutes the core investor parameters (CHF, High, horizon 12, equity 70%)", () => {
    const p = buildAiPrompt(
      baseInput({ baseCurrency: "CHF", riskAppetite: "High", horizon: 12, targetEquityPct: 70 })
    );
    expect(p).toContain("Base currency: CHF");
    expect(p).toContain("Risk appetite: High");
    expect(p).toContain("Investment horizon: >=10 years");
    expect(p).toContain("Equity allocation between 60% and 80%");
    expect(p).toContain("Address Swiss home bias");
  });

  it("lists Switzerland as a separate equity region only for CHF base currency", () => {
    const chf = buildAiPrompt(baseInput({ baseCurrency: "CHF" }));
    expect(chf).toContain("Switzerland (CH)");
    expect(chf).toContain("Europe ex-CH");
    for (const cur of ["USD", "EUR", "GBP"] as const) {
      const p = buildAiPrompt(baseInput({ baseCurrency: cur, preferredExchange: cur === "EUR" ? "XETRA" : cur === "GBP" ? "LSE" : "None" }));
      expect(p).not.toContain("Switzerland (CH)");
      expect(p).not.toContain("Europe ex-CH");
      expect(p).toContain("USA, Europe, Japan, and Emerging Markets");
    }
  });

  it("changes the home-bias label per base currency", () => {
    expect(buildAiPrompt(baseInput({ baseCurrency: "EUR", preferredExchange: "XETRA" }))).toContain("Address Eurozone home bias");
    expect(buildAiPrompt(baseInput({ baseCurrency: "GBP", preferredExchange: "LSE" }))).toContain("Address UK home bias");
    expect(buildAiPrompt(baseInput({ baseCurrency: "USD" }))).toContain("Address US home bias");
  });

  it("renders the correct preferred-exchange line", () => {
    expect(buildAiPrompt(baseInput({ preferredExchange: "SIX" }))).toContain("SIX Swiss Exchange");
    expect(buildAiPrompt(baseInput({ preferredExchange: "XETRA" }))).toContain("Xetra");
    expect(buildAiPrompt(baseInput({ preferredExchange: "LSE" }))).toContain("London Stock Exchange");
    expect(buildAiPrompt(baseInput({ preferredExchange: "None" }))).toContain("No specific exchange preference");
  });

  it("includes / excludes satellite asset classes based on toggles", () => {
    const all = buildAiPrompt(
      baseInput({
        includeCrypto: true,
        includeListedRealEstate: true,
        includeCommodities: true,
        thematicPreference: "Sustainability",
      })
    );
    expect(all).toContain("Commodities / Precious Metals");
    expect(all).toContain("Listed Real Estate (REITs)");
    expect(all).toContain("Crypto Assets");
    expect(all).toContain("Thematic Equity (Sustainability");

    const none = buildAiPrompt(
      baseInput({
        includeCrypto: false,
        includeListedRealEstate: false,
        includeCommodities: false,
        thematicPreference: "None",
      })
    );
    expect(none).not.toContain("Commodities / Precious Metals");
    expect(none).not.toContain("Listed Real Estate (REITs)");
    expect(none).not.toContain("Crypto Assets");
    expect(none).not.toContain("Thematic Equity");
    expect(none).toContain("Satellites: none requested");
  });

  it("toggles the synthetic-ETF and currency-hedging instructions correctly", () => {
    const optedIn = buildAiPrompt(baseInput({ includeSyntheticETFs: true, includeCurrencyHedging: true }));
    expect(optedIn).toContain("Include synthetic ETFs");
    expect(optedIn).toContain("State clearly whether currency hedging");

    const optedOut = buildAiPrompt(baseInput({ includeSyntheticETFs: false, includeCurrencyHedging: false }));
    expect(optedOut).toContain("Use physical replication only");
    expect(optedOut).toContain("does NOT want broad currency hedging");
  });

  it("encodes the requested ETF count range", () => {
    const p = buildAiPrompt(baseInput({ numETFs: 10, numETFsMin: 7 }));
    expect(p).toContain("target range of 7-10 positions");
  });

  it("always emits the full output-format scaffold (sections A-H + closing)", () => {
    const p = buildAiPrompt(baseInput());
    for (const marker of [
      "A) Table 1: Target allocation",
      "B) Table 2: ETF implementation",
      "C) Brief summary",
      "D) Consolidated currency overview",
      "E) The ten largest equity holdings",
      "F) Rebalancing concept",
      "G) Rough cost estimate",
      "H) Portfolio rationale",
      "Closing instruction:",
    ]) {
      expect(p).toContain(marker);
    }
  });
});
