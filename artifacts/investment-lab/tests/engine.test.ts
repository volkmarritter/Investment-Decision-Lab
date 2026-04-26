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

  it("asset classes are sorted in canonical order: Cash → Bonds → Equities → Commodities → REITs → Crypto", () => {
    // Maximum-diversity input that exercises every asset class so the
    // canonical order is observable end-to-end on the `allocation` array.
    const out = buildPortfolio(
      baseInput({
        riskAppetite: "Moderate",
        horizon: 15,
        includeCommodities: true,
        includeListedRealEstate: true,
        includeCrypto: true,
      })
    );
    // Sanity gate: every weight must be a finite positive number, otherwise
    // the monotonic-rank assertions below could pass even on a broken build.
    expect(out.allocation.length).toBeGreaterThanOrEqual(5);
    for (const a of out.allocation) {
      expect(Number.isFinite(a.weight)).toBe(true);
      expect(a.weight).toBeGreaterThan(0);
    }
    // The diverse input must actually exercise every class we are claiming
    // to order; otherwise the monotonicity check below is vacuous for the
    // missing classes.
    const classesPresent = new Set(out.allocation.map((a) => a.assetClass));
    for (const cls of [
      "Cash",
      "Fixed Income",
      "Equity",
      "Commodities",
      "Real Estate",
      "Digital Assets",
    ]) {
      expect(classesPresent.has(cls)).toBe(true);
    }
    const rank: Record<string, number> = {
      Cash: 0,
      "Fixed Income": 1,
      Equity: 2,
      Commodities: 3,
      "Real Estate": 4,
      "Digital Assets": 5,
    };
    const seen = out.allocation.map((a) => rank[a.assetClass] ?? 99);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    // Within an asset class (e.g. multiple equity regions), weight-desc must
    // remain the tiebreaker so the largest holdings stay on top.
    for (let i = 1; i < out.allocation.length; i++) {
      if (out.allocation[i].assetClass === out.allocation[i - 1].assetClass) {
        expect(out.allocation[i].weight).toBeLessThanOrEqual(
          out.allocation[i - 1].weight
        );
      }
    }
    // ETF implementation is built directly from the allocation order, so it
    // inherits the same canonical ordering (cash row is intentionally absent).
    const etfRanks = out.etfImplementation.map(
      (e) => rank[e.assetClass] ?? 99
    );
    for (let i = 1; i < etfRanks.length; i++) {
      expect(etfRanks[i]).toBeGreaterThanOrEqual(etfRanks[i - 1]);
    }
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

  it("correlation matrix always shows all 11 asset classes regardless of holdings", () => {
    // 100% equity portfolio (no bonds, cash, gold, reits, crypto held)
    const out = buildPortfolio(baseInput({
      riskAppetite: "Very High",
      targetEquityPct: 100,
      includeCommodities: false,
      includeListedRealEstate: false,
      includeCrypto: false,
    }));
    const { keys, labels, matrix, held } = buildCorrelationMatrix(out.allocation);
    // Always 11 rows/cols
    expect(keys).toEqual([
      "equity_us", "equity_eu", "equity_ch", "equity_jp", "equity_em", "equity_thematic",
      "bonds", "cash", "gold", "reits", "crypto",
    ]);
    expect(labels.length).toBe(11);
    expect(matrix.length).toBe(11);
    expect(matrix.every((r) => r.length === 11)).toBe(true);
    expect(held.length).toBe(11);
    // At least one equity row is held; bonds/cash/gold/reits/crypto are not
    expect(held.some((h, i) => h && keys[i].startsWith("equity_"))).toBe(true);
    expect(held[keys.indexOf("bonds")]).toBe(false);
    expect(held[keys.indexOf("gold")]).toBe(false);
    expect(held[keys.indexOf("reits")]).toBe(false);
    expect(held[keys.indexOf("crypto")]).toBe(false);
    // The non-held rows still carry valid correlation data (e.g. bonds×equity_us = 0.10)
    const iBonds = keys.indexOf("bonds");
    const iEqUs = keys.indexOf("equity_us");
    expect(matrix[iBonds][iEqUs]).toBeCloseTo(0.10, 6);
    expect(matrix[iEqUs][iBonds]).toBeCloseTo(0.10, 6);
  });

  it("correlation matrix marks held=true for every asset class actually in the portfolio", () => {
    const out = buildPortfolio(baseInput({
      includeCommodities: true,
      includeListedRealEstate: true,
      includeCrypto: true,
    }));
    const { keys, held } = buildCorrelationMatrix(out.allocation);
    // Sanity: gold/reits/crypto should be on for this input
    expect(held[keys.indexOf("gold")]).toBe(true);
    expect(held[keys.indexOf("reits")]).toBe(true);
    expect(held[keys.indexOf("crypto")]).toBe(true);
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
    expect(p).toContain("Investment horizon: 12 years");
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

  it("produces a German prompt when lang='de' is passed", () => {
    const de = buildAiPrompt(
      baseInput({
        baseCurrency: "CHF",
        riskAppetite: "Very High",
        targetEquityPct: 80,
        horizon: 12,
        preferredExchange: "SIX",
        includeCurrencyHedging: false,
        includeSyntheticETFs: false,
        includeCommodities: true,
        includeListedRealEstate: true,
        includeCrypto: true,
        thematicPreference: "Sustainability",
      }),
      "de"
    );
    expect(de).toContain("Rolle:");
    expect(de).toContain("Basiswaehrung: CHF");
    expect(de).toContain("Risikoneigung: Sehr hoch");
    expect(de).toContain("Anlagehorizont: 12 Jahre");
    expect(de).toContain("Aktienallokation zwischen 70% und 90%");
    expect(de).toContain("SIX Swiss Exchange");
    expect(de).toContain("Schweizer");
    expect(de).toContain("Schweiz (CH)");
    expect(de).toContain("Satelliten:");
    expect(de).toContain("Rohstoffe / Edelmetalle");
    expect(de).toContain("Boersennotierte Immobilien");
    expect(de).toContain("Krypto-Assets");
    expect(de).toContain("Thematische Aktien (Sustainability");
    expect(de).toContain("KEINE breite Waehrungsabsicherung");
    expect(de).toContain("ausschliesslich physische Replikation");
    expect(de).toContain("Verfasse die gesamte Antwort in klarem Deutsch.");
    // Ensure no English boilerplate leaked through.
    expect(de).not.toContain("Role:\nYou act as");
    expect(de).not.toContain("Eligible asset classes:");
  });

  it("defaults to English when lang is omitted", () => {
    const p = buildAiPrompt(baseInput({ baseCurrency: "USD" }));
    expect(p).toContain("Role:");
    expect(p).toContain("Base currency: USD");
    expect(p).not.toContain("Basiswaehrung");
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
    // Commodities must appear inside the Satellites block (not in the Core list).
    const satellitesIdx = all.indexOf("Satellites:");
    const commoditiesIdx = all.indexOf("Commodities / Precious Metals");
    expect(satellitesIdx).toBeGreaterThan(0);
    expect(commoditiesIdx).toBeGreaterThan(satellitesIdx);
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

// ----------------------------------------------------------------------------
// CMA layering & Monte Carlo wiring (regression — see DOCUMENTATION.md §5.3)
// ----------------------------------------------------------------------------
describe("CMA layered overrides", () => {
  it("Monte Carlo expected-return reflects the active CMA value (single source of truth)", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const { CMA } = await import("../src/lib/metrics");
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const baseline = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1 });
    expect(baseline.expectedReturn).toBeCloseTo(CMA.equity_us.expReturn, 6);
  });

  it("manually mutating CMA leaves immediately changes Monte Carlo expected return", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const { CMA } = await import("../src/lib/metrics");
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const before = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1 }).expectedReturn;
    const original = CMA.equity_us.expReturn;
    CMA.equity_us.expReturn = 0.123;
    const after = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1 }).expectedReturn;
    CMA.equity_us.expReturn = original; // restore for downstream tests
    expect(after).toBeCloseTo(0.123, 6);
    expect(after).not.toBeCloseTo(before, 4);
  });

  it("FX-hedge sigma reduction stays composable on top of CMA σ for foreign equity", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const { CMA } = await import("../src/lib/metrics");
    // CHF investor holding US equity → foreign equity → hedged should cut σ by 0.03
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const unhedged = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1, hedged: false, baseCurrency: "CHF" });
    const hedged = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1, hedged: true, baseCurrency: "CHF" });
    expect(unhedged.expectedVol).toBeCloseTo(CMA.equity_us.vol, 6);
    expect(hedged.expectedVol).toBeCloseTo(Math.max(0.05, CMA.equity_us.vol - 0.03), 6);
  });

  it("Monte Carlo expected vol equals analytical portfolio vol when hedging is off (full covariance)", async () => {
    // Regression: a previous implementation used a diagonal-only variance
    // (Σ w² σ²), which over-stated portfolio σ for any diversified
    // allocation by ignoring cross-asset covariance. The fix uses the
    // same full ΣΣ w_i w_j σ_i σ_j ρ_ij formula as metrics.portfolioVol,
    // so the MC headline number must agree with the analytical Risk &
    // Performance Metrics view exactly when no FX-hedge adjustment is in
    // play.
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const { mapAllocationToAssets, portfolioVol } = await import("../src/lib/metrics");
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Equity", region: "Europe", weight: 20 },
      { assetClass: "Fixed Income", region: "Global", weight: 25 },
      { assetClass: "Commodities", region: "Global", weight: 5 },
    ];
    const mc = runMonteCarlo(alloc, 5, 100_000, { paths: 100, seed: 1, hedged: false, baseCurrency: "USD" });
    const analytical = portfolioVol(mapAllocationToAssets(alloc));
    expect(mc.expectedVol).toBeCloseTo(analytical, 8);
    // Sanity: with the new (correlation-aware) formula, this equity-
    // heavy mix's vol must be STRICTLY ABOVE the naïve diagonal-only
    // Σ w² σ² — because most equity-equity correlations in this app's
    // CMA are positive (0.7-0.85), and the previous diagonal-only
    // formula effectively pretended ρ=0. This proves the cross-term
    // covariance is actually being added.
    const exposures = mapAllocationToAssets(alloc);
    const { CMA } = await import("../src/lib/metrics");
    let diagOnly = 0;
    for (const e of exposures) diagOnly += e.weight * e.weight * CMA[e.key].vol * CMA[e.key].vol;
    expect(mc.expectedVol).toBeGreaterThan(Math.sqrt(diagOnly));
    // And the full vol must still be below the trivial worst case
    // (perfect correlation = weighted-average of σ), which is the
    // textbook "diversification benefit" sanity check.
    let weightedAvgSigma = 0;
    for (const e of exposures) weightedAvgSigma += e.weight * CMA[e.key].vol;
    expect(mc.expectedVol).toBeLessThan(weightedAvgSigma);
  });

  it("Monte Carlo vol stays at-or-below analytical vol when hedging is on (FX hedge cuts σ further)", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const { mapAllocationToAssets, portfolioVol } = await import("../src/lib/metrics");
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 10 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
    ];
    // CHF investor with hedging on → US + EU equity sigmas get a 3pp cut.
    const mcHedged = runMonteCarlo(alloc, 5, 100_000, { paths: 100, seed: 1, hedged: true, baseCurrency: "CHF" });
    const analytical = portfolioVol(mapAllocationToAssets(alloc));
    expect(mcHedged.expectedVol).toBeLessThanOrEqual(analytical + 1e-9);
    // And the cut should be material — at least 1pp on this mix.
    expect(analytical - mcHedged.expectedVol).toBeGreaterThan(0.01);
  });

  it("applyCMALayers stays sanitized across repeated calls (consensus path)", async () => {
    // Reviewer-flagged regression: a single sanitize-once-at-module-load IIFE
    // would let a later applyCMALayers() call (triggered on every idl-cma-changed
    // event) re-introduce malformed consensus values. Verify the sanitizer is
    // re-applied on every call by injecting a malformed value into the live
    // CONSENSUS object and calling applyCMALayers() multiple times.
    const metrics = await import("../src/lib/metrics");
    const consensusMod = await import("../src/data/cmas.consensus.json");
    const consensus = (consensusMod.default ?? consensusMod) as {
      assets?: Record<string, { consensus?: { expReturn?: unknown; vol?: unknown } }>;
    };
    consensus.assets = consensus.assets ?? {};
    const original = consensus.assets.bonds;
    consensus.assets.bonds = { consensus: { expReturn: 99, vol: -5 } }; // way out of bounds
    try {
      for (let i = 0; i < 3; i++) metrics.applyCMALayers();
      // Both malformed values must be rejected on every call → fall through to seed.
      expect(metrics.CMA.bonds.expReturn).toBeGreaterThanOrEqual(-0.5);
      expect(metrics.CMA.bonds.expReturn).toBeLessThanOrEqual(1);
      expect(metrics.CMA.bonds.vol).toBeGreaterThanOrEqual(0);
      expect(metrics.CMA.bonds.vol).toBeLessThanOrEqual(2);
    } finally {
      if (original) consensus.assets.bonds = original;
      else delete consensus.assets.bonds;
      metrics.applyCMALayers();
    }
  });

  it("getCMAOverrides discards entries with unknown keys and out-of-bounds values", async () => {
    const { getCMAOverrides } = await import("../src/lib/settings");
    // Simulate tampered localStorage by stubbing window.localStorage
    const fakeStore: Record<string, string> = {
      "idl.cmaOverrides": JSON.stringify({
        equity_us: { expReturn: 0.08, vol: 0.18 },
        nonsense_key: { expReturn: 0.05 },
        crypto: { expReturn: 5, vol: 99 }, // out of bounds → clamped not dropped
        bonds: { expReturn: "abc" }, // wrong type → dropped
      }),
    };
    const orig = (globalThis as { window?: { localStorage: Storage } }).window;
    (globalThis as unknown as { window: { localStorage: Pick<Storage, "getItem"> } }).window = {
      localStorage: { getItem: (k: string) => fakeStore[k] ?? null },
    };
    try {
      const o = getCMAOverrides();
      expect(o.equity_us).toEqual({ expReturn: 0.08, vol: 0.18 });
      expect(o.nonsense_key).toBeUndefined();
      expect(o.crypto?.expReturn).toBe(1); // clamped to upper bound
      expect(o.crypto?.vol).toBe(2);       // clamped to upper bound
      expect(o.bonds).toBeUndefined();     // wrong type → entry dropped
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("home-bias overrides: increasing CHF multiplier raises Switzerland equity weight; reset restores default", async () => {
    const settings = await import("../src/lib/settings");
    // Local helper — equityWeightOf is scoped to a different describe block.
    const eqW = (out: ReturnType<typeof buildPortfolio>, region: string) =>
      out.allocation
        .filter((a) => a.assetClass === "Equity" && a.region === region)
        .reduce((s, a) => s + a.weight, 0);
    // Use a real in-memory localStorage stub so set/get/remove all work consistently.
    const fakeStore: Record<string, string> = {};
    const orig = (globalThis as { window?: unknown }).window;
    (globalThis as unknown as { window: { localStorage: Storage; dispatchEvent: () => boolean } }).window = {
      localStorage: {
        getItem: (k: string) => fakeStore[k] ?? null,
        setItem: (k: string, v: string) => { fakeStore[k] = v; },
        removeItem: (k: string) => { delete fakeStore[k]; },
        clear: () => { for (const k of Object.keys(fakeStore)) delete fakeStore[k]; },
        key: () => null,
        length: 0,
      } as Storage,
      dispatchEvent: () => true,
    };
    try {
      // Baseline (engine default factor 2.5 for CHF).
      const baseline = buildPortfolio(baseInput({ baseCurrency: "CHF", numETFs: 12 }));
      const baselineCH = eqW(baseline, "Switzerland");
      // Bump CHF multiplier well above default.
      settings.setHomeBiasOverrides({ CHF: 4.5 });
      expect(settings.resolvedHomeBias("CHF")).toBe(4.5);
      const tilted = buildPortfolio(baseInput({ baseCurrency: "CHF", numETFs: 12 }));
      const tiltedCH = eqW(tilted, "Switzerland");
      expect(tiltedCH).toBeGreaterThan(baselineCH);
      // Out-of-bounds → clamped to [0, 5]
      settings.setHomeBiasOverrides({ CHF: 999 });
      expect(settings.resolvedHomeBias("CHF")).toBe(5);
      // Reset removes user override; engine default returns.
      settings.resetHomeBiasOverrides();
      expect(settings.resolvedHomeBias("CHF")).toBe(2.5);
      const restored = buildPortfolio(baseInput({ baseCurrency: "CHF", numETFs: 12 }));
      // After reset, Switzerland weight is again equal to the baseline (within rounding).
      expect(Math.abs(eqW(restored, "Switzerland") - baselineCH)).toBeLessThan(0.01);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("risk-free rate override: changing RF shifts equity bucket weights; reset restores baseline", async () => {
    const settings = await import("../src/lib/settings");
    const eqW = (out: ReturnType<typeof buildPortfolio>, region: string) =>
      out.allocation
        .filter((a) => a.assetClass === "Equity" && a.region === region)
        .reduce((s, a) => s + a.weight, 0);
    const fakeStore: Record<string, string> = {};
    const orig = (globalThis as { window?: unknown }).window;
    (globalThis as unknown as { window: { localStorage: Storage; dispatchEvent: () => boolean } }).window = {
      localStorage: {
        getItem: (k: string) => fakeStore[k] ?? null,
        setItem: (k: string, v: string) => { fakeStore[k] = v; },
        removeItem: (k: string) => { delete fakeStore[k]; },
        clear: () => { for (const k of Object.keys(fakeStore)) delete fakeStore[k]; },
        key: () => null,
        length: 0,
      } as Storage,
      dispatchEvent: () => true,
    };
    try {
      // Baseline at default RF (2.50%).
      const baseline = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      const baselineUS = eqW(baseline, "USA");
      const baselineEM = eqW(baseline, "EM");
      // Raise RF to 6%. With CMA expReturns roughly in [4–9%], higher RF
      // compresses Sharpe across the board AND shifts the relative ranking
      // toward higher-expReturn / higher-vol regions (EM) vs developed (USA).
      settings.setRiskFreeRate(0.06);
      expect(settings.getRiskFreeRate()).toBeCloseTo(0.06, 6);
      const tilted = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      const tiltedUS = eqW(tilted, "USA");
      const tiltedEM = eqW(tilted, "EM");
      // Bucket weights must move (the whole point of this change). At least
      // one developed region must shift by a measurable amount.
      const usaShift = Math.abs(tiltedUS - baselineUS);
      const emShift = Math.abs(tiltedEM - baselineEM);
      expect(usaShift + emShift).toBeGreaterThan(0.5);
      // Reset → baseline restored within rounding.
      settings.resetRiskFreeRate();
      expect(settings.getRiskFreeRate()).toBeCloseTo(0.025, 6);
      const restored = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      expect(Math.abs(eqW(restored, "USA") - baselineUS)).toBeLessThan(0.01);
      expect(Math.abs(eqW(restored, "EM") - baselineEM)).toBeLessThan(0.01);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("getHomeBiasOverrides drops unknown currencies and clamps out-of-bounds multipliers", async () => {
    const { getHomeBiasOverrides } = await import("../src/lib/settings");
    const fakeStore: Record<string, string> = {
      "idl.homeBiasOverrides": JSON.stringify({
        EUR: 1.8,
        XYZ: 2.0,         // unknown currency → dropped
        CHF: 99,          // out of bounds → clamped to 5
        GBP: -3,          // negative → clamped to 0
        USD: "abc",       // wrong type → dropped
      }),
    };
    const orig = (globalThis as { window?: { localStorage: Storage } }).window;
    (globalThis as unknown as { window: { localStorage: Pick<Storage, "getItem"> } }).window = {
      localStorage: { getItem: (k: string) => fakeStore[k] ?? null },
    };
    try {
      const o = getHomeBiasOverrides();
      expect(o.EUR).toBe(1.8);
      expect(o.CHF).toBe(5);
      expect(o.GBP).toBe(0);
      expect(o.USD).toBeUndefined();
      expect((o as Record<string, unknown>).XYZ).toBeUndefined();
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("Euronext is preserved in the catalog but is never picked when the user expressed a preference (LSE/XETRA/SIX) or when a non-Euronext alternative exists", () => {
    // (a) preferredExchange = "None": defaultExchange wins, Euronext does not appear
    //     for ETFs that have a non-Euronext default listing (which is every catalog entry today).
    const inNone = baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "None" });
    const cspxNone = getETFDetails("Equity", "USA", inNone);
    const eimiNone = getETFDetails("Equity", "EM", inNone);
    const sgldNone = getETFDetails("Commodities", "Gold", inNone);
    expect(cspxNone.exchange).not.toBe("Euronext");
    expect(eimiNone.exchange).not.toBe("Euronext");
    expect(sgldNone.exchange).not.toBe("Euronext");

    // (b) preferredExchange = "LSE" / "XETRA" / "SIX": that venue wins when listed,
    //     and Euronext never wins as a fallback either.
    const inLSE = baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "LSE" });
    expect(getETFDetails("Equity", "USA", inLSE).exchange).toBe("LSE");
    expect(getETFDetails("Equity", "EM", inLSE).exchange).toBe("LSE");

    const inXETRA = baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "XETRA" });
    expect(getETFDetails("Equity", "USA", inXETRA).exchange).toBe("XETRA");

    const inSIX = baseInput({ baseCurrency: "CHF", numETFs: 12, preferredExchange: "SIX" });
    expect(getETFDetails("Equity", "Switzerland", inSIX).exchange).toBe("SIX");

    // (c) The full portfolio output must not show Euronext anywhere either, since every
    //     catalog ETF has at least one of LSE/XETRA/SIX. (Regression guard for the
    //     "Euronext is in data but invisible to user" contract.)
    const out = buildPortfolio(inNone);
    for (const impl of out.etfImplementation) {
      expect(impl.exchange).not.toBe("Euronext");
    }
  });
});

// ----------------------------------------------------------------------------
// Cross-tab last-allocation pub/sub
// ----------------------------------------------------------------------------
// The Build tab publishes its current portfolio's allocation through a tiny
// in-memory pub/sub slot in src/lib/settings.ts so the Methodology tab can
// reflect it (e.g. mark "held" rows on the static correlation matrix). The
// store must:
//   - return null when nothing has been published,
//   - publish via a CustomEvent on `window`,
//   - clone the payload (so caller mutations don't bleed into stored state),
//   - clear back to null when called with `null` or `[]`.
// These tests use the same window-stub pattern as the home-bias / CMA tests
// so they work in vitest's `node` environment.
describe("setLastAllocation / subscribeLastAllocation (cross-tab pub/sub)", () => {
  it("round-trips an allocation through the store and dispatches a CustomEvent", async () => {
    const orig = (globalThis as { window?: unknown }).window;
    type Listener = (e: { detail: unknown }) => void;
    const listeners: Listener[] = [];
    (globalThis as unknown as { window: { addEventListener: (t: string, l: Listener) => void; removeEventListener: (t: string, l: Listener) => void; dispatchEvent: (e: { detail: unknown }) => boolean; CustomEvent: typeof CustomEvent } }).window = {
      addEventListener: (_t, l) => { listeners.push(l); },
      removeEventListener: (_t, l) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); },
      dispatchEvent: (e) => { for (const l of [...listeners]) l(e); return true; },
      CustomEvent: class {
        type: string; detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
      } as unknown as typeof CustomEvent,
    };
    // Also expose CustomEvent on the global so settings.ts's `new CustomEvent(...)` resolves.
    const origCE = (globalThis as { CustomEvent?: unknown }).CustomEvent;
    (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent = class {
      type: string; detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
    } as unknown as typeof CustomEvent;
    try {
      const settings = await import("../src/lib/settings");
      // Start clean.
      settings.setLastAllocation(null);
      expect(settings.getLastAllocation()).toBe(null);
      const received: Array<unknown> = [];
      const unsub = settings.subscribeLastAllocation((a) => received.push(a));
      // Publish a real allocation.
      const alloc = [
        { assetClass: "Equity", region: "USA", weight: 60 },
        { assetClass: "Cash", region: "Cash", weight: 40 },
      ];
      settings.setLastAllocation(alloc);
      const stored = settings.getLastAllocation();
      expect(stored).not.toBe(null);
      expect(stored!.length).toBe(2);
      expect(stored![0].region).toBe("USA");
      expect(received.length).toBe(1);
      // Mutating the original input must not mutate stored state (deep-ish copy).
      alloc[0].weight = 999;
      expect(settings.getLastAllocation()![0].weight).toBe(60);
      // Clearing publishes null.
      settings.setLastAllocation(null);
      expect(settings.getLastAllocation()).toBe(null);
      expect(received[received.length - 1]).toBe(null);
      // Empty array is treated as "cleared" (no held markers in Methodology).
      settings.setLastAllocation([]);
      expect(settings.getLastAllocation()).toBe(null);
      // Unsubscribe stops further callbacks.
      unsub();
      const before = received.length;
      settings.setLastAllocation([{ assetClass: "Equity", region: "USA", weight: 100 }]);
      expect(received.length).toBe(before);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
      if (origCE) (globalThis as unknown as { CustomEvent: typeof origCE }).CustomEvent = origCE;
      else delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
    }
  });
});

// ---------------------------------------------------------------------------
// Manual weight overrides
// ---------------------------------------------------------------------------
import {
  applyManualWeights,
  bucketKey,
  parseManualWeightInput,
  parseDecimalInput,
} from "../src/lib/manualWeights";

// ---------------------------------------------------------------------------
// Generalised decimal parser used by every numeric input that may receive a
// locale-comma decimal on mobile (Investment Amount in Fee Estimator and
// Monte Carlo, weight cells in Explain My Portfolio, manual weight cell in
// Build Portfolio). Same regex / mid-edit semantics as parseManualWeightInput
// but exposes min / max / decimals so each callsite picks its own bounds.
// ---------------------------------------------------------------------------
describe("manualWeights.parseDecimalInput", () => {
  it("accepts dot and comma decimals identically (the reason this exists)", () => {
    expect(parseDecimalInput("100000.50")).toBe(100000.5);
    expect(parseDecimalInput("100000,50")).toBe(100000.5);
    expect(parseDecimalInput("100000,50")).toBe(parseDecimalInput("100000.50"));
  });

  it("returns the raw number when no clamps or rounding are configured", () => {
    expect(parseDecimalInput("250")).toBe(250);
    expect(parseDecimalInput("0,3")).toBe(0.3);
    expect(parseDecimalInput("-5")).toBe(-5);
  });

  it("respects the min clamp (Investment Amount uses min: 0)", () => {
    expect(parseDecimalInput("-5", { min: 0 })).toBe(0);
    expect(parseDecimalInput("12,5", { min: 0 })).toBe(12.5);
  });

  it("respects the max clamp", () => {
    expect(parseDecimalInput("250", { max: 100 })).toBe(100);
    expect(parseDecimalInput("99", { max: 100 })).toBe(99);
  });

  it("rounds to the requested number of decimals before clamping", () => {
    expect(parseDecimalInput("12,345", { decimals: 1 })).toBe(12.3);
    expect(parseDecimalInput("12,345", { decimals: 2 })).toBe(12.35);
    expect(parseDecimalInput("12,345", { decimals: 0 })).toBe(12);
  });

  it("rejects empty / whitespace / garbage with null", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("12abc")).toBeNull();
    expect(parseDecimalInput("12.3.4")).toBeNull();
    expect(parseDecimalInput("12,3,4")).toBeNull();
    expect(parseDecimalInput("12 5")).toBeNull();
  });

  it("accepts mid-edit partial decimals so a phone blur does not drop input", () => {
    expect(parseDecimalInput("12.")).toBe(12);
    expect(parseDecimalInput("12,")).toBe(12);
    expect(parseDecimalInput(".5")).toBe(0.5);
    expect(parseDecimalInput(",5")).toBe(0.5);
  });

  it("parseManualWeightInput is now a thin wrapper with [0,100] / 1dp", () => {
    // Round-trip the old contract so we know nothing regressed in Task #12.
    expect(parseManualWeightInput("12,5")).toBe(parseDecimalInput("12,5", { min: 0, max: 100, decimals: 1 }));
    expect(parseManualWeightInput("250")).toBe(parseDecimalInput("250", { min: 0, max: 100, decimals: 1 }));
    expect(parseManualWeightInput("-5")).toBe(parseDecimalInput("-5", { min: 0, max: 100, decimals: 1 }));
  });
});

describe("manualWeights.parseManualWeightInput", () => {
  it("accepts a plain dot decimal: '12.5' → 12.5", () => {
    expect(parseManualWeightInput("12.5")).toBe(12.5);
  });

  it("accepts a locale comma decimal: '12,5' → 12.5 (Swiss/German/French keypad)", () => {
    expect(parseManualWeightInput("12,5")).toBe(12.5);
  });

  it("dot and comma decimals round-trip to the same stored value", () => {
    expect(parseManualWeightInput("12,5")).toBe(parseManualWeightInput("12.5"));
    expect(parseManualWeightInput("0,3")).toBe(parseManualWeightInput("0.3"));
  });

  it("accepts integers", () => {
    expect(parseManualWeightInput("40")).toBe(40);
    expect(parseManualWeightInput("0")).toBe(0);
    expect(parseManualWeightInput("100")).toBe(100);
  });

  it("trims surrounding whitespace", () => {
    expect(parseManualWeightInput("  12,5  ")).toBe(12.5);
  });

  it("clamps values above 100 down to 100", () => {
    expect(parseManualWeightInput("250")).toBe(100);
  });

  it("clamps negative values up to 0", () => {
    expect(parseManualWeightInput("-5")).toBe(0);
  });

  it("rounds to one decimal place to match the storage convention", () => {
    expect(parseManualWeightInput("12.34")).toBe(12.3);
    expect(parseManualWeightInput("12,37")).toBe(12.4);
  });

  it("rejects empty / whitespace-only input as null (caller reverts to engine value)", () => {
    expect(parseManualWeightInput("")).toBeNull();
    expect(parseManualWeightInput("   ")).toBeNull();
  });

  it("rejects garbage so a fat-fingered keystroke does not pin a wild value", () => {
    expect(parseManualWeightInput("abc")).toBeNull();
    expect(parseManualWeightInput("12abc")).toBeNull();
    expect(parseManualWeightInput("12.3.4")).toBeNull();
    expect(parseManualWeightInput("12,3,4")).toBeNull();
    expect(parseManualWeightInput("12 5")).toBeNull();
  });

  it("accepts mid-edit partial decimals so an accidental blur does not lose the value", () => {
    // These are common keystroke states on a phone; if the user blurs at
    // any of them the cell should commit a sensible number rather than
    // reverting (or, worse, clearing an existing override).
    expect(parseManualWeightInput("12.")).toBe(12);
    expect(parseManualWeightInput("12,")).toBe(12);
    expect(parseManualWeightInput(".5")).toBe(0.5);
    expect(parseManualWeightInput(",5")).toBe(0.5);
  });
});

describe("manualWeights.applyManualWeights", () => {
  const sumWeights = (rows: Array<{ weight: number }>) =>
    Math.round(rows.reduce((s, r) => s + r.weight, 0) * 10) / 10;

  it("returns natural rows unchanged when no overrides are provided", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 30 },
      { bucket: "Cash - USD", weight: 10 },
    ];
    const r = applyManualWeights(natural, {});
    expect(r.appliedCount).toBe(0);
    expect(r.staleKeys).toEqual([]);
    expect(r.saturated).toBe(false);
    expect(r.rows.map(x => x.weight)).toEqual([60, 30, 10]);
    expect(r.rows.every(x => !x.isManualOverride)).toBe(true);
  });

  it("pins a single row and proportionally redistributes the residual", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 30 },
      { bucket: "Cash - USD", weight: 10 },
    ];
    const r = applyManualWeights(natural, { "Equity - USA": 40 });
    expect(r.appliedCount).toBe(1);
    expect(r.saturated).toBe(false);
    expect(r.rows[0]).toMatchObject({ bucket: "Equity - USA", weight: 40, isManualOverride: true });
    // Residual = 60, distributed 30:10 → 45:15.
    expect(r.rows[1].weight).toBeCloseTo(45, 1);
    expect(r.rows[2].weight).toBeCloseTo(15, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("pins multiple rows; non-pinned rows still sum the residual", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 50 },
      { bucket: "Equity - Europe", weight: 20 },
      { bucket: "Bonds - Global", weight: 20 },
      { bucket: "Cash - USD", weight: 10 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 25,
      "Cash - USD": 5,
    });
    expect(r.appliedCount).toBe(2);
    expect(r.rows[0]).toMatchObject({ weight: 25, isManualOverride: true });
    expect(r.rows[3]).toMatchObject({ weight: 5, isManualOverride: true });
    // Residual = 70 split between Europe(20) and Bonds(20) → 35/35.
    expect(r.rows[1].weight).toBeCloseTo(35, 1);
    expect(r.rows[2].weight).toBeCloseTo(35, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("scales pinned rows down proportionally when their sum is strictly above 100 and zeroes the rest (over)", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 50 },
      { bucket: "Bonds - Global", weight: 30 },
      { bucket: "Cash - USD", weight: 20 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 80,
      "Bonds - Global": 40,
    });
    expect(r.saturated).toBe(true);
    expect(r.over).toBe(true);
    // Pinned sum = 120, scale = 100/120 → USA = 80*5/6 ≈ 66.7; Bonds = 40*5/6 ≈ 33.3.
    expect(r.rows[0].weight).toBeCloseTo(66.7, 1);
    expect(r.rows[1].weight).toBeCloseTo(33.3, 1);
    expect(r.rows[2].weight).toBe(0);
    expect(sumWeights(r.rows)).toBe(100);
    expect(r.pinnedSum).toBe(120);
  });

  it("just-above-100 (110) flags `over` and scales pinned rows down proportionally", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 40 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 80,
      "Bonds - Global": 30,
    });
    expect(r.over).toBe(true);
    expect(r.saturated).toBe(true);
    // Pinned sum 110, scale = 100/110 → USA = 80*10/11 ≈ 72.7; Bonds = 30*10/11 ≈ 27.3.
    expect(r.rows[0].weight).toBeCloseTo(72.7, 1);
    expect(r.rows[1].weight).toBeCloseTo(27.3, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("treats sum exactly 100 as saturated but NOT over — pinned values kept as-is, no scaling", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 40 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 70,
      "Bonds - Global": 30,
    });
    expect(r.saturated).toBe(true);
    expect(r.over).toBe(false);
    // Pinned values are kept exactly as the user typed them (no scaling).
    expect(r.rows[0].weight).toBe(70);
    expect(r.rows[1].weight).toBe(30);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("treats a near-exact-100 sum (float drift like 99.9999998) as exactly-100, not over", () => {
    const natural = [
      { bucket: "A - 1", weight: 50 },
      { bucket: "B - 1", weight: 30 },
      { bucket: "C - 1", weight: 20 },
    ];
    // Three 0.1-step inputs that sum to 99.99999999... in IEEE-754:
    //   0.1 + 0.2 = 0.30000000000000004
    // Scaled up to percentages: 33.3 + 33.3 + 33.4 = 100.0 exactly,
    // but 33.1 + 33.2 + 33.7 leaves us with float drift.
    const a = 33.1, b = 33.2, c = 33.7;
    const r = applyManualWeights(natural, { "A - 1": a, "B - 1": b, "C - 1": c });
    // Sum is 100 ± ~1e-13; should NOT trigger `over`.
    expect(r.over).toBe(false);
    expect(r.saturated).toBe(true);
    // Pinned values are kept as typed (rounded to 1 dp); no scaling kicked in.
    expect(r.rows[0].weight).toBeCloseTo(a, 1);
    expect(r.rows[1].weight).toBeCloseTo(b, 1);
    expect(r.rows[2].weight).toBeCloseTo(c, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("flags overrides for buckets not present as stale, without applying them", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 40 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 50,
      "Digital Assets - Broad Crypto": 5, // stale
    });
    expect(r.appliedCount).toBe(1);
    expect(r.staleKeys).toEqual(["Digital Assets - Broad Crypto"]);
    expect(r.rows[0].weight).toBeCloseTo(50, 1);
    expect(r.rows[1].weight).toBeCloseTo(50, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("accepts a 0% override (excludes a row without removing it)", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 30 },
      { bucket: "Cash - USD", weight: 10 },
    ];
    const r = applyManualWeights(natural, { "Cash - USD": 0 });
    expect(r.rows[2]).toMatchObject({ weight: 0, isManualOverride: true });
    expect(sumWeights(r.rows)).toBe(100);
    // Residual = 100 distributed across Equity(60) and Bonds(30) → 66.7 / 33.3.
    expect(r.rows[0].weight).toBeCloseTo(66.7, 1);
    expect(r.rows[1].weight).toBeCloseTo(33.3, 1);
  });

  it("clamps inputs outside [0, 100] before applying", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 40 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 150,   // → 100
      "Bonds - Global": -25, // → 0
    });
    expect(r.saturated).toBe(true);
    expect(r.rows[0].weight).toBe(100);
    expect(r.rows[1].weight).toBe(0);
  });

  it("scales pinned rows up proportionally when there are no non-pinned rows and pinned sum < 100", () => {
    const natural = [
      { bucket: "Equity - USA", weight: 60 },
      { bucket: "Bonds - Global", weight: 40 },
    ];
    const r = applyManualWeights(natural, {
      "Equity - USA": 30,
      "Bonds - Global": 20,
    });
    // Pinned sum 50, no non-pinned rows → scale up by 2 to fill 100.
    expect(r.rows[0].weight).toBeCloseTo(60, 1);
    expect(r.rows[1].weight).toBeCloseTo(40, 1);
    expect(sumWeights(r.rows)).toBe(100);
  });

  it("absorbs rounding drift on the largest non-pinned row so the total is exactly 100", () => {
    // Three non-pinned rows of equal natural weight + one pinned row whose
    // residual does not divide evenly.
    const natural = [
      { bucket: "A - 1", weight: 25 },
      { bucket: "B - 1", weight: 25 },
      { bucket: "C - 1", weight: 25 },
      { bucket: "D - 1", weight: 25 },
    ];
    const r = applyManualWeights(natural, { "A - 1": 31 });
    // Residual 69 / 75 ≈ 0.92 → each non-pinned ≈ 23 (rounded to 1 dp).
    expect(sumWeights(r.rows)).toBe(100);
    expect(r.rows[0]).toMatchObject({ weight: 31, isManualOverride: true });
  });

  it("end-to-end: buildPortfolio applies overrides and the engine output sums to 100", () => {
    const natural = buildPortfolio(baseInput(), "en");
    const usEquity = natural.allocation.find(a => a.assetClass === "Equity" && a.region === "USA");
    expect(usEquity).toBeTruthy();
    const overrides = { [bucketKey("Equity", "USA")]: 10 };
    const overridden = buildPortfolio(baseInput(), "en", overrides);
    const usOverridden = overridden.allocation.find(a => a.assetClass === "Equity" && a.region === "USA");
    expect(usOverridden?.weight).toBeCloseTo(10, 1);
    expect(usOverridden?.isManualOverride).toBe(true);
    const total = Math.round(overridden.allocation.reduce((s, a) => s + a.weight, 0) * 10) / 10;
    expect(total).toBe(100);
    // The implementation table mirrors the override flag.
    const usEtf = overridden.etfImplementation.find(e => e.assetClass === "Equity" && e.bucket.endsWith("USA"));
    expect(usEtf?.isManualOverride).toBe(true);
    expect(usEtf?.weight).toBeCloseTo(10, 1);
  });
});

// ---------------------------------------------------------------------------
// Saved scenarios — custom-weights snapshot (Task #24)
// ---------------------------------------------------------------------------
// The Compare tab loads a saved scenario by passing both `input` and the
// optional `manualWeights` snapshot through to the engine. We verify the
// behavior at the engine boundary (the SavedScenariosUI wiring is exercised
// indirectly through these contracts) and confirm that A/B snapshots do not
// leak into each other.
describe("savedScenarios — manual-weights snapshot round-trips through buildPortfolio", () => {
  it("a saved entry with a snapshot reproduces the same allocation as building with overrides", () => {
    // Simulate "save then load": the user pinned Equity-USA = 25 in Build,
    // saved the scenario, then loaded it into Compare A. The Compare tab
    // calls buildPortfolio(input, lang, snapshot) — the result must be
    // bit-equal to a fresh buildPortfolio with the same overrides.
    const input = baseInput();
    const snapshot = { [bucketKey("Equity", "USA")]: 25 };
    const fromSnapshot = buildPortfolio(input, "en", snapshot);
    const fromOverrides = buildPortfolio(input, "en", { ...snapshot });
    expect(fromSnapshot.allocation.length).toBe(fromOverrides.allocation.length);
    for (let i = 0; i < fromSnapshot.allocation.length; i++) {
      expect(fromSnapshot.allocation[i].assetClass).toBe(fromOverrides.allocation[i].assetClass);
      expect(fromSnapshot.allocation[i].region).toBe(fromOverrides.allocation[i].region);
      expect(fromSnapshot.allocation[i].weight).toBeCloseTo(fromOverrides.allocation[i].weight, 6);
      expect(fromSnapshot.allocation[i].isManualOverride ?? false).toBe(
        fromOverrides.allocation[i].isManualOverride ?? false,
      );
    }
  });

  it("a saved entry without a snapshot produces the natural allocation (back-compat with pre-Task-#24 saves)", () => {
    // An older save (or a save made when the user had no pinned rows) has
    // no `manualWeights` field. The Compare tab calls buildPortfolio with
    // `undefined` and must get the natural allocation back.
    const input = baseInput();
    const natural = buildPortfolio(input, "en");
    const loadedNoSnapshot = buildPortfolio(input, "en", undefined);
    expect(loadedNoSnapshot.allocation.length).toBe(natural.allocation.length);
    for (let i = 0; i < natural.allocation.length; i++) {
      expect(loadedNoSnapshot.allocation[i].weight).toBeCloseTo(natural.allocation[i].weight, 6);
      // No row should be flagged as a manual override when no snapshot is
      // supplied — even if a stale localStorage entry was somehow present
      // elsewhere, the engine call is the single source of truth.
      expect(loadedNoSnapshot.allocation[i].isManualOverride ?? false).toBe(false);
    }
    // Empty-object snapshot should also behave as "no overrides" (Task #24
    // attaches a snapshot only when at least one row is pinned, but the
    // engine must remain robust if an empty object somehow makes it
    // through — e.g. from an older client that did not strip empty saves).
    const loadedEmpty = buildPortfolio(input, "en", {});
    for (let i = 0; i < natural.allocation.length; i++) {
      expect(loadedEmpty.allocation[i].weight).toBeCloseTo(natural.allocation[i].weight, 6);
      expect(loadedEmpty.allocation[i].isManualOverride ?? false).toBe(false);
    }
  });

  it("Compare A and B can carry different snapshots without leaking into each other", () => {
    // Two independent build calls model two slots in Compare. Slot A has
    // Equity-USA pinned; slot B has Bonds (any region present in baseInput)
    // pinned. The two outputs must reflect their own snapshot only — no
    // cross-contamination.
    const input = baseInput();
    const snapshotA = { [bucketKey("Equity", "USA")]: 30 };
    // Find a non-equity bucket present in the natural allocation to pin in B.
    const natural = buildPortfolio(input, "en");
    const bondRow = natural.allocation.find(a => a.assetClass === "Fixed Income");
    expect(bondRow).toBeTruthy();
    const snapshotB = { [bucketKey(bondRow!.assetClass, bondRow!.region)]: 50 };

    const outA = buildPortfolio(input, "en", snapshotA);
    const outB = buildPortfolio(input, "en", snapshotB);

    // A: Equity-USA is pinned to 30, the Fixed-Income bucket B pinned is NOT.
    const aUSA = outA.allocation.find(a => a.assetClass === "Equity" && a.region === "USA");
    const aBond = outA.allocation.find(a => a.assetClass === bondRow!.assetClass && a.region === bondRow!.region);
    expect(aUSA?.weight).toBeCloseTo(30, 1);
    expect(aUSA?.isManualOverride).toBe(true);
    expect(aBond?.isManualOverride ?? false).toBe(false);

    // B: the Fixed-Income bucket is pinned to 50, Equity-USA is NOT.
    const bUSA = outB.allocation.find(a => a.assetClass === "Equity" && a.region === "USA");
    const bBond = outB.allocation.find(a => a.assetClass === bondRow!.assetClass && a.region === bondRow!.region);
    expect(bBond?.weight).toBeCloseTo(50, 1);
    expect(bBond?.isManualOverride).toBe(true);
    expect(bUSA?.isManualOverride ?? false).toBe(false);

    // Both still sum to 100 within rounding.
    const sumA = Math.round(outA.allocation.reduce((s, a) => s + a.weight, 0) * 10) / 10;
    const sumB = Math.round(outB.allocation.reduce((s, a) => s + a.weight, 0) * 10) / 10;
    expect(sumA).toBe(100);
    expect(sumB).toBe(100);
  });
});
