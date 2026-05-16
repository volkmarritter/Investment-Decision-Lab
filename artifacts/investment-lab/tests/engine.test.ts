import { describe, it, expect, vi } from "vitest";
import { buildPortfolio, computeNaturalBucketCount } from "../src/lib/portfolio";
import { defaultExchangeFor, DEFAULT_EXCHANGE_FOR_CURRENCY } from "../src/lib/exchange";
import { runValidation } from "../src/lib/validation";
import { PortfolioInput, BaseCurrency, RiskAppetite } from "../src/lib/types";
import {
  profileFor,
  buildLookthrough,
  EM_CURRENCIES_KEY,
  XAU_GOLD_KEY,
} from "../src/lib/lookthrough";
import {
  getETFDetails,
  getCatalogEntry,
  listUnassignedInstruments,
  getInstrumentRole,
  getInstrumentAltIndex,
  getInstrumentPoolIndex,
} from "../src/lib/etfs";
import { comparePickerRows } from "../src/components/investment/ExplainPortfolio";
import { runStressTest, runReverseStressTest, SCENARIOS } from "../src/lib/scenarios";
import { estimateFees, getETFTer } from "../src/lib/fees";
import { buildAiPrompt } from "../src/lib/aiPrompt";
import { summarizeAllocationByGroup } from "../src/lib/allocationGroups";
import {
  mapAllocationToAssets,
  mapAllocationToAssetsLookthrough,
  computeMetrics,
  computeFrontier,
  buildCorrelationMatrix,
  decomposeTrackingError,
  BENCHMARK,
  portfolioReturn,
  portfolioVol,
  portfolioWhtDrag,
  WHT_DRAG,
} from "../src/lib/metrics";
import type { AssetAllocation, ETFImplementation } from "../src/lib/types";
import { diffPortfolios } from "../src/lib/compare";
import { bucketOrderKey } from "../src/lib/chartColors";
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
// Task #238 — structured `unmappedEtfs[]` loud-fail + catalog audit
// ---------------------------------------------------------------------------
describe("Task #238 — buildLookthrough.unmappedEtfs", () => {
  it("emits a structured row {isin,name,weight} for every ETF without a profile", () => {
    const fake = "XX0000000099";
    const etfs: import("../src/lib/types").ETFImplementation[] = [
      {
        bucket: "Equity - USA",
        assetClass: "Equity",
        weight: 12.5,
        intent: "Test fixture",
        exampleETF: "Fake satellite ETF",
        rationale: "",
        isin: fake,
        ticker: "FAKE",
        terBps: 10,
        domicile: "IE",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment: "",
      },
    ];
    const lt = buildLookthrough(etfs, "en", "USD");
    expect(lt.unmappedEtfs).toHaveLength(1);
    expect(lt.unmappedEtfs[0]).toEqual({
      isin: fake,
      name: "Fake satellite ETF",
      weight: 12.5,
    });
    // Legacy human-readable footnote stays in sync.
    expect(lt.unmapped).toEqual([`Fake satellite ETF (${fake})`]);
  });

  it("returns an empty unmappedEtfs[] when every position has a profile", () => {
    const out = buildPortfolio(
      baseInput({ baseCurrency: "USD", numETFs: 5, riskAppetite: "Moderate" }),
    );
    const lt = buildLookthrough(out.etfImplementation, "en", "USD");
    expect(lt.unmappedEtfs).toEqual([]);
  });
});

describe("Task #238 — validateLookthroughCoverage", () => {
  it("every catalog ISIN (default + alternative + pool) is covered by a curated profile", async () => {
    const { validateLookthroughCoverage } = await import("../src/lib/etfs");
    const gaps = validateLookthroughCoverage(
      (isin: string) => profileFor(isin) !== null,
    );
    // Production invariant (Task #238 hardening): EVERY bucket slot
    // — default, alternative AND pool — must resolve to its OWN
    // per-ISIN look-through profile. Pool entries are pickable in
    // Build's "More ETFs" dialog and Explain's per-bucket IsinPicker,
    // so a missing profile would immediately trip the destructive
    // "unmapped ETFs" alert for any user who picks them. There is NO
    // alias / sibling-substitution lookup — every covered ISIN must
    // appear directly in PROFILES (curated primaries,
    // SHARED_BASKET_PROFILES variants for true index/share-class
    // equivalents, or DISTINCT_PROFILES for genuinely distinct funds).
    // If this assertion fails after adding a new ETF, add a per-ISIN
    // entry to one of those three groups in src/lib/lookthrough.ts.
    expect(gaps).toEqual([]);
  });

  it("reports gaps with bucketKey + role + isin when the predicate misses", async () => {
    const { validateLookthroughCoverage } = await import("../src/lib/etfs");
    const gaps = validateLookthroughCoverage(() => false);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(["default", "alternative", "pool"]).toContain(g.role);
      expect(g.isin).toMatch(/^[A-Z]{2}[A-Z0-9]{9}\d$/);
      expect(typeof g.bucketKey).toBe("string");
      expect(g.bucketKey.length).toBeGreaterThan(0);
    }
  });

  // Anti-substitution sanity check (Task #238 code-review hardening):
  // genuinely distinct funds in the catalog MUST NOT share their
  // look-through profile with the bucket default they were lumped
  // under. This guards against regressing back to ALIAS-style
  // substitution where e.g. an MSCI World tracker would silently
  // present S&P 500 data, or a robotics/AI sub-theme would inherit
  // broad US-tech maps.
  it("distinct funds keep distinct profiles (no bucket-peer substitution)", () => {
    // FTSE 100 (UK-only) vs S&P 500 (US-only) — both are equity
    // single-country trackers but they live in different buckets and
    // their geo maps must not collapse to each other.
    const uk = profileFor("IE00B53HP851"); // FTSE 100
    const us = profileFor("IE00B5BMR087"); // S&P 500
    expect(uk).not.toBeNull();
    expect(us).not.toBeNull();
    expect(uk!.geo).not.toEqual(us!.geo);
    expect(uk!.geo["United Kingdom"]).toBeGreaterThanOrEqual(95);
    expect(us!.geo["United States"]).toBeGreaterThanOrEqual(95);

    // Xtrackers MSCI World (LU0274208692) is a pool entry near S&P 500
    // trackers but the underlying basket includes ~30% non-US DM. It
    // MUST present its own MSCI World profile, not the S&P 500 one.
    const msciWorld = profileFor("LU0274208692");
    expect(msciWorld).not.toBeNull();
    expect(msciWorld!.geo).not.toEqual(us!.geo);
    expect(msciWorld!.geo["United States"]).toBeLessThan(85);
    expect(msciWorld!.geo["Japan"] ?? 0).toBeGreaterThan(0);

    // Global X Robotics & AI (IE00BLCHJB90) — sub-theme, ~22% Japan.
    // Must NOT collapse to broad S&P 500 IT (IE00B3WJKG14, US-only).
    const robotics = profileFor("IE00BLCHJB90");
    const sp500It = profileFor("IE00B3WJKG14");
    expect(robotics).not.toBeNull();
    expect(sp500It).not.toBeNull();
    expect(robotics!.geo).not.toEqual(sp500It!.geo);
    expect(robotics!.geo["Japan"] ?? 0).toBeGreaterThan(0);
    expect(sp500It!.geo["Japan"] ?? 0).toBe(0);

    // First Trust Clean Energy (IE00BDBRT036) vs MSCI ESG global
    // (IE00B1XNHC34) — different funds, different geo concentration
    // (clean-energy is ~78% US, ESG is broader DM).
    const cleanEnergy = profileFor("IE00BDBRT036");
    const esg = profileFor("IE00B1XNHC34");
    expect(cleanEnergy).not.toBeNull();
    expect(esg).not.toBeNull();
    expect(cleanEnergy!.geo).not.toEqual(esg!.geo);

    // iShares Euro Govt 3-7yr (IE00B3VTML14) vs Global Aggregate Bond
    // (IE00B3F81409) — single-currency EUR sovereign vs multi-currency
    // multi-sector. Geo and sector must both differ.
    const euGov = profileFor("IE00B3VTML14");
    const globalAgg = profileFor("IE00B3F81409");
    expect(euGov).not.toBeNull();
    expect(globalAgg).not.toBeNull();
    expect(euGov!.geo).not.toEqual(globalAgg!.geo);
    expect(euGov!.sector).not.toEqual(globalAgg!.sector);
    expect(euGov!.currency).toEqual({ EUR: 100 });
  });

  // Task #238 round 6 — backfilled bond pool entries MUST be marked
  // isEquity:false so analyzeLookthrough routes them to the
  // fixed-income geo path. The 6 bond ISINs added by the
  // 2026-05-10 backfill (IE00B3F81409, LU0378818131, IE00BG47KH54,
  // IE00BG47KB92, LU0290355717, IE00BDBRDM35) originally landed
  // without an explicit isEquity flag and would have defaulted to
  // true — silently misattributing their geo as equity exposure.
  // The override file now sets the flag explicitly, AND the loader
  // also infers it from the entry name as defense-in-depth.
  it("backfilled bond pool ISINs are profiled as fixed income, not equity", () => {
    for (const isin of [
      "IE00B3F81409", // iShares Core Global Aggregate Bond
      "LU0378818131", // Xtrackers II Global Government Bond
      "IE00BG47KH54", // Vanguard Global Aggregate Bond EUR Hedged Acc
      "IE00BG47KB92", // Vanguard Global Aggregate Bond EUR Hedged Dist
      "LU0290355717", // Xtrackers II Eurozone Government Bond
      "IE00BDBRDM35", // iShares Core Global Aggregate Bond EUR Hedged
    ]) {
      const p = profileFor(isin);
      expect(p, `profile for ${isin}`).not.toBeNull();
      expect(p!.isEquity, `${isin} must be isEquity:false`).toBe(false);
    }
  });

  // Regression for the user-reported nine-position portfolio (Task
  // #238 round 3). The exact ISIN list mirrors the reproducer in
  // tests/e2e/explain-import-lookthrough.spec.ts (REPRO_TEXT). Every
  // ISIN — including the off-catalog SPDR US Dividend Aristocrats
  // (IE00B3VWP018) and the off-catalog Amundi MSCI EM (LU1230136894)
  // that the reviewer specifically flagged — must own its own
  // per-ISIN profile so the look-through aggregate surfaces the
  // correct geo attribution without sibling substitution.
  it("nine-position user-reported portfolio: every ISIN profiled, geo attribution correct", () => {
    const positions: ETFImplementation[] = [
      { isin: "IE00B5BMR087", weight: 25, exampleETF: "iShares Core S&P 500", terBps: 7,
        bucket: "Equity - USA", region: "USA", assetClass: "Equity" },
      { isin: "IE00BKX55T58", weight: 10, exampleETF: "Vanguard FTSE Developed World", terBps: 12,
        bucket: "Equity - Global", region: "Global", assetClass: "Equity" },
      { isin: "IE0005042456", weight: 10, exampleETF: "iShares Core FTSE 100 (Dist)", terBps: 7,
        bucket: "Equity - UK", region: "UK", assetClass: "Equity" },
      { isin: "IE00BKM4GZ66", weight: 10, exampleETF: "iShares MSCI EM IMI", terBps: 18,
        bucket: "Equity - EM", region: "EM", assetClass: "Equity" },
      { isin: "IE00B53QDK08", weight: 5, exampleETF: "iShares MSCI Japan (Acc)", terBps: 12,
        bucket: "Equity - Japan", region: "Japan", assetClass: "Equity" },
      { isin: "IE00B42WWV65", weight: 10, exampleETF: "Vanguard U.K. Gilt", terBps: 5,
        bucket: "FixedIncome - UK", region: "UK", assetClass: "FixedIncome" },
      { isin: "IE00B3VWP018", weight: 10, exampleETF: "SPDR S&P US Dividend Aristocrats", terBps: 35,
        bucket: "Equity - USA", region: "USA", assetClass: "Equity" },
      { isin: "LU1230136894", weight: 5, exampleETF: "Amundi MSCI Emerging Markets", terBps: 20,
        bucket: "Equity - EM", region: "EM", assetClass: "Equity" },
      { isin: "IE00B4ND3602", weight: 15, exampleETF: "iShares Physical Gold", terBps: 12,
        bucket: "Commodities - Gold", region: "Global", assetClass: "Commodities" },
    ];
    const lt = buildLookthrough(positions, "en", "CHF");

    // Anti-substitution check: each off-catalog ISIN that the
    // reviewer specifically flagged must own its OWN profile.
    expect(profileFor("IE00B3VWP018")).not.toBeNull();
    expect(profileFor("LU1230136894")).not.toBeNull();
    expect(profileFor("IE00B42WWV65")).not.toBeNull();

    const aristo = profileFor("IE00B3VWP018")!;
    const sp500 = profileFor("IE00B5BMR087")!;
    expect(aristo.sector).not.toEqual(sp500.sector);
    const amundiEm = profileFor("LU1230136894")!;
    const ishEm = profileFor("IE00BKM4GZ66")!;
    expect(amundiEm.geo).not.toEqual(ishEm.geo);

    expect(lt.unmappedEtfs).toEqual([]);

    const ukGilt = profileFor("IE00B42WWV65")!;
    expect(ukGilt.isEquity).toBe(false);
    expect(ukGilt.geo).toEqual({ "United Kingdom": 100 });
    expect(ukGilt.currency).toEqual({ GBP: 100 });
  });

  // Original UK-leaning regression (kept verbatim).
  it("nine-position UK-leaning portfolio surfaces UK geo attribution", () => {
    const positions: ETFImplementation[] = [
      // UK home-bias slug (35%): FTSE 100
      { isin: "IE00B53HP851", weight: 35, exampleETF: "iShares FTSE 100", terBps: 7,
        bucket: "Equity - UK", region: "UK", assetClass: "Equity" },
      // S&P 500 (20%)
      { isin: "IE00B5BMR087", weight: 20, exampleETF: "iShares Core S&P 500", terBps: 7,
        bucket: "Equity - USA", region: "USA", assetClass: "Equity" },
      // MSCI Europe (10%)
      { isin: "IE00B4K48X80", weight: 10, exampleETF: "iShares MSCI Europe", terBps: 12,
        bucket: "Equity - Europe", region: "Europe", assetClass: "Equity" },
      // MSCI EM (8%)
      { isin: "IE00BKM4GZ66", weight: 8, exampleETF: "iShares MSCI EM IMI", terBps: 18,
        bucket: "Equity - EM", region: "EM", assetClass: "Equity" },
      // MSCI Japan (7%)
      { isin: "IE00B4L5YX21", weight: 7, exampleETF: "iShares MSCI Japan", terBps: 12,
        bucket: "Equity - Japan", region: "Japan", assetClass: "Equity" },
      // Global Aggregate Bond GBP Hedged (10%) — currency-hedged variant
      { isin: "IE00BDBRDP65", weight: 10, exampleETF: "iShares Global Agg GBP Hedged", terBps: 10,
        bucket: "FixedIncome - Global", region: "Global", assetClass: "FixedIncome" },
      // Gold ETC (5%)
      { isin: "IE00B579F325", weight: 5, exampleETF: "Invesco Physical Gold", terBps: 12,
        bucket: "Commodities - Gold", region: "Global", assetClass: "Commodities" },
      // Bitcoin ETP (5%) — bumped from 3% so weights still total 100
      // without including a Cash sentinel row (which buildLookthrough
      // surfaces as "unmapped" by design — see the dedicated Cash
      // sentinel suite for that path).
      { isin: "GB00BLD4ZL17", weight: 5, exampleETF: "CoinShares Bitcoin", terBps: 95,
        bucket: "DigitalAssets - BroadCrypto", region: "Global", assetClass: "DigitalAssets" },
    ];
    const lt = buildLookthrough(positions, "en", "GBP");
    // No row should drop into the destructive unmapped alert — every
    // ISIN above must own a per-ISIN profile post-Task-#238.
    expect(lt.unmappedEtfs).toEqual([]);
    // UK attribution: FTSE 100 contributes 35pp at 100% UK weight, plus
    // small UK satellite weight from MSCI Europe (~23% of 10pp = ~2.3)
    // and Global Agg (~5% of the 10pp bond sleeve). So total UK should
    // be ≥ 35pp — the regression we're guarding against would zero it
    // out by routing FTSE 100 through a non-UK sibling.
    const equityGeoMap: Record<string, number> = Object.fromEntries(lt.geoEquity);
    expect(equityGeoMap["United Kingdom"] ?? 0).toBeGreaterThanOrEqual(35);
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
    // Read the expected ISIN from the live catalog so this test stays
    // green if a curator swaps the default for the Equity-USA-EUR bucket.
    expect(d.isin).toBe(getCatalogEntry("Equity-USA-EUR")!.isin);
    expect(d.currency).toBe("EUR");
  });

  it("hedged + GBP base picks the GBP-hedged S&P 500 (IE00BYX5MS15)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "GBP", includeCurrencyHedging: true, preferredExchange: "LSE" })
    );
    expect(d.isin).toBe(getCatalogEntry("Equity-USA-GBP")!.isin);
  });

  it("synthetic + USD base picks the synthetic S&P 500 (IE00B3YCGJ38)", () => {
    const d = getETFDetails(
      "Equity",
      "USA",
      baseInput({ baseCurrency: "USD", includeSyntheticETFs: true })
    );
    expect(d.isin).toBe(getCatalogEntry("Equity-USA-Synthetic")!.isin);
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
    expect(d.isin).toBe(getCatalogEntry("Equity-USA")!.isin);
  });

  it("Switzerland always selects the SPI ETF on SIX", () => {
    const d = getETFDetails("Equity", "Switzerland", baseInput({ baseCurrency: "CHF" }));
    expect(d.isin).toBe(getCatalogEntry("Equity-Switzerland")!.isin);
    expect(d.exchange).toBe("SIX");
  });

  it("Fixed Income picks the CHF-hedged aggregate when hedging + CHF base", () => {
    const d = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({ baseCurrency: "CHF", includeCurrencyHedging: true, preferredExchange: "SIX" })
    );
    expect(d.isin).toBe(getCatalogEntry("FixedIncome-Global-CHF")!.isin);
  });

  it("Fixed Income picks the unhedged global aggregate when no hedging", () => {
    const d = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({ baseCurrency: "USD", includeCurrencyHedging: false })
    );
    expect(d.isin).toBe(getCatalogEntry("FixedIncome-Global")!.isin);
  });

  // Task #300 — bond-only FX hedge: when full hedging is OFF but
  // hedgeForeignBonds is ON and base ≠ USD, the FI bucket should still
  // resolve to the CHF-hedged variant, while equity stays unhedged.
  it("Task #300 — bond-only hedge routes FI to hedged share class (CHF base, full-hedge OFF)", () => {
    const fi = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({
        baseCurrency: "CHF",
        includeCurrencyHedging: false,
        hedgeForeignBonds: true,
        preferredExchange: "SIX",
      })
    );
    expect(fi.isin).toBe(getCatalogEntry("FixedIncome-Global-CHF")!.isin);
    // Equity must stay unhedged — bond-only must not leak into equity.
    const eq = getETFDetails(
      "Equity",
      "USA",
      baseInput({
        baseCurrency: "CHF",
        includeCurrencyHedging: false,
        hedgeForeignBonds: true,
        preferredExchange: "SIX",
      })
    );
    expect(eq.isin).toBe(getCatalogEntry("Equity-USA")!.isin);
  });

  // Bond-only is a no-op when base = USD: there's no foreign-currency
  // bond exposure to hedge, so the FI bucket stays unhedged.
  it("Task #300 — bond-only hedge is a no-op for USD base", () => {
    const fi = getETFDetails(
      "Fixed Income",
      "Global",
      baseInput({
        baseCurrency: "USD",
        includeCurrencyHedging: false,
        hedgeForeignBonds: true,
      })
    );
    expect(fi.isin).toBe(getCatalogEntry("FixedIncome-Global")!.isin);
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
    expect(d.isin).toBe(getCatalogEntry("Equity-Technology")!.isin);
  });

  it("Real Estate, Commodities and Digital Assets all resolve to a real ETF", () => {
    const re = getETFDetails("Real Estate", "Global REITs", baseInput());
    const co = getETFDetails("Commodities", "Gold", baseInput());
    const da = getETFDetails("Digital Assets", "Broad Crypto", baseInput());
    expect(re.isin).toBe(getCatalogEntry("RealEstate-GlobalREITs")!.isin);
    expect(co.isin).toBe(getCatalogEntry("Commodities-Gold")!.isin);
    expect(da.isin).toBe(getCatalogEntry("DigitalAssets-BroadCrypto")!.isin);
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

  it("thematic tilt is part of the equity sleeve, not a satellite", () => {
    // Regression for the "thematic = equity, not satellite" mapping.
    //
    // Setup: numETFs=5 with REITs + Crypto + Theme=Technology enabled, and
    // a Moderate risk so crypto is a tiny 1% sleeve. Under the old engine
    // (Thematic in the satellite-drop list, sorted by weight ascending) the
    // 1% Crypto sleeve would be dropped first to make room, leaving 5
    // sleeves; if more pruning was needed the next-smallest satellite —
    // the 3% Thematic — would also be dropped.
    //
    // Under the new mapping the satellite-drop list contains only REITs /
    // Crypto / Commodities, so Thematic always survives this pass and
    // shows up in the allocation as an equity bucket
    // (assetClass="Equity", region="Technology").
    const out = buildPortfolio(
      baseInput({
        thematicPreference: "Technology",
        riskAppetite: "Moderate",
        includeCrypto: true,
        includeListedRealEstate: true,
        numETFs: 5,
        numETFsMin: 5,
      })
    );
    const thematicRow = out.allocation.find(
      (a) => a.assetClass === "Equity" && a.region === "Technology"
    );
    expect(thematicRow, "Thematic equity row must survive a tight ETF cap").toBeDefined();
    expect(thematicRow!.weight).toBeGreaterThan(0);
    // Total equity (incl. thematic) should still match the requested
    // equity allocation modulo rounding — confirms thematic is sourced
    // from the equity budget, not invented on top of it.
    const totalEquity = out.allocation
      .filter((a) => a.assetClass === "Equity")
      .reduce((s, a) => s + a.weight, 0);
    const noTheme = buildPortfolio(
      baseInput({
        thematicPreference: "None",
        riskAppetite: "Moderate",
        includeCrypto: true,
        includeListedRealEstate: true,
        numETFs: 5,
        numETFsMin: 5,
      })
    );
    const totalEquityNoTheme = noTheme.allocation
      .filter((a) => a.assetClass === "Equity")
      .reduce((s, a) => s + a.weight, 0);
    expect(totalEquity).toBeCloseTo(totalEquityNoTheme, 0);

    // End-to-end check: the AllocationGroupSummary tile (built from
    // classifyGroup) must put the thematic weight into Equities, not
    // Satellites. This is the surface the user actually sees in the
    // Build / Compare panels.
    const grouped = summarizeAllocationByGroup(out.allocation);
    const byGroup = Object.fromEntries(
      grouped.map((g) => [g.group, g.weight])
    );
    const groupedNoTheme = summarizeAllocationByGroup(noTheme.allocation);
    const byGroupNoTheme = Object.fromEntries(
      groupedNoTheme.map((g) => [g.group, g.weight])
    );
    // Same satellites group weight with or without the theme — Thematic
    // does NOT inflate the Satellites tile.
    expect(byGroup.Satellites).toBeCloseTo(byGroupNoTheme.Satellites, 0);
    // Same equities group weight too — confirming Thematic is part of
    // Equities and the equity budget is conserved.
    expect(byGroup.Equities).toBeCloseTo(byGroupNoTheme.Equities, 0);
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
      const regions = ["USA", "Europe", "UK", "Switzerland", "Japan", "EM"];
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
    expect(equityWeightOf(gbp, "UK")).toBeGreaterThan(0);
    expect(equityWeightOf(usd, "UK")).toBe(0);
    expect(equityWeightOf(eur, "UK")).toBe(0);
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

  it("GBP base produces a separate Equity-UK bucket and ETF (mirrors CHF / Switzerland)", () => {
    const gbp = buildPortfolio(baseInput({ baseCurrency: "GBP", numETFs: 12, preferredExchange: "LSE" }));
    const usd = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
    const eur = buildPortfolio(baseInput({ baseCurrency: "EUR", numETFs: 12, preferredExchange: "XETRA" }));

    // GBP must have a UK equity row; USD / EUR must not.
    const gbpUk = gbp.allocation.find((a) => a.assetClass === "Equity" && a.region === "UK");
    expect(gbpUk).toBeDefined();
    expect(gbpUk!.weight).toBeGreaterThan(0);
    expect(usd.allocation.find((a) => a.region === "UK")).toBeUndefined();
    expect(eur.allocation.find((a) => a.region === "UK")).toBeUndefined();

    // The picked ETF must be the FTSE-100 tracker (the Equity-UK catalog slot)
    // — i.e. UK gets its own ETF implementation row, not a roll-up into Europe.
    const gbpUkEtf = gbp.etfImplementation.find((e) => e.bucket === "Equity - UK");
    expect(gbpUkEtf).toBeDefined();
    expect(gbpUkEtf!.isin).toBe(getCatalogEntry("Equity-UK")!.isin);
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

  it("compacted Home equity row picks up the home-currency shock (GBP→Equity_UK, CHF→Equity_Switzerland)", () => {
    const alloc = [
      { assetClass: "Equity", region: "Home", weight: 50 },
      { assetClass: "Equity", region: "Global", weight: 30 },
      { assetClass: "Cash", region: "Global", weight: 20 },
    ];
    for (const sc of SCENARIOS) {
      // No baseCurrency → backward-compat fallback to USA shock.
      const usFallback = runStressTest(alloc).find((r) => r.id === sc.id)!;
      const homeUsd = usFallback.contributions.find((c) => c.key === "Equity - Home")!;
      expect(homeUsd.shock).toBe(sc.shocks["Equity_USA"]);
      // GBP base → Equity_UK shock.
      const gbp = runStressTest(alloc, "GBP").find((r) => r.id === sc.id)!;
      const homeGbp = gbp.contributions.find((c) => c.key === "Equity - Home")!;
      expect(homeGbp.shock).toBe(sc.shocks["Equity_UK"]);
      // CHF base → Equity_Switzerland shock.
      const chf = runStressTest(alloc, "CHF").find((r) => r.id === sc.id)!;
      const homeChf = chf.contributions.find((c) => c.key === "Equity - Home")!;
      expect(homeChf.shock).toBe(sc.shocks["Equity_Switzerland"]);
      // EUR base → Equity_Europe shock.
      const eur = runStressTest(alloc, "EUR").find((r) => r.id === sc.id)!;
      const homeEur = eur.contributions.find((c) => c.key === "Equity - Home")!;
      expect(homeEur.shock).toBe(sc.shocks["Equity_Europe"]);
    }
  });

  it("UK equity sleeve picks up the dedicated Equity_UK shock for a GBP portfolio", () => {
    const alloc = [
      { assetClass: "Equity", region: "UK", weight: 10 },
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Cash", region: "Global", weight: 40 },
    ];
    for (const sc of SCENARIOS) {
      const r = runStressTest(alloc).find((x) => x.id === sc.id)!;
      const uk = r.contributions.find((c) => c.key === "Equity - UK")!;
      // Must use the Equity_UK shock from the scenario, not the Equity_Global fallback.
      expect(uk.shock).toBe(sc.shocks["Equity_UK"]);
      // And it must differ from Equity_Global at least once across the three
      // scenarios — proves the dedicated key actually flows through.
    }
    const ukShocks = SCENARIOS.map((s) => s.shocks["Equity_UK"]);
    const globalShocks = SCENARIOS.map((s) => s.shocks["Equity_Global"]);
    expect(ukShocks.some((s, i) => s !== globalShocks[i])).toBe(true);
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

  // Task #300 — bond-only hedge: the +15 bps surcharge must apply ONLY
  // to Fixed Income, not Equity / Real Estate. With this alloc the
  // surcharge is 30% × 15 bps = +4.5 bps blended (vs +13.5 bps for the
  // full hedge above).
  it("Task #300 — hedgeForeignBonds adds +15 bps to Fixed Income only", () => {
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
      { assetClass: "Cash", region: "USD", weight: 10 },
    ];
    const noHedge = estimateFees(alloc, 10, 100_000);
    const bondsHedged = estimateFees(alloc, 10, 100_000, {
      hedgeForeignBonds: true,
      hedgingCostBps: 15,
    });
    expect(bondsHedged.blendedTerBps - noHedge.blendedTerBps).toBeCloseTo(4.5, 1);
    // Full hedge subsumes — turning both on must not double-charge FI.
    const both = estimateFees(alloc, 10, 100_000, {
      hedged: true,
      hedgeForeignBonds: true,
      hedgingCostBps: 15,
    });
    expect(both.blendedTerBps - noHedge.blendedTerBps).toBeCloseTo(13.5, 1);
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

  // Regression for the "Fee Estimator does not react when ETF is changed"
  // bug: when the BuildPortfolio per-bucket picker swaps the picked ETF,
  // estimateFees now consumes the actual `terBps` of the picked ETF
  // instead of the asset-class default. Without `etfImplementations`, the
  // default 12 bps (Equity USA) is used; with it, the supplied 35 bps wins.
  it("uses per-bucket etfImplementations TER when supplied (overrides asset-class default)", () => {
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const baseline = estimateFees(alloc, 10, 100_000);
    expect(baseline.blendedTerBps).toBeCloseTo(12, 1);

    const withPickedEtf = estimateFees(alloc, 10, 100_000, {
      etfImplementations: [{ bucket: "Equity - USA", terBps: 35 }],
    });
    expect(withPickedEtf.blendedTerBps).toBeCloseTo(35, 1);
    expect(withPickedEtf.annualFee).toBeCloseTo(100_000 * (35 / 10_000), 2);
    // Also reflected in the per-bucket breakdown row.
    expect(withPickedEtf.breakdown[0].terBps).toBe(35);
  });

  // Regression for Task #196: when a single bucket holds multiple ETFs (as
  // in Explain when the user adds more than one fund to the same bucket),
  // the effective per-bucket TER must be a weight-average of each ETF's
  // TER — not the last-write-wins value the original Map.set produced.
  it("weight-averages TER across multiple ETFs in the same bucket", () => {
    // 10% at 20 bps + 5% at 60 bps -> (10*20 + 5*60) / 15 = 33.333… bps
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 15 }];
    const r = estimateFees(alloc, 10, 100_000, {
      etfImplementations: [
        { bucket: "Equity - USA", terBps: 20, weight: 10 },
        { bucket: "Equity - USA", terBps: 60, weight: 5 },
      ],
    });
    const eqRow = r.breakdown.find((b) => b.key === "Equity - USA")!;
    expect(eqRow.terBps).toBeCloseTo((10 * 20 + 5 * 60) / 15, 5);
    // Single-ETF bucket sanity: averaging one entry equals that entry.
    const single = estimateFees(alloc, 10, 100_000, {
      etfImplementations: [{ bucket: "Equity - USA", terBps: 42, weight: 15 }],
    });
    expect(
      single.breakdown.find((b) => b.key === "Equity - USA")!.terBps
    ).toBeCloseTo(42, 5);
  });

  it("etfImplementations TER falls back to asset-class default for unmatched buckets (e.g. Cash)", () => {
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Cash", region: "USD", weight: 50 },
    ];
    // Operator picked a 35 bps ETF for the Equity sleeve; Cash is not in
    // the implementation table at all, so it must keep the 10 bps default.
    const r = estimateFees(alloc, 10, 100_000, {
      etfImplementations: [{ bucket: "Equity - USA", terBps: 35 }],
    });
    const eqRow = r.breakdown.find((b) => b.key === "Equity - USA")!;
    const cashRow = r.breakdown.find((b) => b.key === "Cash - USD")!;
    expect(eqRow.terBps).toBe(35);
    expect(cashRow.terBps).toBe(10);
    expect(r.blendedTerBps).toBeCloseTo((35 + 10) / 2, 1);
  });

  // Task #271 — per-bucket terSource aggregation feeds the Fee Estimator badge.
  describe("terSource aggregation on breakdown rows", () => {
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];

    it("propagates the source when all contributing rows agree", () => {
      const r = estimateFees(alloc, 10, 100_000, {
        etfImplementations: [
          { bucket: "Equity - USA", terBps: 20, weight: 5, terSource: "operator" },
          { bucket: "Equity - USA", terBps: 25, weight: 5, terSource: "operator" },
        ],
      });
      expect(r.breakdown[0].terSource).toBe("operator");
    });

    it("returns undefined for buckets with conflicting explicit sources", () => {
      const r = estimateFees(alloc, 10, 100_000, {
        etfImplementations: [
          { bucket: "Equity - USA", terBps: 20, weight: 5, terSource: "operator" },
          { bucket: "Equity - USA", terBps: 25, weight: 5, terSource: "justetf" },
        ],
      });
      expect(r.breakdown[0].terSource).toBeUndefined();
    });

    it("returns undefined when a catalog row (no source) is mixed with a manual row (with source)", () => {
      // Catalog rows leave terSource undefined; pairing one with a
      // sourced manual row in the same bucket would mislabel the
      // weighted-blend TER, so the badge must be suppressed.
      const r = estimateFees(alloc, 10, 100_000, {
        etfImplementations: [
          { bucket: "Equity - USA", terBps: 12, weight: 5 },
          { bucket: "Equity - USA", terBps: 25, weight: 5, terSource: "default" },
        ],
      });
      expect(r.breakdown[0].terSource).toBeUndefined();
    });

    it("leaves terSource undefined for catalog-only buckets", () => {
      const r = estimateFees(alloc, 10, 100_000, {
        etfImplementations: [
          { bucket: "Equity - USA", terBps: 12, weight: 10 },
        ],
      });
      expect(r.breakdown[0].terSource).toBeUndefined();
    });
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

  it("mapAllocationToAssets resolves Equity-Home + Equity-Global from sleeve compaction", () => {
    // When the ETF budget is too small, the engine collapses the equity
    // sleeve into "Home" + "Global" rows (portfolio.ts:280-287). The
    // metrics layer must resolve these to real CMA buckets — otherwise
    // they fall through to equity_thematic and balloon vol / TE / beta.
    // Home → equity_us for USD, equity_ch for CHF.
    const usd = mapAllocationToAssets(
      [{ assetClass: "Equity", region: "Home", weight: 40 }],
      "USD",
    );
    expect(usd.find((e) => e.key === "equity_us")?.weight).toBeCloseTo(0.4);
    expect(usd.find((e) => e.key === "equity_thematic")).toBeUndefined();

    const chf = mapAllocationToAssets(
      [{ assetClass: "Equity", region: "Home", weight: 40 }],
      "CHF",
    );
    expect(chf.find((e) => e.key === "equity_ch")?.weight).toBeCloseTo(0.4);

    // Global → distributed across BENCHMARK weights (60/14/4/4/4/14).
    const glob = mapAllocationToAssets(
      [{ assetClass: "Equity", region: "Global", weight: 100 }],
      "USD",
    );
    const get = (k: string) => glob.find((e) => e.key === k)?.weight ?? 0;
    const benchSum = BENCHMARK.reduce((s, e) => s + e.weight, 0);
    for (const b of BENCHMARK) {
      expect(get(b.key)).toBeCloseTo(b.weight / benchSum);
    }
    expect(get("equity_thematic")).toBe(0);

    // A 100% Global portfolio must have ~zero tracking error vs the ACWI
    // benchmark — this is the regression that motivated the fix.
    const m = computeMetrics(
      [{ assetClass: "Equity", region: "Global", weight: 100 }],
      "USD",
    );
    expect(m.trackingError).toBeLessThan(0.005);
    expect(m.beta).toBeCloseTo(1.0, 1);
    expect(m.vol).toBeLessThan(0.18);
  });

  it("decomposeTrackingError contributions sum to total TE and surface gold + home-bias as drivers", () => {
    // Recreates the operator's allocation: CHF base, 89.5% equities with a
    // strong Swiss home tilt, 7.5% gold, 3% cash. The user perceived a 2.5%
    // TE as suspiciously high — this test pins the decomposition that
    // explains it: gold + Swiss overweight should be the top contributors.
    const alloc: AssetAllocation[] = [
      { assetClass: "Cash", region: "CHF", weight: 3.0 },
      { assetClass: "Equity", region: "USA", weight: 51.3 },
      { assetClass: "Equity", region: "Switzerland", weight: 13.9 },
      { assetClass: "Equity", region: "EM", weight: 11.6 },
      { assetClass: "Equity", region: "Europe", weight: 8.7 },
      { assetClass: "Equity", region: "Japan", weight: 4.0 },
      { assetClass: "Commodities", region: "Gold", weight: 7.5 },
    ];
    const m = computeMetrics(alloc, "CHF");
    const d = decomposeTrackingError(alloc, "CHF");

    // Total of decomposition equals computeMetrics' tracking error.
    expect(d.total).toBeCloseTo(m.trackingError, 6);

    // Per-asset signed contributions sum to the total (definition: the
    // marginal-contribution decomposition closes mathematically).
    const sum = d.rows.reduce((s, r) => s + r.contribution, 0);
    expect(sum).toBeCloseTo(d.total, 6);

    // Sanity-check the actual drivers (counter-intuitive result worth
    // pinning): the largest positive TE contributors are the *underweights*
    // vs. the ACWI benchmark (US -8.7pp, EU -5.3pp, UK -4pp, EM -2.4pp)
    // plus the +7.5pp gold position. The Swiss home-bias overweight is
    // actually a *diversifier* against the equity underweights, so its
    // contribution is negative — confirming the engine's tilt logic does
    // partly absorb, not amplify, TE in this kind of portfolio.
    const us = d.rows.find((r) => r.key === "equity_us");
    const gold = d.rows.find((r) => r.key === "gold");
    const ch = d.rows.find((r) => r.key === "equity_ch");
    expect(us).toBeDefined();
    expect(gold).toBeDefined();
    expect(ch).toBeDefined();
    // US underweight is the single largest positive contributor.
    expect(us!.contribution).toBeGreaterThan(0);
    expect(us!.contribution / d.total).toBeGreaterThan(0.3);
    // Gold contributes meaningfully (no benchmark counterpart, ~zero corr
    // with equities).
    expect(gold!.contribution).toBeGreaterThan(0);
    expect(gold!.contribution / d.total).toBeGreaterThan(0.1);
    // Swiss overweight is a *diversifier* here, not a driver.
    expect(ch!.contribution).toBeLessThan(0);

    // UK appears even though the portfolio holds none — pure benchmark
    // underweight (active = -4pp).
    const uk = d.rows.find((r) => r.key === "equity_uk");
    expect(uk).toBeDefined();
    expect(uk!.portfolioWeight).toBe(0);
    expect(uk!.benchmarkWeight).toBeCloseTo(0.04, 6);
    expect(uk!.activeWeight).toBeCloseTo(-0.04, 6);

    // And cash appears even though the benchmark holds none — pure
    // portfolio-only position (active = +3pp). Locks the symmetric case
    // of the union-of-keys logic (benchmark-only AND portfolio-only both
    // surface as rows).
    const cash = d.rows.find((r) => r.key === "cash");
    expect(cash).toBeDefined();
    expect(cash!.portfolioWeight).toBeCloseTo(0.03, 6);
    expect(cash!.benchmarkWeight).toBe(0);
    expect(cash!.activeWeight).toBeCloseTo(0.03, 6);

    // Pure benchmark portfolio has TE ≈ 0 → decomposition is empty/zero.
    const benchAlloc: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 14 },
      { assetClass: "Equity", region: "UK", weight: 4 },
      { assetClass: "Equity", region: "Switzerland", weight: 4 },
      { assetClass: "Equity", region: "Japan", weight: 4 },
      { assetClass: "Equity", region: "EM", weight: 14 },
    ];
    const dBench = decomposeTrackingError(benchAlloc, "USD");
    expect(dBench.total).toBeLessThan(0.001);
  });

  it("mapAllocationToAssetsLookthrough decomposes Europe ETF into UK + CH + continental EU", () => {
    // Operator-spotted inconsistency: the iShares Core MSCI Europe ETF
    // (IE00B4K48X80) holds ~20% UK + ~15% Switzerland (the curated
    // PROFILES values are continually refreshed by
    // scripts/refresh-lookthrough.mjs into lookthrough.overrides.json,
    // so we read live values from profileFor() rather than hardcoding).
    // The region-based router treats a 14% Equity-Europe row as 14%
    // equity_eu, which understates UK/CH exposure and makes them look
    // perpetually underweight in the TE-contribution table even when
    // held implicitly through a multi-country ETF.
    const ISIN = "IE00B4K48X80";
    const profile = profileFor(ISIN)!;
    expect(profile).toBeTruthy();
    const totalGeo = Object.values(profile.geo).reduce((s, v) => s + v, 0);
    const ukPct = (profile.geo["United Kingdom"] ?? 0) / totalGeo;
    const chPct = (profile.geo["Switzerland"] ?? 0) / totalGeo;
    // Sanity: this ETF is *the* multi-country test case — UK + CH must
    // each be material (>5% of the ETF) for the look-through math to
    // matter at all. If the underlying index ever changes shape this
    // dramatically we want to know.
    expect(ukPct).toBeGreaterThan(0.05);
    expect(chPct).toBeGreaterThan(0.05);

    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Europe", weight: 14 },
    ];
    const etfImpl: ETFImplementation[] = [{
      bucket: "Equity - Europe",
      assetClass: "Equity",
      weight: 14,
      intent: "",
      exampleETF: "iShares Core MSCI Europe UCITS",
      rationale: "",
      isin: ISIN,
      ticker: "",
      exchange: "",
      terBps: 12,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "EUR",
      comment: "",
    }];

    const region = mapAllocationToAssets(allocation);
    const lookthrough = mapAllocationToAssetsLookthrough(allocation, etfImpl);

    // Region-based: all 14% routed to equity_eu — this is the broken
    // baseline the look-through fix replaces.
    expect(region.find((e) => e.key === "equity_eu")?.weight).toBeCloseTo(0.14, 6);
    expect(region.find((e) => e.key === "equity_uk")).toBeUndefined();
    expect(region.find((e) => e.key === "equity_ch")).toBeUndefined();

    // Look-through: 14% × ukPct goes to equity_uk, 14% × chPct to equity_ch,
    // and the remainder (continental-Europe country labels: France,
    // Germany, Netherlands, Sweden, Italy, Spain, Denmark, "Other Europe")
    // to equity_eu.
    const uk = lookthrough.find((e) => e.key === "equity_uk")!;
    const ch = lookthrough.find((e) => e.key === "equity_ch")!;
    const eu = lookthrough.find((e) => e.key === "equity_eu")!;
    expect(uk).toBeDefined();
    expect(ch).toBeDefined();
    expect(eu).toBeDefined();
    expect(uk.weight).toBeCloseTo(0.14 * ukPct, 6);
    expect(ch.weight).toBeCloseTo(0.14 * chPct, 6);
    // Continental-EU bucket is what's left after UK + CH are carved out.
    // Task #294 (2026-05): Ireland now routes to equity_eu (not residual),
    // so it is INCLUDED in continental-EU, and only the generic "Other"
    // catch-all flows into equity_other.
    const otherPct = (profile.geo["Other"] ?? 0) / totalGeo;
    expect(eu.weight).toBeCloseTo(0.14 * (1 - ukPct - chPct - otherPct), 4);
    if (otherPct > 0) {
      const otherBucket = lookthrough.find((e) => e.key === "equity_other")!;
      expect(otherBucket.weight).toBeCloseTo(0.14 * otherPct, 4);
    }

    // Closure: total exposure preserved (no weight silently dropped to
    // unmapped country labels).
    const total = lookthrough.reduce((s, e) => s + e.weight, 0);
    expect(total).toBeCloseTo(0.14, 6);
  });

  it("Task #241 / #294 — Vanguard FTSE Developed World: only justETF 'Other' lands in equity_other; Canada → US, Ireland → EU", () => {
    // Operator-spotted leak (Task #241): a 100 % position in
    // IE00BKX55T58 (Vanguard FTSE Developed World) should NOT show
    // ~76 % US Equity via the BENCHMARK proxy. Task #294 (2026-05)
    // refines the residual rule: Canada and Ireland now route to
    // equity_us / equity_eu respectively (no equity_ca / equity_ie
    // buckets, and this keeps the look-through ON / OFF buckets
    // consistent with the row-region router); only the generic
    // "Other" catch-all still flows into equity_other.
    const ISIN = "IE00BKX55T58";
    const profile = profileFor(ISIN)!;
    expect(profile?.isEquity).toBe(true);
    const totalGeo = Object.values(profile.geo).reduce((s, v) => s + v, 0);
    const usPubPct = (profile.geo["United States"] ?? 0) / totalGeo;
    const canadaPct = (profile.geo["Canada"] ?? 0) / totalGeo;
    const otherPct = (profile.geo["Other"] ?? 0) / totalGeo;
    const irelandPct = (profile.geo["Ireland"] ?? 0) / totalGeo;
    // Sanity: the residual must be material for this regression to bite.
    expect(otherPct).toBeGreaterThan(0.05);

    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Global", weight: 100 },
    ];
    const etfImpl: ETFImplementation[] = [{
      bucket: "Equity - Global",
      assetClass: "Equity", weight: 100, intent: "",
      exampleETF: "Vanguard FTSE Developed World", rationale: "",
      isin: ISIN, ticker: "", exchange: "", terBps: 12, domicile: "IE",
      replication: "Physical", distribution: "Distributing",
      currency: "USD", comment: "",
    }];

    const lookthrough = mapAllocationToAssetsLookthrough(allocation, etfImpl);
    const total = lookthrough.reduce((s, e) => s + e.weight, 0);
    const us = lookthrough.find((e) => e.key === "equity_us")?.weight ?? 0;
    const eu = lookthrough.find((e) => e.key === "equity_eu")?.weight ?? 0;
    const other = lookthrough.find((e) => e.key === "equity_other")?.weight ?? 0;

    // Total weight conserved.
    expect(total).toBeCloseTo(1.0, 6);
    // Task #294: equity_us = published US + Canada (no equity_ca bucket).
    expect(us).toBeCloseTo(usPubPct + canadaPct, 4);
    // Task #294: only the generic "Other" catch-all hits equity_other —
    // Ireland now contributes to equity_eu instead.
    expect(other).toBeCloseTo(otherPct, 4);
    // Defensive lower bound: Ireland's slice must show up *inside*
    // equity_eu (not equity_other), so equity_eu ≥ irelandPct.
    if (irelandPct > 0) {
      expect(eu).toBeGreaterThanOrEqual(irelandPct - 1e-6);
    }
  });

  it("Task #294 — Ireland slice of iShares Core MSCI Europe routes to equity_eu (not equity_other)", () => {
    // Pre-Task #294 the "Ireland" country label was intentionally absent
    // from COUNTRY_TO_EQUITY_KEY and fell into the unmappedShare →
    // equity_other residual. Task #294 adds Ireland → equity_eu so the
    // slice contributes to continental EU (Bank of Ireland is part of
    // MSCI Europe). The Core MSCI Europe ETF (IE00B4K48X80) carries a
    // small Ireland slice in its curated profile — assert it now flows
    // into equity_eu and nothing other than the generic "Other" label
    // hits equity_other.
    const ISIN = "IE00B4K48X80";
    const profile = profileFor(ISIN)!;
    const totalGeo = Object.values(profile.geo).reduce((s, v) => s + v, 0);
    const irelandPct = (profile.geo["Ireland"] ?? 0) / totalGeo;
    const otherPct = (profile.geo["Other"] ?? 0) / totalGeo;
    if (irelandPct <= 0) return; // profile refresh dropped the label; nothing to prove.

    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Europe", weight: 100 },
    ];
    const etfImpl: ETFImplementation[] = [{
      bucket: "Equity - Europe",
      assetClass: "Equity", weight: 100, intent: "",
      exampleETF: "iShares Core MSCI Europe UCITS", rationale: "",
      isin: ISIN, ticker: "", exchange: "", terBps: 12, domicile: "IE",
      replication: "Physical", distribution: "Accumulating",
      currency: "EUR", comment: "",
    }];
    const lt = mapAllocationToAssetsLookthrough(allocation, etfImpl);
    const other = lt.find((e) => e.key === "equity_other")?.weight ?? 0;
    // equity_other now equals only the generic "Other" slice — the
    // Ireland share is gone from the residual. Pre-#294 it would have
    // been (irelandPct + otherPct).
    expect(other).toBeCloseTo(otherPct, 4);
    if (otherPct > 0) {
      expect(other).toBeLessThan(irelandPct + otherPct - 1e-6);
    }
  });

  it("Task #294 — mapAllocationToAssets routes 'Asia Pacific ex-Japan' → equity_jp and 'Other' → equity_other (look-through OFF)", () => {
    const exp = mapAllocationToAssets([
      { assetClass: "Equity", region: "Asia Pacific ex-Japan", weight: 30 },
      { assetClass: "Equity", region: "Other", weight: 20 },
      // Catch-all preserved: sector labels still flow into thematic.
      { assetClass: "Equity", region: "Technology", weight: 10 },
    ]);
    const get = (k: string) => exp.find((e) => e.key === k)?.weight ?? 0;
    expect(get("equity_jp")).toBeCloseTo(0.3, 6);
    expect(get("equity_other")).toBeCloseTo(0.2, 6);
    expect(get("equity_thematic")).toBeCloseTo(0.1, 6);
  });

  it("Task #294 — routeByRegion fallback (look-through ON, no profile) routes 'Asia Pacific ex-Japan' → equity_jp and 'Other' → equity_other", () => {
    // No etfImplementation rows match the bucket keys, so every row
    // falls through to routeByRegion inside mapAllocationToAssetsLookthrough.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Asia Pacific ex-Japan", weight: 30 },
      { assetClass: "Equity", region: "Other", weight: 20 },
      { assetClass: "Equity", region: "Technology", weight: 10 },
    ];
    const lt = mapAllocationToAssetsLookthrough(allocation, []);
    const get = (k: string) => lt.find((e) => e.key === k)?.weight ?? 0;
    expect(get("equity_jp")).toBeCloseTo(0.3, 6);
    expect(get("equity_other")).toBeCloseTo(0.2, 6);
    expect(get("equity_thematic")).toBeCloseTo(0.1, 6);
  });


  it("Task #241 — buildRegionWeights surfaces 'Other' slices into otherPct instead of inflating NA/EM", async () => {
    // Companion of the metrics.ts test above, on the geomap layer.
    // REGION_BUCKETS no longer carries entries for "Other DM" or "Other"
    // — those labels fall through classifyCountry → "Other" → otherPct.
    // Before Task #241 a 10 % "Other" slice in a profile would push
    // 1.4 pp into NA, 0.4 pp into Europe, 3.5 pp into EM and only 4.7 pp
    // into otherPct.
    const { buildRegionWeights } = await import("../src/lib/geomap");
    const { weights, otherPct } = buildRegionWeights(
      [
        ["United States", 60],
        ["Japan", 6],
        ["Other DM", 12],
        ["Other", 8],
      ],
      "USD",
    );
    expect(weights.NA).toBeCloseTo(60, 4);
    expect(weights.Japan).toBeCloseTo(6, 4);
    // Both "Other" labels flow entirely into otherPct now — zero leak
    // into the named regions.
    expect(otherPct).toBeCloseTo(20, 4);
    expect(weights.EM).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Task #298 — geomap region routing aligned with the engine's
  // COUNTRY_TO_EQUITY_KEY table. Pins the Ireland → Europe move, the
  // APAC-developed → Japan-region merge, the expanded EM list and the
  // Poland/Greece/Hungary/Czechia Europe→EM correction.
  // -------------------------------------------------------------------------
  describe("Task #298 — geomap aligned with engine country routing", () => {
    it("Ireland classifies as Europe (no longer 'Other')", async () => {
      const { classifyCountry } = await import("../src/lib/geomap");
      expect(classifyCountry("Ireland", "USD")).toBe("Europe");
    });

    it("APAC-developed countries (Australia/HK/SG/NZ) classify as the Japan region", async () => {
      const { classifyCountry } = await import("../src/lib/geomap");
      for (const c of ["Australia", "Hong Kong", "Singapore", "New Zealand"]) {
        expect(classifyCountry(c, "USD")).toBe("Japan");
      }
    });

    it("Poland/Greece/Hungary/Czechia/Czech Republic classify as EM (regression for Europe→EM correction)", async () => {
      const { classifyCountry } = await import("../src/lib/geomap");
      for (const c of [
        "Poland", "Greece", "Hungary", "Czechia", "Czech Republic",
      ]) {
        expect(classifyCountry(c, "USD")).toBe("EM");
      }
    });

    it("EM additions (Brazil/Indonesia/Turkey/UAE/etc.) that previously fell to 'Other' classify as EM", async () => {
      const { classifyCountry } = await import("../src/lib/geomap");
      for (const c of [
        "Brazil", "Mexico", "Saudi Arabia", "South Africa", "Indonesia",
        "Thailand", "Malaysia", "United Arab Emirates", "Qatar", "Kuwait",
        "Egypt", "Turkey", "Chile", "Colombia", "Peru", "Philippines",
        "Vietnam",
      ]) {
        expect(classifyCountry(c, "USD")).toBe("EM");
      }
    });

    it("IE00B3YLTY66-shaped geo profile produces otherPct ≈ 11.7% (only justETF's 'Other' row remains)", async () => {
      const { buildRegionWeights } = await import("../src/lib/geomap");
      // Mirrors the Vanguard FTSE All-World profile in
      // src/data/lookthrough.overrides.json (IE00B3YLTY66).
      const profile: Array<[string, number]> = [
        ["United States", 58.57],
        ["Japan", 5.68],
        ["United Kingdom", 3.25],
        ["Canada", 2.92],
        ["Taiwan", 2.56],
        ["China", 2.45],
        ["France", 2.05],
        ["Germany", 1.94],
        ["Switzerland", 1.85],
        ["South Korea", 1.77],
        ["Australia", 1.65],
        ["India", 1.35],
        ["Netherlands", 1.24],
        ["Ireland", 1.03],
        ["Other", 11.69],
      ];
      const { weights, otherPct } = buildRegionWeights(profile, "USD");
      // North America = US + Canada.
      expect(weights.NA).toBeCloseTo(61.49, 2);
      // Japan tile aggregates Japan + Australia ≈ 7.33%.
      expect(weights.Japan).toBeCloseTo(7.33, 2);
      // Europe now includes Ireland (1.03) plus the rest of DM Europe.
      expect(weights.Europe).toBeCloseTo(11.36, 2);
      // EM = Taiwan + China + South Korea + India.
      expect(weights.EM).toBeCloseTo(8.13, 2);
      // The only residual left is justETF's own catch-all "Other" row.
      expect(otherPct).toBeCloseTo(11.69, 2);
    });

    it("drift-guard: every key of the engine's COUNTRY_TO_EQUITY_KEY resolves to a non-'Other' region on the map", async () => {
      const { classifyCountry, buildRegionWeights } = await import("../src/lib/geomap");
      const { COUNTRY_TO_EQUITY_KEY } = await import("../src/lib/metrics");
      // Source-of-truth assertion: iterate the engine's actual table
      // (now exported from metrics.ts) so any future addition to
      // COUNTRY_TO_EQUITY_KEY that the geomap doesn't classify will
      // fail this test. We exclude the engine's aggregate-row pseudo
      // entries ("Europe", "Europe ex-UK", "Other Europe", "Other EU",
      // "Other EM", "EM") — those are upstream profile labels routed
      // by the engine for back-compat; the geomap handles them via
      // REGION_BUCKETS, not classifyCountry.
      const AGGREGATE_PSEUDO_KEYS = new Set([
        "Europe", "Europe ex-UK", "Other Europe", "Other EU", "Other EM", "EM",
      ]);
      const aliasToTopo: Record<string, string> = {
        "United States": "United States of America",
        USA: "United States of America",
        UAE: "United Arab Emirates",
        UK: "United Kingdom",
      };
      const drift: Array<{ engineKey: string; probed: string }> = [];
      for (const engineKey of Object.keys(COUNTRY_TO_EQUITY_KEY)) {
        if (AGGREGATE_PSEUDO_KEYS.has(engineKey)) continue;
        const probed = aliasToTopo[engineKey] ?? engineKey;
        const region = classifyCountry(probed, "USD");
        if (region === "Other") drift.push({ engineKey, probed });
      }
      expect(drift).toEqual([]);

      // Companion: every aggregate pseudo-key must also classify via
      // the REGION_BUCKETS path (i.e. a single-row geoEquity input
      // with that label must produce zero otherPct).
      for (const aggKey of AGGREGATE_PSEUDO_KEYS) {
        const { otherPct } = buildRegionWeights([[aggKey, 100]], "USD");
        expect(otherPct, `aggregate key ${aggKey} fell to Other on the map`).toBe(0);
      }
    });

    it("regionLabel widens the Japan tile to 'Japan + Asia-Pacific' only when an APAC-developed country is actually in the look-through; pure Japan keeps the plain label", async () => {
      const { regionLabel } = await import("../src/lib/geomap");
      // Backward-compatible default (no presentCountries arg) keeps
      // the wider label so legacy callers don't regress.
      expect(regionLabel("Japan", "en")).toBe("Japan + Asia-Pacific");
      expect(regionLabel("Japan", "de")).toBe("Japan + Asien-Pazifik");
      // Pure Japan-only look-through → plain "Japan".
      expect(regionLabel("Japan", "en", [{ country: "Japan" }])).toBe("Japan");
      expect(regionLabel("Japan", "de", [{ country: "Japan" }])).toBe("Japan");
      // Any APAC-developed country present → widened label.
      expect(regionLabel("Japan", "en", [{ country: "Japan" }, { country: "Australia" }]))
        .toBe("Japan + Asia-Pacific");
      expect(regionLabel("Japan", "de", [{ country: "Hong Kong" }]))
        .toBe("Japan + Asien-Pazifik");
      // Empty country list → plain "Japan" (the tile shows zero, no
      // implied APAC coverage).
      expect(regionLabel("Japan", "en", [])).toBe("Japan");
    });

    it("buildRegionWeights surfaces per-region present countries so tile tooltips can show only what's really in the look-through", async () => {
      const { buildRegionWeights } = await import("../src/lib/geomap");
      // A 100% Japan-only geo profile must NOT list Australia / HK /
      // Singapore / NZ in the Japan region's present-countries list —
      // those are catalogue possibilities, not look-through reality.
      const japanOnly = buildRegionWeights([["Japan", 100]], "USD");
      expect(japanOnly.regionCountries.Japan.map((c) => c.country)).toEqual(["Japan"]);
      // Mixed Japan + Australia → both present, sorted by pct desc.
      const mixed = buildRegionWeights(
        [["Japan", 60], ["Australia", 10]],
        "USD",
      );
      expect(mixed.regionCountries.Japan.map((c) => c.country)).toEqual([
        "Japan", "Australia",
      ]);
      expect(mixed.regionCountries.Japan[0].pct).toBeCloseTo(60, 5);
      expect(mixed.regionCountries.Japan[1].pct).toBeCloseTo(10, 5);
      // Aggregate "Europe" row contributes to regionAggregates, NOT
      // regionCountries (it has no country granularity).
      const agg = buildRegionWeights([["Europe", 30]], "USD");
      expect(agg.regionCountries.Europe).toEqual([]);
      expect(agg.regionAggregates.Europe).toBeCloseTo(30, 5);
    });
  });

  it("mapAllocationToAssetsLookthrough preserves total weight, falls back for non-equity, and is backwards-compatible when etfImplementation is missing", () => {
    // Three invariants this test pins:
    //  (1) Total exposure weight is identical between region-based and
    //      look-through routing — look-through redistributes shares
    //      across CMA buckets but never creates or destroys weight.
    //  (2) Non-equity rows (bonds, gold, cash) route identically in
    //      both modes — look-through only affects equity geography.
    //  (3) computeMetrics(..., baseCcy) and computeMetrics(..., baseCcy, [])
    //      produce identical numbers — passing an empty/missing
    //      etfImplementation must preserve legacy behavior.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Switzerland", weight: 10 },
      { assetClass: "Equity", region: "UK", weight: 5 },
      { assetClass: "Fixed Income", region: "Global", weight: 25 },
    ];
    const etfImpl: ETFImplementation[] = [
      { bucket: "Equity - USA", assetClass: "Equity", weight: 60, intent: "", exampleETF: "iShares Core S&P 500", rationale: "", isin: "IE00B5BMR087", ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Equity - Switzerland", assetClass: "Equity", weight: 10, intent: "", exampleETF: "iShares SLI", rationale: "", isin: "DE0005933964", ticker: "", exchange: "", terBps: 51, domicile: "DE", replication: "Physical", distribution: "Distributing", currency: "EUR", comment: "" },
      { bucket: "Equity - UK", assetClass: "Equity", weight: 5, intent: "", exampleETF: "iShares Core FTSE 100", rationale: "", isin: "IE00B53HP851", ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Distributing", currency: "GBP", comment: "" },
      { bucket: "Fixed Income - Global", assetClass: "Fixed Income", weight: 25, intent: "", exampleETF: "iShares Core Global Aggregate Bond", rationale: "", isin: "IE00BDBRDM35", ticker: "", exchange: "", terBps: 10, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
    ];

    const region = mapAllocationToAssets(allocation);
    const lookthrough = mapAllocationToAssetsLookthrough(allocation, etfImpl);

    // (1) Total weight conservation across both routers.
    const sumRegion = region.reduce((s, e) => s + e.weight, 0);
    const sumLookthrough = lookthrough.reduce((s, e) => s + e.weight, 0);
    expect(sumRegion).toBeCloseTo(1.0, 6);
    expect(sumLookthrough).toBeCloseTo(1.0, 6);

    // (2) Non-equity buckets (bonds) route identically — Global bonds
    //     get routed by the existing fallback regardless of whether
    //     look-through is on.
    const bondsRegion = region.find((e) => e.key === "bonds")?.weight ?? 0;
    const bondsLook = lookthrough.find((e) => e.key === "bonds")?.weight ?? 0;
    expect(bondsLook).toBeCloseTo(bondsRegion, 6);
    expect(bondsLook).toBeCloseTo(0.25, 6);

    // (3) Backwards compatibility: missing/empty etfImplementation arg
    //     must not change a single number coming out of computeMetrics.
    const m1 = computeMetrics(allocation, "USD");
    const m2 = computeMetrics(allocation, "USD", []);
    expect(m2.vol).toBeCloseTo(m1.vol, 6);
    expect(m2.trackingError).toBeCloseTo(m1.trackingError, 6);
    expect(m2.beta).toBeCloseTo(m1.beta, 6);
    expect(m2.alpha).toBeCloseTo(m1.alpha, 6);
  });

  it("mapAllocationToAssetsLookthrough blends multiple ETFs sharing the same bucket", () => {
    // Regression for Task #221: when two ETFs are assigned to the same
    // bucket key (e.g. an MSCI World fund + an S&P 500 fund both in
    // Equity-Global, or an MSCI Europe + an MSCI EMU both in
    // Equity-Europe), the look-through router used to overwrite the
    // earlier ETF with the later one and route the entire combined
    // weight through only the last profile. The fix routes each ETF's
    // weighted slice independently and sums the results.
    const ISIN_EUROPE = "IE00B4K48X80"; // MSCI Europe — has UK + CH content
    const ISIN_USA = "IE00B5BMR087";    // S&P 500 — pure US, zero UK / CH
    const pEurope = profileFor(ISIN_EUROPE)!;
    const pUsa = profileFor(ISIN_USA)!;
    expect(pEurope?.isEquity).toBe(true);
    expect(pUsa?.isEquity).toBe(true);

    // Sanity: the two ETFs MUST disagree on UK content for the blend to
    // be observably different from either ETF alone. MSCI Europe has
    // material UK; an S&P 500 fund has none.
    const totalEurope = Object.values(pEurope.geo).reduce((s, v) => s + v, 0);
    const totalUsa = Object.values(pUsa.geo).reduce((s, v) => s + v, 0);
    const ukPctEurope = (pEurope.geo["United Kingdom"] ?? 0) / totalEurope;
    const ukPctUsa = (pUsa.geo["United Kingdom"] ?? 0) / totalUsa;
    expect(ukPctEurope).toBeGreaterThan(0.05);
    expect(ukPctUsa).toBeLessThan(0.001);

    // The two ETFs share a single bucket key — the realistic scenario is
    // an operator-edited Explain portfolio where a "World blend" Global
    // bucket holds both a regional Europe fund and an S&P 500 fund.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Global", weight: 20 },
    ];
    const mkEntry = (isin: string, weight: number): ETFImplementation => ({
      bucket: "Equity - Global",
      assetClass: "Equity",
      weight,
      intent: "",
      exampleETF: "",
      rationale: "",
      isin,
      ticker: "",
      exchange: "",
      terBps: 12,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "EUR",
      comment: "",
    });

    const both = mapAllocationToAssetsLookthrough(
      allocation,
      [mkEntry(ISIN_EUROPE, 12), mkEntry(ISIN_USA, 8)],
    );
    const europeOnly = mapAllocationToAssetsLookthrough(
      allocation,
      [mkEntry(ISIN_EUROPE, 20)],
    );
    const usaOnly = mapAllocationToAssetsLookthrough(
      allocation,
      [mkEntry(ISIN_USA, 20)],
    );

    // Total weight conserved regardless of how many ETFs share the bucket.
    const sum = (xs: { weight: number }[]) => xs.reduce((s, x) => s + x.weight, 0);
    expect(sum(both)).toBeCloseTo(0.20, 6);
    expect(sum(europeOnly)).toBeCloseTo(0.20, 6);
    expect(sum(usaOnly)).toBeCloseTo(0.20, 6);

    const ukBoth = both.find((e) => e.key === "equity_uk")?.weight ?? 0;
    const ukEurope = europeOnly.find((e) => e.key === "equity_uk")?.weight ?? 0;
    const ukUsa = usaOnly.find((e) => e.key === "equity_uk")?.weight ?? 0;

    // The blend must lie strictly between the two single-ETF endpoints —
    // proves both ETFs contributed instead of one overwriting the other.
    expect(ukUsa).toBeLessThan(0.0005);
    expect(ukBoth).toBeGreaterThan(ukUsa + 1e-6);
    expect(ukBoth).toBeLessThan(ukEurope - 1e-6);

    // And it must equal the closed-form 60/40 weighted blend exactly.
    const expectedUk = 0.6 * ukEurope + 0.4 * ukUsa;
    expect(ukBoth).toBeCloseTo(expectedUk, 8);

    // Cross-check the US side too: the blend must equal the closed-form
    // 60/40 weighted average of the two single-ETF results — anything
    // else means the second ETF was being silently dropped or
    // overwriting the first. (Use the live profile values rather than
    // assuming MSCI Europe contributes zero US, since the profile
    // overrides file may contain trace residual US weight.)
    const usBoth = both.find((e) => e.key === "equity_us")?.weight ?? 0;
    const usEurope = europeOnly.find((e) => e.key === "equity_us")?.weight ?? 0;
    const usUsa = usaOnly.find((e) => e.key === "equity_us")?.weight ?? 0;
    expect(usBoth).toBeCloseTo(0.6 * usEurope + 0.4 * usUsa, 8);
  });

  it("decomposeTrackingError with look-through shrinks UK underweight when held via Europe ETF", () => {
    // Operator's portfolio: 8.7% Equity-Europe + no explicit UK or CH.
    // Without look-through the TE-contribution table reports UK as a
    // -4pp pure-benchmark underweight. With look-through the implicit UK
    // content from the Europe ETF (~2pp) shrinks the active UK bet to
    // ~-2pp and the CH active bet from -4pp to ~-2.7pp.
    const allocation: AssetAllocation[] = [
      { assetClass: "Cash", region: "CHF", weight: 3.0 },
      { assetClass: "Equity", region: "USA", weight: 51.3 },
      { assetClass: "Equity", region: "EM", weight: 11.6 },
      { assetClass: "Equity", region: "Europe", weight: 8.7 },
      { assetClass: "Equity", region: "Japan", weight: 4.0 },
      { assetClass: "Commodities", region: "Gold", weight: 7.5 },
      { assetClass: "Equity", region: "Switzerland", weight: 13.9 },
    ];
    const etfImpl: ETFImplementation[] = [
      { bucket: "Equity - USA", assetClass: "Equity", weight: 51.3, intent: "", exampleETF: "iShares Core S&P 500", rationale: "", isin: "IE00B5BMR087", ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Equity - EM", assetClass: "Equity", weight: 11.6, intent: "", exampleETF: "iShares Core MSCI EM IMI", rationale: "", isin: "IE00BKM4GZ66", ticker: "", exchange: "", terBps: 18, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Equity - Europe", assetClass: "Equity", weight: 8.7, intent: "", exampleETF: "iShares Core MSCI Europe", rationale: "", isin: "IE00B4K48X80", ticker: "", exchange: "", terBps: 12, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "EUR", comment: "" },
      { bucket: "Equity - Japan", assetClass: "Equity", weight: 4.0, intent: "", exampleETF: "iShares Core MSCI Japan IMI", rationale: "", isin: "IE00B4L5YX21", ticker: "", exchange: "", terBps: 12, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Commodities - Gold", assetClass: "Commodities", weight: 7.5, intent: "", exampleETF: "Invesco Physical Gold A", rationale: "", isin: "IE00B579F325", ticker: "", exchange: "", terBps: 12, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Equity - Switzerland", assetClass: "Equity", weight: 13.9, intent: "", exampleETF: "iShares SLI", rationale: "", isin: "DE0005933964", ticker: "", exchange: "", terBps: 51, domicile: "DE", replication: "Physical", distribution: "Distributing", currency: "EUR", comment: "" },
    ];

    const dBefore = decomposeTrackingError(allocation, "CHF");
    const dAfter = decomposeTrackingError(allocation, "CHF", etfImpl);

    // Closure: contributions still sum to total TE in both modes.
    const sumBefore = dBefore.rows.reduce((s, r) => s + r.contribution, 0);
    const sumAfter = dAfter.rows.reduce((s, r) => s + r.contribution, 0);
    expect(sumBefore).toBeCloseTo(dBefore.total, 6);
    expect(sumAfter).toBeCloseTo(dAfter.total, 6);

    // Region-only: UK is fully underweight at -4pp because the
    // 8.7% Europe row is treated as pure equity_eu.
    const ukBefore = dBefore.rows.find((r) => r.key === "equity_uk")!;
    expect(ukBefore.portfolioWeight).toBe(0);
    expect(ukBefore.activeWeight).toBeCloseTo(-0.04, 6);

    // Look-through: the 8.7% Europe ETF contributes 8.7% × ukPct UK
    // exposure (live values from profileFor), so the UK active bet
    // shrinks meaningfully toward zero instead of staying at -4pp.
    const europeProfile = profileFor("IE00B4K48X80")!;
    const europeTotalGeo = Object.values(europeProfile.geo).reduce((s, v) => s + v, 0);
    const ukPctInEurope = (europeProfile.geo["United Kingdom"] ?? 0) / europeTotalGeo;
    const chPctInEurope = (europeProfile.geo["Switzerland"] ?? 0) / europeTotalGeo;
    const ukAfter = dAfter.rows.find((r) => r.key === "equity_uk")!;
    expect(ukAfter.portfolioWeight).toBeCloseTo(0.087 * ukPctInEurope, 6);
    expect(ukAfter.activeWeight).toBeGreaterThan(ukBefore.activeWeight);
    expect(Math.abs(ukAfter.activeWeight)).toBeLessThan(Math.abs(ukBefore.activeWeight));

    // Same effect on Switzerland: explicit 13.9% plus implicit
    // 8.7% × chPct from the Europe ETF brings total CH portfolio weight up.
    const chBefore = dBefore.rows.find((r) => r.key === "equity_ch")!;
    const chAfter = dAfter.rows.find((r) => r.key === "equity_ch")!;
    expect(chAfter.portfolioWeight).toBeGreaterThan(chBefore.portfolioWeight);
    expect(chAfter.portfolioWeight).toBeCloseTo(0.139 + 0.087 * chPctInEurope, 6);

    // Continental EU exposure is correspondingly smaller: only the
    // continental-EU labels in the Europe ETF profile contribute to
    // equity_eu. Task #241 carves out the generic "Other" catch-all
    // into equity_other; Task #294 (2026-05) restored Ireland →
    // equity_eu so it now contributes here too. We enumerate the
    // continental-EU labels explicitly to stay robust against profile
    // refreshes that may add/remove minor markets (e.g. Poland → EM).
    const EU_LABELS = [
      "France", "Germany", "Netherlands", "Sweden", "Italy", "Spain",
      "Denmark", "Norway", "Belgium", "Austria", "Finland", "Portugal",
      "Ireland", "Other Europe", "Other EU", "Europe", "Europe ex-UK",
    ];
    const euPctInEurope =
      EU_LABELS.reduce((s, c) => s + (europeProfile.geo[c] ?? 0), 0) /
      europeTotalGeo;
    const euBefore = dBefore.rows.find((r) => r.key === "equity_eu")!;
    const euAfter = dAfter.rows.find((r) => r.key === "equity_eu")!;
    expect(euAfter.portfolioWeight).toBeLessThan(euBefore.portfolioWeight);
    // Lower bound: equity_eu must include at least the Europe ETF's EU
    // country slices (0.087 × euPctInEurope). It may legitimately exceed
    // this because other ETFs in the test (S&P 500, SLI, EM IMI) can
    // contribute small Ireland / "Other Europe" slices that — post-Task
    // #294 — now also map to equity_eu.
    expect(euAfter.portfolioWeight).toBeGreaterThanOrEqual(
      0.087 * euPctInEurope - 1e-6,
    );
    // Upper bound: still well below the region-only baseline (the whole
    // 8.7% Europe row).
    expect(euAfter.portfolioWeight).toBeLessThan(0.087);
  });

  it("computeMetrics returns sane numbers for a default portfolio", () => {
    const input = baseInput();
    const out = buildPortfolio(input);
    const m = computeMetrics(out.allocation, input.baseCurrency);
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
      { assetClass: "Equity", region: "Europe", weight: 14 },
      { assetClass: "Equity", region: "UK", weight: 4 },
      { assetClass: "Equity", region: "Switzerland", weight: 4 },
      { assetClass: "Equity", region: "Japan", weight: 4 },
      { assetClass: "Equity", region: "EM", weight: 14 },
    ];
    const m = computeMetrics(benchAlloc, "USD");
    expect(m.beta).toBeCloseTo(1, 2);
    expect(m.trackingError).toBeLessThan(0.001);
    // expReturn is reported NET of withholding-tax drag (see metrics.ts:WHT_DRAG).
    // Apply the same drag to the benchmark side so the assertion is symmetric.
    const expectedNet = portfolioReturn(BENCHMARK) - portfolioWhtDrag(BENCHMARK, "USD");
    expect(m.expReturn).toBeCloseTo(expectedNet, 4);
    expect(m.vol).toBeCloseTo(portfolioVol(BENCHMARK), 4);
  });

  it("frontier returns 21 points (0..100 step 5), each with computed return/vol", () => {
    const out = buildPortfolio(baseInput());
    const f = computeFrontier(out.allocation, baseInput().baseCurrency);
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

  it("correlation matrix always shows all 12 asset classes regardless of holdings", () => {
    // 100% equity portfolio (no bonds, cash, gold, reits, crypto held)
    const out = buildPortfolio(baseInput({
      riskAppetite: "Very High",
      targetEquityPct: 100,
      includeCommodities: false,
      includeListedRealEstate: false,
      includeCrypto: false,
    }));
    const { keys, labels, matrix, held } = buildCorrelationMatrix(out.allocation);
    // Always 13 rows/cols: 12 named buckets + equity_other (Task #241).
    expect(keys).toEqual([
      "equity_us", "equity_eu", "equity_uk", "equity_ch", "equity_jp", "equity_em", "equity_thematic", "equity_other",
      "bonds", "cash", "gold", "reits", "crypto",
    ]);
    expect(labels.length).toBe(13);
    expect(matrix.length).toBe(13);
    expect(matrix.every((r) => r.length === 13)).toBe(true);
    expect(held.length).toBe(13);
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

  it("rows are sorted by canonical asset-class order (Cash → Fixed Income → Equity → Satellites), heaviest first within a group", () => {
    const a = buildPortfolio(baseInput({ riskAppetite: "Low", targetEquityPct: 30 }));
    const b = buildPortfolio(baseInput({ riskAppetite: "Very High", targetEquityPct: 95 }));
    const d = diffPortfolios(a, b);
    for (let i = 1; i < d.rows.length; i++) {
      const prev = d.rows[i - 1];
      const cur = d.rows[i];
      const prevRank = bucketOrderKey(prev.key);
      const curRank = bucketOrderKey(cur.key);
      expect(prevRank).toBeLessThanOrEqual(curRank);
      if (prevRank === curRank) {
        const prevAvg = (prev.a + prev.b) / 2;
        const curAvg = (cur.a + cur.b) / 2;
        expect(prevAvg).toBeGreaterThanOrEqual(curAvg);
      }
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

  it("currencyOverview honours the look-through option (ETF-currency-only fallback)", () => {
    // CHF base, no hedging — unhedged ETFs are mostly USD/EUR share classes.
    // In look-through mode the World ETF should split its weight across many
    // currencies (USD, EUR, JPY, GBP, CHF, ...). With look-through OFF the
    // entire unhedged weight collapses to the share-class currency only, so
    // the number of distinct currencies reported should be smaller and the
    // dominant share-class currency should pick up materially more weight.
    const out = buildPortfolio(
      baseInput({
        baseCurrency: "CHF",
        includeCurrencyHedging: false,
        targetEquityPct: 80,
        riskAppetite: "High",
        numETFs: 8,
      })
    );

    const ltOn = buildLookthrough(out.etfImplementation, "en", "CHF", {
      useLookThroughCurrency: true,
    });
    const ltOff = buildLookthrough(out.etfImplementation, "en", "CHF", {
      useLookThroughCurrency: false,
    });

    // Both views should report the same hedged share (hedged weight does
    // not depend on the look-through toggle).
    expect(ltOff.currencyOverview.hedgedShareOfPortfolio).toBeCloseTo(
      ltOn.currencyOverview.hedgedShareOfPortfolio,
      6
    );

    // The total reported weight (rows + unmapped) is conserved across
    // modes: switching the toggle only re-distributes the unhedged sleeve
    // between currencies, it never adds or destroys weight overall.
    const sumPct = (rows: typeof ltOn.currencyOverview.rows) =>
      rows.reduce((s, r) => s + r.pctOfPortfolio, 0);
    const totalOn = sumPct(ltOn.currencyOverview.rows) + ltOn.currencyOverview.unmappedWeight;
    const totalOff = sumPct(ltOff.currencyOverview.rows) + ltOff.currencyOverview.unmappedWeight;
    expect(totalOff).toBeCloseTo(totalOn, 6);

    // ETF-currency-only view should never have unmapped weight, because
    // every ETF has a known share-class currency (or falls back to base).
    expect(ltOff.currencyOverview.unmappedWeight).toBe(0);

    // Look-through ON typically yields more distinct currencies than the
    // share-class-only view (World ETF expands into USD/EUR/JPY/GBP/...).
    expect(ltOn.currencyOverview.rows.length).toBeGreaterThanOrEqual(
      ltOff.currencyOverview.rows.length
    );

    // The two views must disagree somewhere — otherwise the toggle has
    // no visible effect on the consolidated overview.
    const sameRows =
      ltOn.currencyOverview.rows.length === ltOff.currencyOverview.rows.length &&
      ltOn.currencyOverview.rows.every((row, i) => {
        const other = ltOff.currencyOverview.rows[i];
        return (
          other &&
          other.currency === row.currency &&
          Math.abs(other.pctOfPortfolio - row.pctOfPortfolio) < 0.01
        );
      });
    expect(sameRows).toBe(false);
  });

  it("currencyOverview hedged share is invariant across the look-through toggle, even for hedged ETFs without a curated profile", () => {
    // Synthesise a tiny portfolio that the curated profile map does not
    // know about: a hedged share class whose ISIN is deliberately fake.
    // Whichever way we flip the look-through toggle, the hedged-share
    // metric must be identical and the hedged weight must always be
    // routed to the share-class currency — never to "unmapped".
    // Build a minimal hand-crafted ETF list whose ISINs are not in the
    // curated profile map. The hedged ETF is detected via the "Hedged"
    // keyword in `exampleETF` (see isHedged() in lookthrough.ts).
    const mk = (
      overrides: Partial<import("../src/lib/types").ETFImplementation>
    ): import("../src/lib/types").ETFImplementation => ({
      bucket: "Equities — Diversified",
      assetClass: "Equity",
      weight: 0,
      intent: "Test fixture",
      exampleETF: "Fake ETF",
      rationale: "",
      isin: "XX0000000FAKE0",
      ticker: "FAKE",
      exchange: "—",
      terBps: 20,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "",
      catalogKey: null,
      selectedSlot: 0,
      selectableOptions: [],
      ...overrides,
    });
    const etfs: import("../src/lib/types").ETFImplementation[] = [
      mk({
        weight: 60,
        ticker: "FAKEH",
        isin: "XX0000000HEDGED1",
        exampleETF: "Fake World CHF Hedged",
        currency: "CHF",
        domicile: "LU",
      }),
      mk({
        bucket: "Bonds — Aggregate",
        assetClass: "Fixed Income",
        weight: 40,
        ticker: "FAKEU",
        isin: "XX0000000UNHED1",
        exampleETF: "Fake Bonds USD",
        currency: "USD",
      }),
    ];

    const ltOn = buildLookthrough(etfs, "en", "CHF", { useLookThroughCurrency: true });
    const ltOff = buildLookthrough(etfs, "en", "CHF", { useLookThroughCurrency: false });

    // Hedged share must be identical across modes — the toggle only
    // affects the unhedged-currency split, never the hedged sleeve.
    expect(ltOff.currencyOverview.hedgedShareOfPortfolio).toBe(
      ltOn.currencyOverview.hedgedShareOfPortfolio
    );
    expect(ltOn.currencyOverview.hedgedShareOfPortfolio).toBe(60);

    // The hedged ETF must contribute to the CHF row (its share-class
    // currency) in BOTH modes, even though no profile exists for it.
    const chfOn = ltOn.currencyOverview.rows.find((r) => r.currency === "CHF");
    const chfOff = ltOff.currencyOverview.rows.find((r) => r.currency === "CHF");
    expect(chfOn?.hedgedPct).toBe(60);
    expect(chfOff?.hedgedPct).toBe(60);

    // The unhedged USD bond ETF (no profile) goes to "unmapped" in
    // look-through mode but to USD in ETF-currency-only mode.
    expect(ltOn.currencyOverview.unmappedWeight).toBe(40);
    expect(ltOff.currencyOverview.unmappedWeight).toBe(0);
    const usdOff = ltOff.currencyOverview.rows.find((r) => r.currency === "USD");
    expect(usdOff?.unhedgedPct).toBe(40);
  });

  it("isHedged() does NOT match ETFs whose name ends in 'Unhedged'", () => {
    // Regression: the old /Hedged/i fallback also matched "Unhedged"
    // share classes (e.g. "SPDR MSCI World UCITS ETF USD Unhedged"),
    // mis-routing their weight into the hedged sleeve.
    const mk = (
      overrides: Partial<import("../src/lib/types").ETFImplementation>
    ): import("../src/lib/types").ETFImplementation => ({
      bucket: "Equities — Diversified",
      assetClass: "Equity",
      weight: 0,
      intent: "Test fixture",
      exampleETF: "Fake ETF",
      rationale: "",
      isin: "XX0000000FAKE0",
      ticker: "FAKE",
      exchange: "—",
      terBps: 20,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "",
      catalogKey: null,
      selectedSlot: 0,
      selectableOptions: [],
      ...overrides,
    });
    const etfs: import("../src/lib/types").ETFImplementation[] = [
      mk({
        weight: 100,
        ticker: "FAKEUH",
        isin: "XX0000000UNHED2",
        exampleETF: "State Street SPDR MSCI World UCITS ETF USD Unhedged",
        currency: "USD",
      }),
    ];
    const lt = buildLookthrough(etfs, "en", "CHF", { useLookThroughCurrency: false });
    // The position must NOT count as hedged.
    expect(lt.currencyOverview.hedgedShareOfPortfolio).toBe(0);
    const usd = lt.currencyOverview.rows.find((r) => r.currency === "USD");
    expect(usd?.hedgedPct ?? 0).toBe(0);
    expect(usd?.unhedgedPct).toBe(100);
  });

  it("currencyOverview ETF-currency-only mode keeps unhedged ETF weight in its share-class currency", () => {
    // EUR base with hedging on — the hedged sleeve still goes to EUR, but
    // any unhedged share class in (say) USD must show up entirely as USD
    // when look-through is OFF, never split across underlying currencies.
    const out = buildPortfolio(
      baseInput({
        baseCurrency: "EUR",
        includeCurrencyHedging: true,
        preferredExchange: "XETRA",
        targetEquityPct: 70,
      })
    );

    const ltOff = buildLookthrough(out.etfImplementation, "en", "EUR", {
      useLookThroughCurrency: false,
    });

    // Defaults stay backward-compatible: omitting the option behaves like ON.
    const ltDefault = buildLookthrough(out.etfImplementation, "en", "EUR");
    const ltOn = buildLookthrough(out.etfImplementation, "en", "EUR", {
      useLookThroughCurrency: true,
    });
    expect(ltDefault.currencyOverview.rows.length).toBe(ltOn.currencyOverview.rows.length);

    // Every reported currency in the ETF-only view must match the share-class
    // currency of at least one selected ETF (i.e. nothing got split into a
    // currency that no ETF actually trades in). The two synthetic buckets
    // ("EM Currencies", "XAU (Gold)") are also valid — they intentionally
    // re-route Equity-EM and Commodities-Gold weight off the share-class
    // currency to keep the table honest. See lookthrough.ts.
    const shareClassCurrencies = new Set(
      out.etfImplementation.map((e) => e.currency).filter(Boolean) as string[]
    );
    shareClassCurrencies.add("EUR"); // base currency is a valid fallback
    shareClassCurrencies.add(EM_CURRENCIES_KEY);
    shareClassCurrencies.add(XAU_GOLD_KEY);
    for (const row of ltOff.currencyOverview.rows) {
      expect(shareClassCurrencies.has(row.currency)).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // Synthetic currency buckets: EM Currencies + XAU (Gold)
  // (Task #108)
  // ---------------------------------------------------------------------
  describe("currencyOverview synthetic buckets (EM Currencies, XAU Gold)", () => {
    // Hand-crafted ETFImplementation factory so each scenario stays
    // isolated from buildPortfolio's allocation choices. We pass the
    // exact ETFs we want to test the bucket-routing logic on.
    const mk = (
      overrides: Partial<import("../src/lib/types").ETFImplementation>
    ): import("../src/lib/types").ETFImplementation => ({
      bucket: "Equity - World",
      assetClass: "Equity",
      weight: 0,
      intent: "",
      exampleETF: "Fixture ETF",
      rationale: "",
      isin: "XX0000000FAKE0",
      ticker: "FAKE",
      exchange: "—",
      terBps: 20,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "",
      catalogKey: null,
      selectedSlot: 0,
      selectableOptions: [],
      ...overrides,
    });

    it("re-routes physical-gold ETC weight to XAU (Gold) in BOTH look-through modes", () => {
      const etfs = [
        mk({
          bucket: "Commodities - Gold",
          assetClass: "Commodities",
          isin: "IE00B579F325", // real curated profile (currency: USD 100)
          exampleETF: "Invesco Physical Gold ETC",
          weight: 5,
        }),
        mk({
          // Plain global equity ETF so the rest of the portfolio still
          // has weight on the USD line — proves Gold was *removed* from
          // USD without removing anything else.
          bucket: "Equity - World",
          isin: "IE00B3YLTY66", // SPDR MSCI ACWI IMI — real curated profile (USD ~62%)
          exampleETF: "SPDR MSCI ACWI IMI",
          weight: 95,
        }),
      ];

      for (const useLT of [true, false]) {
        const r = buildLookthrough(etfs, "en", "USD", {
          useLookThroughCurrency: useLT,
        }).currencyOverview;
        const xau = r.rows.find((x) => x.currency === XAU_GOLD_KEY);
        expect(xau, `XAU row missing (useLT=${useLT})`).toBeDefined();
        expect(xau!.unhedgedPct).toBeCloseTo(5, 6);
        expect(xau!.hedgedPct).toBe(0);
        expect(xau!.pctOfPortfolio).toBeCloseTo(5, 6);

        // USD must NOT include the gold weight in either mode. In LT-on
        // the World ETF still contributes ~62% USD; in LT-off the World
        // ETF contributes its 95% share-class USD weight. Either way,
        // gold's 5% must NOT be added on top.
        const usd = r.rows.find((x) => x.currency === "USD");
        if (useLT) {
          // Curated MSCI World is ~62% USD — assert gold (+5%) didn't
          // pile on by checking USD < 95 (would be 95+ if gold was here).
          expect(usd!.unhedgedPct).toBeLessThan(80);
        } else {
          // No look-through → World contributes its full 95% to USD.
          // Gold is the only thing left, and it must NOT be on USD.
          expect(usd!.unhedgedPct).toBeCloseTo(95, 6);
        }
      }
    });

    it("re-routes EM equity to EM Currencies ONLY in no-look-through mode", () => {
      const etfs = [
        mk({
          bucket: "Equity - EM",
          isin: "IE00BKM4GZ66", // MSCI EM IMI — real curated profile
          exampleETF: "iShares Core MSCI EM IMI",
          weight: 8,
        }),
        mk({
          bucket: "Equity - World",
          isin: "IE00B3YLTY66",
          exampleETF: "iShares Core MSCI World",
          weight: 92,
        }),
      ];

      // Look-through OFF → EM lands in synthetic "EM Currencies" bucket.
      const off = buildLookthrough(etfs, "en", "USD", {
        useLookThroughCurrency: false,
      }).currencyOverview;
      const emOff = off.rows.find((x) => x.currency === EM_CURRENCIES_KEY);
      expect(emOff).toBeDefined();
      expect(emOff!.unhedgedPct).toBeCloseTo(8, 6);
      // USD must NOT include the EM weight (which would otherwise sneak
      // in via the EM ETF's USD share class). USD picks up only the
      // World ETF's full 92%, not 92+8=100.
      const usdOff = off.rows.find((x) => x.currency === "USD");
      expect(usdOff!.unhedgedPct).toBeCloseTo(92, 6);

      // Look-through ON → EM stays on the curated per-country split.
      // No "EM Currencies" row should appear; instead CNY / INR / TWD /
      // KRW / etc must show up with weight proportional to MSCI EM IMI's
      // curated currency profile.
      const on = buildLookthrough(etfs, "en", "USD", {
        useLookThroughCurrency: true,
      }).currencyOverview;
      expect(on.rows.find((x) => x.currency === EM_CURRENCIES_KEY)).toBeUndefined();
      expect(on.rows.find((x) => x.currency === "CNY")).toBeDefined();
      expect(on.rows.find((x) => x.currency === "INR")).toBeDefined();
    });

    it("hedged Gold and hedged EM still land on the share-class currency (synthetic bucket bypassed for hedged sleeve)", () => {
      // Construct a hedged Gold ETF and a hedged EM ETF — neither is in
      // the real catalog today, but the hedged sleeve must be honoured
      // first regardless of bucket. The synthetic-bucket re-routing is
      // explicitly defined as "for unhedged ETFs only".
      const etfs = [
        mk({
          bucket: "Commodities - Gold",
          assetClass: "Commodities",
          isin: "XX0000000HGOLD1",
          exampleETF: "Hypothetical EUR-Hedged Gold ETC",
          currency: "EUR",
          weight: 5,
        }),
        mk({
          bucket: "Equity - EM",
          isin: "XX0000000HEMEQ1",
          exampleETF: "Hypothetical EUR-Hedged EM Equity ETF",
          currency: "EUR",
          weight: 10,
        }),
        mk({
          bucket: "Equity - World",
          isin: "IE00B3YLTY66",
          exampleETF: "iShares Core MSCI World",
          weight: 85,
        }),
      ];

      for (const useLT of [true, false]) {
        const r = buildLookthrough(etfs, "en", "EUR", {
          useLookThroughCurrency: useLT,
        }).currencyOverview;

        // Synthetic buckets must be empty — both hedged ETFs are
        // routed to the EUR hedged sleeve before the bucket check.
        expect(r.rows.find((x) => x.currency === XAU_GOLD_KEY)).toBeUndefined();
        expect(r.rows.find((x) => x.currency === EM_CURRENCIES_KEY)).toBeUndefined();

        const eur = r.rows.find((x) => x.currency === "EUR");
        expect(eur, `EUR row missing (useLT=${useLT})`).toBeDefined();
        // 5% gold + 10% EM = 15% on the EUR hedged-to line, regardless
        // of look-through mode.
        expect(eur!.hedgedPct).toBeCloseTo(15, 6);
        expect(r.hedgedShareOfPortfolio).toBeCloseTo(15, 6);
      }
    });

    it("merges multiple gold or multiple EM holdings into a single synthetic row (no duplicates)", () => {
      const etfs = [
        // Two distinct gold ETCs
        mk({
          bucket: "Commodities - Gold",
          assetClass: "Commodities",
          isin: "IE00B579F325",
          exampleETF: "Invesco Physical Gold",
          weight: 3,
        }),
        mk({
          bucket: "Commodities - Gold",
          assetClass: "Commodities",
          isin: "IE00B4ND3602",
          exampleETF: "iShares Physical Gold",
          weight: 2,
        }),
        // Two distinct EM ETFs
        mk({
          bucket: "Equity - EM",
          isin: "IE00BKM4GZ66",
          exampleETF: "iShares Core MSCI EM IMI",
          weight: 6,
        }),
        mk({
          bucket: "Equity - EM",
          isin: "IE00BK5BR733",
          exampleETF: "Vanguard FTSE Emerging Markets",
          weight: 4,
        }),
        mk({
          bucket: "Equity - World",
          isin: "IE00B3YLTY66",
          exampleETF: "iShares Core MSCI World",
          weight: 85,
        }),
      ];

      const off = buildLookthrough(etfs, "en", "USD", {
        useLookThroughCurrency: false,
      }).currencyOverview;
      const xauRows = off.rows.filter((x) => x.currency === XAU_GOLD_KEY);
      const emRows = off.rows.filter((x) => x.currency === EM_CURRENCIES_KEY);
      expect(xauRows).toHaveLength(1);
      expect(emRows).toHaveLength(1);
      expect(xauRows[0].unhedgedPct).toBeCloseTo(5, 6); // 3 + 2
      expect(emRows[0].unhedgedPct).toBeCloseTo(10, 6); // 6 + 4
    });

    it("EM ISIN under a non-EM bucket stays on the share-class currency (re-routing is intentionally bucket-driven, not ISIN-driven)", () => {
      // Codifies the documented intent: re-routing fires on the runtime
      // bucket label, not on the ISIN. If a future operator (or an
      // unusual catalog edit) places the EM IMI ISIN under, say, an
      // "Equity - World" bucket, the row must stay on USD (its share
      // class) instead of jumping to "EM Currencies". Same applies to
      // Gold ISINs misplaced under non-Gold buckets. This frees the
      // catalog to evolve without a hidden coupling between the
      // currency overview and the ISIN list.
      const etfs = [
        mk({
          // EM IMI ISIN, but parked under the World bucket (operator
          // mis-assignment scenario or a future taxonomy change).
          bucket: "Equity - World",
          isin: "IE00BKM4GZ66", // MSCI EM IMI
          exampleETF: "MSCI EM IMI (mis-bucketed under World)",
          currency: "USD",
          weight: 8,
        }),
        mk({
          // Gold ISIN, but parked under a Commodities-Other bucket.
          bucket: "Commodities - Diversified",
          assetClass: "Commodities",
          isin: "IE00B579F325", // Invesco Physical Gold
          exampleETF: "Invesco Physical Gold (mis-bucketed)",
          currency: "USD",
          weight: 5,
        }),
      ];

      const off = buildLookthrough(etfs, "en", "USD", {
        useLookThroughCurrency: false,
      }).currencyOverview;
      // Synthetic rows must NOT fire — bucket strings don't match.
      expect(off.rows.find((x) => x.currency === EM_CURRENCIES_KEY)).toBeUndefined();
      expect(off.rows.find((x) => x.currency === XAU_GOLD_KEY)).toBeUndefined();
      // All 13% must land on the share-class currency (USD).
      const usd = off.rows.find((x) => x.currency === "USD");
      expect(usd?.unhedgedPct).toBeCloseTo(13, 6);
    });

    it("rows still sort by total descending and total weight is conserved", () => {
      const etfs = [
        mk({
          bucket: "Commodities - Gold",
          assetClass: "Commodities",
          isin: "IE00B579F325",
          exampleETF: "Invesco Physical Gold",
          weight: 5,
        }),
        mk({
          bucket: "Equity - EM",
          isin: "IE00BKM4GZ66",
          exampleETF: "iShares Core MSCI EM IMI",
          weight: 8,
        }),
        mk({
          bucket: "Equity - World",
          isin: "IE00B3YLTY66",
          exampleETF: "iShares Core MSCI World",
          weight: 87,
        }),
      ];
      const off = buildLookthrough(etfs, "en", "USD", {
        useLookThroughCurrency: false,
      }).currencyOverview;
      // Sort: descending by pctOfPortfolio
      for (let i = 1; i < off.rows.length; i++) {
        expect(off.rows[i - 1].pctOfPortfolio).toBeGreaterThanOrEqual(
          off.rows[i].pctOfPortfolio
        );
      }
      // Conservation: rows + unmapped sum to 100 (this fixture has no
      // unmapped weight because every ISIN has either a profile or a
      // share-class currency).
      const total =
        off.rows.reduce((s, r) => s + r.pctOfPortfolio, 0) + off.unmappedWeight;
      expect(total).toBeCloseTo(100, 6);
    });
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
    for (const cur of ["USD", "EUR"] as const) {
      const p = buildAiPrompt(baseInput({ baseCurrency: cur, preferredExchange: cur === "EUR" ? "XETRA" : "None" }));
      expect(p).not.toContain("Switzerland (CH)");
      expect(p).not.toContain("Europe ex-CH");
      expect(p).not.toContain("United Kingdom (UK)");
      expect(p).not.toContain("Europe ex-UK");
      expect(p).toContain("USA, Europe, Japan, and Emerging Markets");
    }
  });

  it("lists United Kingdom as a separate equity region only for GBP base currency (mirror of CHF carve-out)", () => {
    const gbp = buildAiPrompt(baseInput({ baseCurrency: "GBP", preferredExchange: "LSE" }));
    expect(gbp).toContain("United Kingdom (UK)");
    expect(gbp).toContain("Europe ex-UK");
    expect(gbp).not.toContain("Switzerland (CH)");
    // German variant
    const gbpDe = buildAiPrompt(baseInput({ baseCurrency: "GBP", preferredExchange: "LSE" }), "de");
    expect(gbpDe).toContain("Vereinigtes Koenigreich (UK)");
    expect(gbpDe).toContain("Europa ex-UK");
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
    // Thematic lives inside the equity block now, not the satellite block.
    expect(de).toContain("Thematischer Aktien-Tilt innerhalb des Aktien-Sleeves: Sustainability");
    expect(de).not.toMatch(/Satelliten:[\s\S]*Thematische Aktien/);
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
    // Commodities now lives inside the Core asset classes block, NOT under Satellites.
    const satellitesIdx = all.indexOf("Satellites:");
    const commoditiesIdx = all.indexOf("Commodities / Precious Metals");
    expect(satellitesIdx).toBeGreaterThan(0);
    expect(commoditiesIdx).toBeGreaterThan(0);
    expect(commoditiesIdx).toBeLessThan(satellitesIdx);
    expect(all).toContain("Crypto Assets");
    // Thematic equity is part of the equity sleeve, not a satellite. It must
    // be described inside the equity description (before the Satellites
    // block) and must NOT appear inside the Satellites listing.
    expect(all).toContain("Thematic equity tilt within the equity sleeve: Sustainability");
    const thematicIdx = all.indexOf("Thematic equity tilt within the equity sleeve");
    expect(thematicIdx).toBeGreaterThan(0);
    expect(thematicIdx).toBeLessThan(satellitesIdx);
    expect(all).not.toMatch(/Satellites:[\s\S]*Thematic equity/);
    // The old "thematic equity belongs to the Equities group" parenthetical
    // was removed when the Output A) sentence was simplified — make sure it
    // does not creep back in.
    expect(all).not.toContain("thematic equity belongs to the Equities group");

    // Crypto-only satellites: header line + crypto bullet, no commodities/REITs entries inside.
    const cryptoOnly = buildAiPrompt(
      baseInput({
        includeCrypto: true,
        includeListedRealEstate: false,
        includeCommodities: false,
        thematicPreference: "None",
      })
    );
    expect(cryptoOnly).toContain("Satellites:\n- Crypto Assets");
    expect(cryptoOnly).not.toContain("Commodities / Precious Metals");
    expect(cryptoOnly).not.toContain("Listed Real Estate (REITs)");

    const cryptoOnlyDe = buildAiPrompt(
      baseInput({
        includeCrypto: true,
        includeListedRealEstate: false,
        includeCommodities: false,
        thematicPreference: "None",
      }),
      "de",
    );
    expect(cryptoOnlyDe).toContain("Satelliten:\n- Krypto-Assets");

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
    expect(none).not.toContain("Thematic equity tilt within the equity sleeve");
    expect(none).toContain("Satellites: none requested");
  });

  it("places Commodities under Core asset classes (not Satellites) when enabled", () => {
    const en = buildAiPrompt(
      baseInput({ includeCommodities: true, includeListedRealEstate: false, includeCrypto: false }),
    );
    const coreIdx = en.indexOf("Core Asset Classes:");
    const satIdx = en.indexOf("Satellites");
    const cIdx = en.indexOf("- Commodities / Precious Metals");
    expect(coreIdx).toBeGreaterThan(0);
    expect(satIdx).toBeGreaterThan(coreIdx);
    expect(cIdx).toBeGreaterThan(coreIdx);
    expect(cIdx).toBeLessThan(satIdx);
    expect(en).toContain("Satellites: none requested by the investor.");

    const de = buildAiPrompt(
      baseInput({ includeCommodities: true, includeListedRealEstate: false, includeCrypto: false }),
      "de",
    );
    const kernIdx = de.indexOf("Kern-Anlageklassen:");
    const satDeIdx = de.indexOf("Satelliten");
    const rohIdx = de.indexOf("- Rohstoffe / Edelmetalle");
    expect(kernIdx).toBeGreaterThan(0);
    expect(satDeIdx).toBeGreaterThan(kernIdx);
    expect(rohIdx).toBeGreaterThan(kernIdx);
    expect(rohIdx).toBeLessThan(satDeIdx);
    expect(de).toContain("Satelliten: vom Anleger nicht gewuenscht.");
  });

  it("includes the new MANDATORY validation + consistency blocks (EN + DE)", () => {
    const en = buildAiPrompt(baseInput());
    expect(en).toContain("11. Critical ETF validation requirement (MANDATORY):");
    expect(en).toContain("12. Final consistency checks (MANDATORY):");
    expect(en).toContain("- all ISINs are unique");
    expect(en).toContain("13. Write the full answer in clear English.");
    // Old constraints 6-9 (cost efficiency / no tactical / rules-based / sensible assumptions)
    // were dropped in the rewrite — their lead phrases must no longer appear.
    expect(en).not.toContain("Prioritize cost efficiency");
    expect(en).not.toContain("Do not make tactical market forecasts");

    const de = buildAiPrompt(baseInput(), "de");
    expect(de).toContain("11. Kritische ETF-Validierungsanforderung (VERPFLICHTEND):");
    expect(de).toContain("12. Abschliessende Konsistenzpruefungen (VERPFLICHTEND):");
    expect(de).toContain("- alle ISINs sind eindeutig");
    expect(de).toContain("13. Verfasse die gesamte Antwort in klarem Deutsch.");
    expect(de).not.toContain("Priorisiere Kosteneffizienz");
    expect(de).not.toContain("Triff keine taktischen Marktprognosen");
  });

  it("includes the Explain-import file section I) in EN + DE", () => {
    const en = buildAiPrompt(baseInput());
    expect(en).toContain("I) ETF implementation import file for the Investment Decision Lab \"Explain my Portfolio\" tab");
    expect(en).toContain("ISIN;weight");
    expect(en).toContain("must sum to 100");
    const de = buildAiPrompt(baseInput(), "de");
    expect(de).toContain("I) ETF-Umsetzungs-Importdatei fuer den Tab \"Mein Portfolio erklaeren\" des Investment Decision Lab");
    expect(de).toContain("ISIN;weight");
    expect(de).toContain("in Summe 100 ergeben");
  });

  it("Table 1 group header lists Commodities as its own group (EN + DE)", () => {
    const en = buildAiPrompt(baseInput());
    expect(en).toContain("Group: Cash, Bonds, Equities, Commodities, Satellites");
    expect(en).toContain("Cash, Bonds, Equities, Commodities, and Satellites");
    const de = buildAiPrompt(baseInput(), "de");
    expect(de).toContain("Gruppe: Cash, Anleihen, Aktien, Rohstoffe, Satelliten");
    expect(de).toContain("Cash, Anleihen, Aktien, Rohstoffe und Satelliten");
  });

  it("toggles the synthetic-ETF and currency-hedging instructions correctly", () => {
    const optedIn = buildAiPrompt(baseInput({ includeSyntheticETFs: true, includeCurrencyHedging: true }));
    expect(optedIn).toContain("Include synthetic ETFs");
    expect(optedIn).toContain("State clearly whether currency hedging");
    // Lock the new numbering: hedging is constraint 7, synthetic is constraint 9.
    expect(optedIn).toContain("7. State clearly whether currency hedging");
    expect(optedIn).toContain("9. Include synthetic ETFs");

    const optedOut = buildAiPrompt(baseInput({ includeSyntheticETFs: false, includeCurrencyHedging: false }));
    expect(optedOut).toContain("Use physical replication only");
    expect(optedOut).toContain("does NOT want broad currency hedging");
    expect(optedOut).toContain("7. The investor does NOT want broad currency hedging");
    expect(optedOut).toContain("9. Use physical replication only");
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
      "I) ETF implementation import file for the Investment Decision Lab \"Explain my Portfolio\" tab",
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
    // MC reports NET of WHT drag — single-asset US-equity baseline must
    // therefore equal CMA.equity_us.expReturn − WHT_DRAG.equity_us.
    expect(baseline.expectedReturn).toBeCloseTo(
      CMA.equity_us.expReturn - WHT_DRAG.equity_us,
      6,
    );
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
    // After mutating CMA, MC should reflect 0.123 NET of WHT drag.
    expect(after).toBeCloseTo(0.123 - WHT_DRAG.equity_us, 6);
    expect(after).not.toBeCloseTo(before, 4);
  });

  it("cash μ tracks the per-currency RF (cash-mu-per-currency, 2026-05)", async () => {
    const { effectiveCashExpReturn, portfolioReturn, computeMetrics, CMA } =
      await import("../src/lib/metrics");
    const { getRiskFreeRate } = await import("../src/lib/settings");
    // Cash μ is now slaved to the per-currency RF (the same source the
    // Sharpe denominator already uses), regardless of how the RF default
    // is composed (built-in vs app-defaults overlay vs user override).
    // No window/localStorage in node → no user override → cash μ === RF.
    for (const ccy of ["USD", "EUR", "GBP", "CHF"] as const) {
      expect(effectiveCashExpReturn(ccy)).toBeCloseTo(getRiskFreeRate(ccy), 10);
    }
    // The four shipped RFs span a wide enough range that at least one of
    // them must differ from the seed cash μ (3.0 %), proving the engine no
    // longer falls back to the seed for any currency in the default set.
    const ccys = ["USD", "EUR", "GBP", "CHF"] as const;
    expect(ccys.some((c) => Math.abs(effectiveCashExpReturn(c) - CMA.cash.expReturn) > 1e-6)).toBe(true);

    // 100 % cash portfolio: portfolioReturn must equal the per-currency RF
    // when baseCurrency is supplied, and fall back to the seed when not
    // (back-compat for older callers / tests).
    const exp100Cash = [{ key: "cash" as const, weight: 1 }];
    expect(portfolioReturn(exp100Cash, "USD")).toBeCloseTo(getRiskFreeRate("USD"), 10);
    expect(portfolioReturn(exp100Cash, "CHF")).toBeCloseTo(getRiskFreeRate("CHF"), 10);
    expect(portfolioReturn(exp100Cash)).toBeCloseTo(CMA.cash.expReturn, 10);

    // End-to-end through computeMetrics: switching the displayed currency
    // re-prices the cash sleeve in the headline expReturn. WHT drag on
    // cash is 0 and the other buckets (US equity, global bonds) are
    // currency-agnostic in CMA, so the full ΔexpReturn between two
    // currencies equals cashWeight × ΔRF.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
      { assetClass: "Cash", region: "Global", weight: 10 },
    ];
    const usd = computeMetrics(allocation, "USD");
    const chf = computeMetrics(allocation, "CHF");
    const expectedCashDelta = 0.10 * (getRiskFreeRate("USD") - getRiskFreeRate("CHF"));
    expect(usd.expReturn - chf.expReturn).toBeCloseTo(expectedCashDelta, 10);
  });

  it("cash μ blends per-row currency in Explain (cash-mu-per-currency phase 2, 2026-05)", async () => {
    const { cashSleeveMu, portfolioReturn, computeMetrics, portfolioWhtDrag } =
      await import("../src/lib/metrics");
    const { getRiskFreeRate } = await import("../src/lib/settings");

    // Explain synthesizes a cash row per cashCurrency: e.g. 50 % GBP +
    // 50 % CHF cash with USD as the displayed base must price each row
    // off its own RF, NOT off USD's RF for the whole sleeve.
    const mixed: AssetAllocation[] = [
      { assetClass: "Cash", region: "GBP", weight: 50 },
      { assetClass: "Cash", region: "CHF", weight: 50 },
    ];
    const blended = cashSleeveMu(mixed, "USD");
    expect(blended).toBeCloseTo(0.5 * getRiskFreeRate("GBP") + 0.5 * getRiskFreeRate("CHF"), 12);

    // 100 % cash sleeve via portfolioReturn override → engine must use
    // the per-row blend, not the USD RF.
    const exp100Cash = [{ key: "cash" as const, weight: 1 }];
    expect(portfolioReturn(exp100Cash, "USD", blended)).toBeCloseTo(blended!, 12);

    // computeMetrics end-to-end: a portfolio with mixed-currency cash
    // rows must shift expReturn by cashWeight × (blended − USD RF) vs
    // the same allocation collapsed to a single USD-cash row. Other
    // buckets are currency-agnostic in CMA so the only mover is cash.
    const allocMixed: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 20 },
      { assetClass: "Cash", region: "GBP", weight: 10 },
      { assetClass: "Cash", region: "CHF", weight: 10 },
    ];
    const allocBaseline: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 20 },
      { assetClass: "Cash", region: "USD", weight: 20 },
    ];
    const m1 = computeMetrics(allocMixed, "USD");
    const m2 = computeMetrics(allocBaseline, "USD");
    const blend20 = 0.5 * getRiskFreeRate("GBP") + 0.5 * getRiskFreeRate("CHF");
    const expectedDelta = 0.20 * (blend20 - getRiskFreeRate("USD"));
    expect(m1.expReturn - m2.expReturn).toBeCloseTo(expectedDelta, 10);

    // Build's single cash row (region === baseCurrency) must degenerate
    // to the existing per-currency RF — no behaviour change for Build.
    const buildAlloc: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 70 },
      { assetClass: "Cash", region: "USD", weight: 30 },
    ];
    expect(cashSleeveMu(buildAlloc, "USD")).toBeCloseTo(getRiskFreeRate("USD"), 12);

    // "Global" cash region (manual rows without explicit currency) falls
    // back to baseCurrency so the legacy Build path is preserved.
    const globalCash: AssetAllocation[] = [
      { assetClass: "Cash", region: "Global", weight: 100 },
    ];
    expect(cashSleeveMu(globalCash, "EUR")).toBeCloseTo(getRiskFreeRate("EUR"), 12);

    // No cash → undefined so callers can fall back to base RF cleanly.
    const noCash: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 100 },
    ];
    expect(cashSleeveMu(noCash, "USD")).toBeUndefined();

    // Frontier semantics: the swept blended-mix points must keep
    // pricing cash off the displayed baseCurrency (the abstract
    // "what if we shifted to X % equity?" reference is NOT the user's
    // allocation), but the `current` dot must reflect the per-row
    // cash blend. Two USD-base allocations differing only in the cash
    // sleeve (mixed-currency vs same-currency) must therefore have
    // identical swept points but different `current.ret`.
    const { computeFrontier } = await import("../src/lib/metrics");
    const f1 = computeFrontier(allocMixed, "USD");
    const f2 = computeFrontier(allocBaseline, "USD");
    for (let i = 0; i < f1.points.length; i++) {
      expect(f1.points[i].ret).toBeCloseTo(f2.points[i].ret, 12);
    }
    expect(f1.current.ret - f2.current.ret).toBeCloseTo(expectedDelta, 10);

    // Touch the unused import so the linter stays happy and this test
    // still imports the same surface as the phase-1 sibling above.
    expect(typeof portfolioWhtDrag).toBe("function");
  });

  it("path-based realized MDD obeys ordering invariants and is non-positive", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    // Mixed allocation so we have meaningful drawdown distribution
    const alloc = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
      { assetClass: "Cash", region: "Global", weight: 10 },
    ];
    const r = runMonteCarlo(alloc, 10, 100_000, { paths: 1000, seed: 42 });
    // Both quantiles must be in (-1, 0] (drawdown is a loss, capped at -100 %).
    expect(r.realizedMddP05).toBeLessThanOrEqual(0);
    expect(r.realizedMddP50).toBeLessThanOrEqual(0);
    expect(r.realizedMddP05).toBeGreaterThan(-1);
    expect(r.realizedMddP50).toBeGreaterThan(-1);
    // Bad-tail (P05) must be at least as deep as the typical path (P50).
    expect(r.realizedMddP05).toBeLessThanOrEqual(r.realizedMddP50);
    // For a 60/30/10 portfolio over 10y the median drawdown should be
    // materially negative — sanity bound that catches accidental zeroing.
    expect(r.realizedMddP50).toBeLessThan(-0.02);
  });

  it("synthetic-US carve-out lifts expReturn by exactly WHT_DRAG.equity_us × US weight (USD base, 100 % US equity)", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    // 100 % US equity, USD base, no hedge → synthetic effective.
    // Drag should drop from WHT_DRAG.equity_us (=30 bps) to 0,
    // so MC expectedReturn rises by exactly that amount.
    const alloc = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const physical = runMonteCarlo(alloc, 5, 100_000, { paths: 200, seed: 1, baseCurrency: "USD" });
    const synthetic = runMonteCarlo(alloc, 5, 100_000, {
      paths: 200, seed: 1, baseCurrency: "USD", syntheticUsEffective: true,
    });
    expect(synthetic.expectedReturn - physical.expectedReturn).toBeCloseTo(WHT_DRAG.equity_us, 8);
    // Sigma is untouched by the drag — same paths, same vol.
    expect(synthetic.expectedVol).toBeCloseTo(physical.expectedVol, 10);
  });

  it("synthetic-US carve-out lifts portfolio expReturn AND alpha (benchmark drag stays full)", () => {
    // 60 / 25 / 15 portfolio, USD base. Synthetic effective for the user's
    // US sleeve only — the benchmark is a physical-ACWI proxy and keeps its
    // full WHT, so alpha and outperformance both rise by 0.60 × 30 bps = 18 bps.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 25 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
    ];
    const physical = computeMetrics(allocation, "USD", undefined, false);
    const synthetic = computeMetrics(allocation, "USD", undefined, true);
    const expectedLift = 0.60 * WHT_DRAG.equity_us;
    expect(synthetic.expReturn - physical.expReturn).toBeCloseTo(expectedLift, 8);
    expect(synthetic.alpha - physical.alpha).toBeCloseTo(expectedLift, 8);
    expect(synthetic.outperformance - physical.outperformance).toBeCloseTo(expectedLift, 8);
    // Benchmark return is untouched — synthetic only changes the portfolio side.
    expect(synthetic.benchmarkReturn).toBeCloseTo(physical.benchmarkReturn, 10);
    // Vol / beta / TE unchanged — drag is a return-only adjustment.
    expect(synthetic.vol).toBeCloseTo(physical.vol, 10);
    expect(synthetic.beta).toBeCloseTo(physical.beta, 10);
    expect(synthetic.trackingError).toBeCloseTo(physical.trackingError, 10);
  });

  it("isSyntheticUsEffective gate matches the rationale-text condition (synthetic && !(hedged && base!==USD))", async () => {
    const { isSyntheticUsEffective } = await import("../src/lib/metrics");
    // Toggle off → never effective.
    expect(isSyntheticUsEffective(false, "USD", false)).toBe(false);
    expect(isSyntheticUsEffective(false, "CHF", true)).toBe(false);
    // Toggle on, USD base → effective regardless of hedge (hedge is a no-op for USD residents).
    expect(isSyntheticUsEffective(true, "USD", false)).toBe(true);
    expect(isSyntheticUsEffective(true, "USD", true)).toBe(true);
    // Toggle on, non-USD base, unhedged → effective (synthetic share class wins).
    expect(isSyntheticUsEffective(true, "CHF", false)).toBe(true);
    expect(isSyntheticUsEffective(true, "EUR", false)).toBe(true);
    // Toggle on, non-USD base, hedged → NOT effective (ETF picker keeps physical pick).
    expect(isSyntheticUsEffective(true, "CHF", true)).toBe(false);
    expect(isSyntheticUsEffective(true, "EUR", true)).toBe(false);
  });

  it("WHT drag affects expReturn / alpha / outperformance but leaves vol / beta / TE unchanged", async () => {
    // Snapshot WHT_DRAG, zero it out, recompute, then restore. Vol/beta/TE
    // depend only on σ and correlations — they MUST be invariant to the drag.
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 25 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
    ];
    const before = computeMetrics(allocation, "USD");
    const snapshot: Record<string, number> = {};
    for (const k of Object.keys(WHT_DRAG)) {
      snapshot[k] = WHT_DRAG[k as keyof typeof WHT_DRAG];
      (WHT_DRAG as Record<string, number>)[k] = 0;
    }
    try {
      const after = computeMetrics(allocation, "USD");
      // Drag-sensitive metrics should differ.
      expect(after.expReturn).toBeGreaterThan(before.expReturn);
      expect(after.alpha).not.toBeCloseTo(before.alpha, 6);
      expect(after.outperformance).not.toBeCloseTo(before.outperformance, 6);
      // Drag-INSENSITIVE metrics must be bit-identical (no σ, no covariance,
      // no benchmark-vol changes flow through WHT).
      expect(after.vol).toBeCloseTo(before.vol, 10);
      expect(after.beta).toBeCloseTo(before.beta, 10);
      expect(after.trackingError).toBeCloseTo(before.trackingError, 10);
    } finally {
      for (const k of Object.keys(snapshot)) {
        (WHT_DRAG as Record<string, number>)[k as keyof typeof WHT_DRAG] = snapshot[k];
      }
    }
  });

  // -- Compare A=physical vs B=synthetic regression (architect-review follow-up) ----
  // The `includeSyntheticETFs` flag is plumbed through 4 call sites in
  // ComparePortfolios.tsx (Mobile A+B, Desktop A+B). These engine-level tests
  // pin the contract those call sites depend on, so a future refactor of the
  // compare layout cannot silently drop the prop without one of these failing.

  it("synthetic lift scales linearly with US-equity weight (Compare A=30 % vs B=60 % scenario)", () => {
    // Same engine call ComparePortfolios makes per portfolio, just with two
    // different US weights. If the prop ever stops reaching computeMetrics,
    // both sides degenerate to the physical case and this test breaks.
    const lo: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 30 },
      { assetClass: "Equity", region: "Europe", weight: 55 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
    ];
    const hi: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 25 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
    ];
    const liftLo = computeMetrics(lo, "USD", undefined, true).expReturn
                 - computeMetrics(lo, "USD", undefined, false).expReturn;
    const liftHi = computeMetrics(hi, "USD", undefined, true).expReturn
                 - computeMetrics(hi, "USD", undefined, false).expReturn;
    // Lift is exactly w_us × WHT_DRAG.equity_us — linear in US weight.
    expect(liftLo).toBeCloseTo(0.30 * WHT_DRAG.equity_us, 8);
    expect(liftHi).toBeCloseTo(0.60 * WHT_DRAG.equity_us, 8);
    // And the 60 % side is exactly twice the 30 % side.
    expect(liftHi).toBeCloseTo(2 * liftLo, 8);
  });

  it("synthetic toggle is a no-op when the portfolio holds zero US equity (edge case)", () => {
    // No equity_us bucket → carve-out has nothing to bite on. Guards against a
    // future refactor that accidentally widens the carve-out from equity_us
    // to all equity buckets (which would silently inflate non-US returns).
    const alloc: AssetAllocation[] = [
      { assetClass: "Equity", region: "Europe", weight: 70 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
    ];
    const physical = computeMetrics(alloc, "USD", undefined, false);
    const synthetic = computeMetrics(alloc, "USD", undefined, true);
    expect(synthetic.expReturn).toBeCloseTo(physical.expReturn, 12);
    expect(synthetic.alpha).toBeCloseTo(physical.alpha, 12);
    expect(synthetic.outperformance).toBeCloseTo(physical.outperformance, 12);
    expect(synthetic.benchmarkReturn).toBeCloseTo(physical.benchmarkReturn, 12);
  });

  it("CMA override × synthetic ON: carve-out is additive on the overridden μ (no double-count)", async () => {
    // User overrides US-equity expReturn to 0.10 (e.g. their own house view).
    // With synthetic ON, the carve-out must remove the 30 bps drag from the
    // US sleeve regardless of the override magnitude — i.e. the lift is still
    // exactly w_us × WHT_DRAG.equity_us, NOT scaled by the override level.
    // Pins the additive composition of CMA-layer × WHT-layer.
    const { CMA } = await import("../src/lib/metrics");
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 25 },
      { assetClass: "Fixed Income", region: "Global", weight: 15 },
    ];
    const originalUs = CMA.equity_us.expReturn;
    CMA.equity_us.expReturn = 0.10;
    try {
      const physical = computeMetrics(allocation, "USD", undefined, false);
      const synthetic = computeMetrics(allocation, "USD", undefined, true);
      // Lift is invariant to the override level — only the US weight matters.
      const expectedLift = 0.60 * WHT_DRAG.equity_us;
      expect(synthetic.expReturn - physical.expReturn).toBeCloseTo(expectedLift, 8);
      // And the absolute physical leg uses the OVERRIDDEN μ (0.10) minus
      // the full drag — proves the override flowed through and the drag is
      // still applied on the physical side.
      const expectedPhysExpReturn =
        0.60 * (0.10 - WHT_DRAG.equity_us) +
        0.25 * (CMA.equity_eu.expReturn - WHT_DRAG.equity_eu) +
        0.15 * (CMA.bonds.expReturn - WHT_DRAG.bonds);
      expect(physical.expReturn).toBeCloseTo(expectedPhysExpReturn, 8);
    } finally {
      CMA.equity_us.expReturn = originalUs;
    }
  });

  // Task #300 — bond-only FX hedge applies the σ cut only to FI buckets,
  // never to equity. Build two pure-sleeve allocations and verify:
  //   (a) FI vol drops by the same 0.01 cut as full hedge.
  //   (b) Equity vol is unchanged.
  // Base is CHF so the foreign-currency hedge is meaningful.
  it("Task #300 — bondsHedged cuts σ on FI only (equity untouched)", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const fi = [{ assetClass: "Fixed Income", region: "Global", weight: 100 }];
    const eq = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const fiBase = runMonteCarlo(fi, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: false, baseCurrency: "CHF" });
    const fiBondHedged = runMonteCarlo(fi, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: true, baseCurrency: "CHF" });
    const eqBase = runMonteCarlo(eq, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: false, baseCurrency: "CHF" });
    const eqBondHedged = runMonteCarlo(eq, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: true, baseCurrency: "CHF" });
    expect(fiBase.expectedVol - fiBondHedged.expectedVol).toBeCloseTo(0.01, 6);
    expect(eqBondHedged.expectedVol).toBeCloseTo(eqBase.expectedVol, 6);
  });

  // USD base: bondsHedged must be a no-op (no foreign-currency bond
  // exposure to hedge).
  it("Task #300 — bondsHedged is a no-op when baseCurrency is USD", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const fi = [{ assetClass: "Fixed Income", region: "Global", weight: 100 }];
    const a = runMonteCarlo(fi, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: false, baseCurrency: "USD" });
    const b = runMonteCarlo(fi, 5, 100_000, { paths: 200, seed: 1, hedged: false, bondsHedged: true, baseCurrency: "USD" });
    expect(b.expectedVol).toBeCloseTo(a.expectedVol, 8);
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

  it("CMA whitelist accepts equity_uk overrides (regression — keeps GBP-base parity with CHF / EUR / etc.)", async () => {
    const { getCMAOverrides } = await import("../src/lib/settings");
    const fakeStore: Record<string, string> = {
      "idl.cmaOverrides": JSON.stringify({
        equity_uk: { expReturn: 0.07, vol: 0.16 },
        equity_ch: { expReturn: 0.06, vol: 0.14 },
      }),
    };
    const orig = (globalThis as { window?: { localStorage: Storage } }).window;
    (globalThis as unknown as { window: { localStorage: Pick<Storage, "getItem"> } }).window = {
      localStorage: { getItem: (k: string) => fakeStore[k] ?? null },
    };
    try {
      const o = getCMAOverrides();
      // Both home-carve-out buckets must survive the whitelist filter — they
      // are first-class equity buckets and the UI lets users override their CMA.
      expect(o.equity_uk).toEqual({ expReturn: 0.07, vol: 0.16 });
      expect(o.equity_ch).toEqual({ expReturn: 0.06, vol: 0.14 });
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

  it("per-currency risk-free rate: changing USD RF shifts USD bucket weights; reset restores baseline", async () => {
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
      // Baseline at default USD RF (4.25%).
      const baseline = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      const baselineUS = eqW(baseline, "USA");
      const baselineEM = eqW(baseline, "EM");
      // Raise USD RF to 8%. With CMA expReturns roughly in [4–9%], higher RF
      // compresses Sharpe across the board AND shifts the relative ranking
      // toward higher-expReturn / higher-vol regions (EM) vs developed (USA).
      settings.setRiskFreeRate("USD", 0.08);
      expect(settings.getRiskFreeRate("USD")).toBeCloseTo(0.08, 6);
      const tilted = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      const tiltedUS = eqW(tilted, "USA");
      const tiltedEM = eqW(tilted, "EM");
      // Bucket weights must move (the whole point of this change). At least
      // one developed region must shift by a measurable amount. Threshold is
      // intentionally low (>= 0.25 pp) because the 65 % concentration cap can
      // pin USA in place; we only need to prove the RF actually flows through.
      const usaShift = Math.abs(tiltedUS - baselineUS);
      const emShift = Math.abs(tiltedEM - baselineEM);
      expect(usaShift + emShift).toBeGreaterThanOrEqual(0.25);
      // Reset → baseline restored within rounding.
      settings.resetRiskFreeRate("USD");
      expect(settings.getRiskFreeRate("USD")).toBeCloseTo(0.0425, 6);
      const restored = buildPortfolio(baseInput({ baseCurrency: "USD", numETFs: 12 }));
      expect(Math.abs(eqW(restored, "USA") - baselineUS)).toBeLessThan(0.01);
      expect(Math.abs(eqW(restored, "EM") - baselineEM)).toBeLessThan(0.01);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("per-currency RF defaults: USD/EUR/GBP/CHF return their own seeded values", async () => {
    const settings = await import("../src/lib/settings");
    const orig = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      // No window → defaults must be returned by getRiskFreeRate(ccy).
      // The exact values depend on whatever overlay app-defaults.json
      // currently ships, so we reference RF_DEFAULTS as the source of truth
      // rather than hardcoding numbers that bit-rot every time an admin PR
      // tweaks the global defaults (this test broke 3 times in 2026-04-27
      // for exactly that reason).
      expect(settings.getRiskFreeRate("USD")).toBeCloseTo(settings.RF_DEFAULTS.USD, 6);
      expect(settings.getRiskFreeRate("EUR")).toBeCloseTo(settings.RF_DEFAULTS.EUR, 6);
      expect(settings.getRiskFreeRate("GBP")).toBeCloseTo(settings.RF_DEFAULTS.GBP, 6);
      expect(settings.getRiskFreeRate("CHF")).toBeCloseTo(settings.RF_DEFAULTS.CHF, 6);
      // Sanity-check the structural contract: all four currencies present,
      // all in the [0, 0.2] band that clampRf enforces.
      expect(Object.keys(settings.RF_DEFAULTS).sort()).toEqual(["CHF", "EUR", "GBP", "USD"]);
      for (const v of Object.values(settings.RF_DEFAULTS)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0.2);
      }
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
    }
  });

  it("per-currency Home Bias: resetHomeBiasOverride(ccy) reverts only that currency, leaves siblings untouched", async () => {
    const settings = await import("../src/lib/settings");
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
      // Override two currencies; reset only one.
      settings.setHomeBiasOverrides({ CHF: 4.0, USD: 1.8 });
      expect(settings.resolvedHomeBias("CHF")).toBe(4.0);
      expect(settings.resolvedHomeBias("USD")).toBe(1.8);
      settings.resetHomeBiasOverride("CHF");
      // CHF back to its default (2.5); USD override still active.
      expect(settings.resolvedHomeBias("CHF")).toBe(settings.HOME_BIAS_DEFAULTS.CHF);
      expect(settings.resolvedHomeBias("USD")).toBe(1.8);
      // Reset the second one too — storage key must be removed and overrides empty.
      settings.resetHomeBiasOverride("USD");
      expect(settings.resolvedHomeBias("USD")).toBe(settings.HOME_BIAS_DEFAULTS.USD);
      expect(settings.getHomeBiasOverrides()).toEqual({});
      // No-op on an unknown currency must not throw and must not mutate state.
      settings.resetHomeBiasOverride("CHF");
      expect(settings.getHomeBiasOverrides()).toEqual({});
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("per-asset CMA: resetCMAOverride(key) reverts only that asset, leaves siblings untouched", async () => {
    const settings = await import("../src/lib/settings");
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
      // Override two assets; reset only one.
      settings.setCMAOverrides({
        equity_us: { expReturn: 0.09, vol: 0.18 },
        equity_em: { expReturn: 0.11, vol: 0.22 },
      });
      let ov = settings.getCMAOverrides();
      expect(ov.equity_us?.expReturn).toBeCloseTo(0.09, 6);
      expect(ov.equity_em?.expReturn).toBeCloseTo(0.11, 6);
      settings.resetCMAOverride("equity_us");
      ov = settings.getCMAOverrides();
      expect(ov.equity_us).toBeUndefined();
      expect(ov.equity_em?.expReturn).toBeCloseTo(0.11, 6);
      // Reset the last one — storage key must be removed and overrides empty.
      settings.resetCMAOverride("equity_em");
      expect(settings.getCMAOverrides()).toEqual({});
      // Unknown / not-present keys are silent no-ops.
      settings.resetCMAOverride("equity_us");
      settings.resetCMAOverride("not_a_real_asset");
      expect(settings.getCMAOverrides()).toEqual({});
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("per-currency RF: editing one currency leaves the other three on their defaults (cross-currency isolation)", async () => {
    const settings = await import("../src/lib/settings");
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
      // Override CHF only; USD / EUR / GBP must stay on their defaults.
      // (Defaults are sourced from RF_DEFAULTS so this stays valid when an
      // admin PR changes app-defaults.json — see the "per-currency RF
      // defaults" test above for the same reasoning.)
      settings.setRiskFreeRate("CHF", 0.012);
      expect(settings.getRiskFreeRate("CHF")).toBeCloseTo(0.012, 6);
      expect(settings.getRiskFreeRate("USD")).toBeCloseTo(settings.RF_DEFAULTS.USD, 6);
      expect(settings.getRiskFreeRate("EUR")).toBeCloseTo(settings.RF_DEFAULTS.EUR, 6);
      expect(settings.getRiskFreeRate("GBP")).toBeCloseTo(settings.RF_DEFAULTS.GBP, 6);
      // Reset CHF brings it back to its default; others still untouched.
      settings.resetRiskFreeRate("CHF");
      expect(settings.getRiskFreeRate("CHF")).toBeCloseTo(settings.RF_DEFAULTS.CHF, 6);
      expect(settings.getRiskFreeRate("USD")).toBeCloseTo(settings.RF_DEFAULTS.USD, 6);
      // After the only override is reset, the storage key is removed so
      // getRiskFreeRateOverrides() returns {}.
      expect(settings.getRiskFreeRateOverrides()).toEqual({});
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("per-currency RF: getRiskFreeRates sanitization drops unknown currencies and clamps out-of-bounds values", async () => {
    const { getRiskFreeRates, getRiskFreeRateOverrides, RF_DEFAULTS } = await import("../src/lib/settings");
    const fakeStore: Record<string, string> = {
      "idl.riskFreeRates": JSON.stringify({
        USD: 0.05,
        XYZ: 0.03,        // unknown currency → dropped
        EUR: 99,          // out of bounds → clamped to 0.2
        GBP: -1,          // negative → clamped to 0
        CHF: "abc",       // wrong type → dropped → falls back to default
      }),
    };
    const orig = (globalThis as { window?: unknown }).window;
    (globalThis as unknown as { window: { localStorage: Pick<Storage, "getItem"> } }).window = {
      localStorage: { getItem: (k: string) => fakeStore[k] ?? null },
    };
    try {
      const rates = getRiskFreeRates();
      expect(rates.USD).toBeCloseTo(0.05, 6);
      expect(rates.EUR).toBeCloseTo(0.20, 6);   // clamped to upper bound
      expect(rates.GBP).toBeCloseTo(0, 6);      // clamped to lower bound
      expect(rates.CHF).toBeCloseTo(RF_DEFAULTS.CHF, 6); // wrong type → falls through to default
      const ov = getRiskFreeRateOverrides();
      // overrides view should NOT include unknown currencies or wrong-type ones
      expect(Object.keys(ov).sort()).toEqual(["EUR", "GBP", "USD"]);
      expect((ov as Record<string, unknown>).XYZ).toBeUndefined();
      expect(ov.CHF).toBeUndefined();
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("per-currency RF: computeMetrics uses the requested currency's RF (USD vs CHF Sharpe differ)", async () => {
    const { computeMetrics } = await import("../src/lib/metrics");
    const orig = (globalThis as { window?: unknown }).window;
    // No window → both currencies fall back to their per-currency default.
    delete (globalThis as { window?: unknown }).window;
    try {
      // Same allocation, same μ, same σ; only the RF differs by base currency.
      const alloc: AssetAllocation[] = [
        { assetClass: "Equity", region: "USA", weight: 60 },
        { assetClass: "Fixed Income", region: "Global", weight: 40 },
      ];
      const usd = computeMetrics(alloc, "USD"); // RF = 0.0425
      const chf = computeMetrics(alloc, "CHF"); // RF = 0.0050
      // Lower CHF RF → higher Sharpe for the same expReturn / vol.
      expect(chf.sharpe).toBeGreaterThan(usd.sharpe);
      // Numbers must differ by a meaningful amount, not just rounding noise.
      expect(chf.sharpe - usd.sharpe).toBeGreaterThan(0.05);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
    }
  });

  it("per-currency RF: computeFrontier uses the requested currency's RF (USD vs CHF Sharpe differ at every point and at the max)", async () => {
    const { computeFrontier } = await import("../src/lib/metrics");
    const orig = (globalThis as { window?: unknown }).window;
    // No window → both currencies fall back to their per-currency default.
    delete (globalThis as { window?: unknown }).window;
    try {
      // Same allocation, same μ, same σ; only the RF differs by base currency.
      // Mixed equity + bonds + cash so the sweep produces a non-degenerate
      // Sharpe-optimal point that depends on the risk-free rate.
      const alloc: AssetAllocation[] = [
        { assetClass: "Equity", region: "USA", weight: 50 },
        { assetClass: "Equity", region: "EM", weight: 10 },
        { assetClass: "Fixed Income", region: "Global", weight: 35 },
        { assetClass: "Cash", region: "USD", weight: 5 },
      ];
      const usd = computeFrontier(alloc, "USD"); // RF = 0.0425
      const chf = computeFrontier(alloc, "CHF"); // RF = 0.0050

      // Both sweeps must produce the same 21-point grid so a 1:1 comparison
      // is meaningful.
      expect(usd.points.length).toBe(21);
      expect(chf.points.length).toBe(usd.points.length);

      // vol is RF-independent — it must match exactly at every point.
      // ret is *almost* RF-independent: the cash sleeve's μ is now slaved
      // to the per-currency RF (cash-mu-per-currency, 2026-05), so any
      // point that carries a cash weight > 0 differs by exactly
      // cashWeight × (RF_USD − RF_CHF). At equityPct = 100 (no cash) the
      // returns must match exactly.
      const { getRiskFreeRate } = await import("../src/lib/settings");
      const rfDelta = getRiskFreeRate("USD") - getRiskFreeRate("CHF");
      for (let i = 0; i < usd.points.length; i++) {
        expect(chf.points[i].equityPct).toBe(usd.points[i].equityPct);
        expect(chf.points[i].vol).toBeCloseTo(usd.points[i].vol, 12);
        // USD ret ≥ CHF ret (USD RF is higher → USD cash μ is higher).
        expect(usd.points[i].ret).toBeGreaterThanOrEqual(chf.points[i].ret - 1e-12);
      }
      // No-cash point (equityPct = 100): ret matches exactly.
      const last = usd.points.length - 1;
      expect(usd.points[last].equityPct).toBe(100);
      expect(chf.points[last].ret).toBeCloseTo(usd.points[last].ret, 12);
      // First point (equityPct = 0): all-defensive, cash share = 5/(5+35)
      // = 0.125 of the sleeve → ret diff = 0.125 × ΔRF.
      expect(usd.points[0].equityPct).toBe(0);
      expect(usd.points[0].ret - chf.points[0].ret).toBeCloseTo(0.125 * rfDelta, 10);

      // Sharpe must differ at *every* point (lower CHF RF → higher Sharpe for
      // the same return/vol), with a margin large enough to rule out rounding.
      // The expected gap is (RF_USD - RF_CHF) / vol = 0.0375 / vol; even at
      // the highest-vol equity-only point (~0.16) that is ≈0.23.
      for (let i = 0; i < usd.points.length; i++) {
        expect(chf.points[i].sharpe).toBeGreaterThan(usd.points[i].sharpe);
        expect(chf.points[i].sharpe - usd.points[i].sharpe).toBeGreaterThan(0.05);
      }

      // Sharpe-maximising portfolio: the *value* at the max must differ by a
      // meaningful margin. (The optimal equityPct may or may not shift; what
      // matters for the chart is the Sharpe-optimal point being computed
      // against the right RF.)
      const maxSharpe = (pts: typeof usd.points) =>
        pts.reduce((m, p) => (p.sharpe > m ? p.sharpe : m), -Infinity);
      const usdMax = maxSharpe(usd.points);
      const chfMax = maxSharpe(chf.points);
      expect(chfMax).toBeGreaterThan(usdMax);
      expect(chfMax - usdMax).toBeGreaterThan(0.1);

      // The `current` portfolio Sharpe must follow the same per-currency rule.
      expect(chf.current.sharpe).toBeGreaterThan(usd.current.sharpe);
      expect(chf.current.sharpe - usd.current.sharpe).toBeGreaterThan(0.05);
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
    }
  });

  it("per-currency RF: legacy `idl.riskFreeRate` key is removed on module load (no value migration)", async () => {
    const fakeStore: Record<string, string> = {
      "idl.riskFreeRate": "0.06", // pretend this old key existed
    };
    const removed: string[] = [];
    const orig = (globalThis as { window?: unknown }).window;
    (globalThis as unknown as { window: { localStorage: Pick<Storage, "getItem" | "removeItem"> } }).window = {
      localStorage: {
        getItem: (k: string) => fakeStore[k] ?? null,
        removeItem: (k: string) => { removed.push(k); delete fakeStore[k]; },
      },
    };
    try {
      // Force a fresh module evaluation so the top-level legacy-key cleanup
      // runs against this stubbed window.
      vi.resetModules();
      await import("../src/lib/settings");
      expect(removed).toContain("idl.riskFreeRate");
      expect(fakeStore["idl.riskFreeRate"]).toBeUndefined();
    } finally {
      if (orig) (globalThis as unknown as { window: typeof orig }).window = orig;
      else delete (globalThis as { window?: unknown }).window;
      vi.resetModules();
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

  // Task #204 regression: late subscribers (e.g. Methodology mounting AFTER
  // Build's useEffect already fired the publish) used to miss the current
  // state forever because `setLastBaseCurrency` dedupes on equal values.
  // `subscribeLastBaseCurrency` must replay the current in-memory value
  // synchronously on subscribe so Methodology's Cash μ always converges to
  // the user's actual base currency.
  it("subscribeLastBaseCurrency replays current value to late subscribers", async () => {
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
    const origCE = (globalThis as { CustomEvent?: unknown }).CustomEvent;
    (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent = class {
      type: string; detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
    } as unknown as typeof CustomEvent;
    try {
      const settings = await import("../src/lib/settings");
      // Build mounts and publishes "CHF" BEFORE Methodology subscribes.
      settings.setLastBaseCurrency("CHF" as BaseCurrency);
      expect(settings.getLastBaseCurrency()).toBe("CHF");
      // Late subscriber attaches now — must be replayed "CHF" immediately,
      // not silently stuck on its own (USD-fallback) initial state.
      const received: Array<unknown> = [];
      const unsub = settings.subscribeLastBaseCurrency((c) => received.push(c));
      expect(received).toEqual(["CHF"]);
      // Subsequent publishes still propagate as normal.
      settings.setLastBaseCurrency("USD" as BaseCurrency);
      expect(received).toEqual(["CHF", "USD"]);
      // Dedup guard still applies — re-publishing the same value is a no-op
      // for the event stream, but the late-subscribe replay above is what
      // closes the regression window.
      settings.setLastBaseCurrency("USD" as BaseCurrency);
      expect(received).toEqual(["CHF", "USD"]);
      unsub();
      // Reset so other tests start clean.
      settings.setLastBaseCurrency(null);
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

// =============================================================================
// Welle 1 — CFA-level methodology upgrades
// =============================================================================

describe("runMonteCarlo — CVaR / Expected Shortfall", () => {
  it("CVaR(95) and CVaR(99) are populated, ordered, and ≤ P10 in monetary terms", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 100 },
    ];
    const r = runMonteCarlo(allocation, 10, 100_000, { paths: 5_000, seed: 12345 });
    // Sanity: all four CVaR fields exist and are numeric.
    expect(Number.isFinite(r.cvar95Final)).toBe(true);
    expect(Number.isFinite(r.cvar99Final)).toBe(true);
    expect(Number.isFinite(r.cvar95Return)).toBe(true);
    expect(Number.isFinite(r.cvar99Return)).toBe(true);
    // CVaR(99) is in a deeper tail than CVaR(95), so its average final wealth
    // must be ≤ CVaR(95)'s, and both ≤ the P10 threshold.
    expect(r.cvar99Final).toBeLessThanOrEqual(r.cvar95Final);
    expect(r.cvar95Final).toBeLessThanOrEqual(r.finalP10);
    // CVaR returns are negative for a -EV / vol-heavy single equity sleeve.
    expect(r.cvar99Return).toBeLessThanOrEqual(r.cvar95Return);
  });
});

describe("CMA building blocks", () => {
  it("every asset has components that sum within 50bps of the seed expected return", async () => {
    const { CMA, CMA_BUILDING_BLOCKS, sumBuildingBlocks, getCMASeed } = await import("../src/lib/metrics");
    (Object.keys(CMA) as (keyof typeof CMA)[]).forEach((k) => {
      const seed = getCMASeed(k);
      const sum = sumBuildingBlocks(k);
      expect(Math.abs(sum - seed.expReturn)).toBeLessThanOrEqual(0.005);
      // Each component carries a stable i18n key and a finite contribution.
      CMA_BUILDING_BLOCKS[k].components.forEach((c) => {
        expect(typeof c.key).toBe("string");
        expect(c.key.startsWith("bb.")).toBe(true);
        expect(Number.isFinite(c.value)).toBe(true);
      });
      expect(typeof CMA_BUILDING_BLOCKS[k].source).toBe("string");
      expect(CMA_BUILDING_BLOCKS[k].source.startsWith("bb.src.")).toBe(true);
    });
  });
});

describe("runReverseStressTest", () => {
  it("equity-heavy 60/40 needs λ < ~1 vs GFC at -30% target", () => {
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Bond", region: "Global", weight: 40 },
    ];
    const r = runReverseStressTest(allocation, -30);
    expect(r.targetLoss).toBe(-30);
    const gfc = r.scenarios.find((s) => s.scenarioId === "gfc");
    expect(gfc).toBeDefined();
    // Baseline GFC for 60/40 is well negative; multiplier should be finite.
    expect(gfc!.baselineTotal).toBeLessThan(0);
    expect(gfc!.multiplier).not.toBeNull();
    // Sanity check: multiplier × baseline should land within rounding of -30.
    const reconstructed = (gfc!.multiplier ?? 0) * gfc!.baselineTotal;
    expect(Math.abs(reconstructed - -30)).toBeLessThanOrEqual(0.5);
  });

  it("equity-only uniform shock = target / equity-weight share", () => {
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Bond", region: "Global", weight: 50 },
    ];
    const r = runReverseStressTest(allocation, -20);
    expect(r.equityOnly.equityWeightTotal).toBeCloseTo(50, 1);
    // -20 / 0.5 = -40
    expect(r.equityOnly.uniformEquityShock).toBeCloseTo(-40, 1);
  });

  it("bonds-only allocation reports null equity-only shock", () => {
    const allocation = [{ assetClass: "Bond", region: "Global", weight: 100 }];
    const r = runReverseStressTest(allocation, -25);
    expect(r.equityOnly.uniformEquityShock).toBeNull();
    expect(r.equityOnly.equityWeightTotal).toBe(0);
  });

  it("scenarios with non-negative baseline return null multiplier (no positive λ can cause a loss)", () => {
    // 100% cash never produces a negative scenario total → multiplier null.
    const allocation = [{ assetClass: "Cash", region: "Global", weight: 100 }];
    const r = runReverseStressTest(allocation, -10);
    r.scenarios.forEach((s) => {
      if (s.baselineTotal >= 0) expect(s.multiplier).toBeNull();
    });
  });

  it("alreadyExceeds flag set iff scenario alone is worse than the target", () => {
    // A 100% equity allocation against a deep historical scenario at a lenient
    // -10 % pain threshold should already exceed at λ < 1.
    const allocation = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const r = runReverseStressTest(allocation, -10);
    const gfc = r.scenarios.find((s) => s.scenarioId === "gfc");
    expect(gfc).toBeDefined();
    if (gfc!.multiplier !== null) {
      expect(gfc!.alreadyExceeds).toBe(gfc!.multiplier < 1);
    }
  });
});

// =============================================================================
// Lieferung 2 — Tail-Realismus: Crisis-Σ + Student-t toggles
// =============================================================================
//
// Three contracts must hold for these toggles to be safe to ship as
// opt-in features:
//   1. DEFAULTS-OFF: every existing call site keeps the old behaviour
//      (no Crisis-Σ, no heavy tails) without passing the new options.
//   2. CRISIS-Σ STRICTLY WIDENS: any portfolio with at least two
//      imperfectly correlated risky sleeves must have crisis-σ ≥ normal-σ
//      and crisis-CVaR99 ≤ normal-CVaR99 at the same RNG seed.
//   3. STUDENT-T STRICTLY FATTENS TAILS: at the same seed and σ, switching
//      from Gauss to Student-t must worsen CVaR99 measurably while leaving
//      the median essentially unchanged.

describe("Lieferung 2 — Crisis-Σ correlation regime", () => {
  it("crisis regime increases portfolio σ for any imperfectly-correlated mix", async () => {
    const { computeMetrics } = await import("../src/lib/metrics");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 40 },
      { assetClass: "Equity", region: "Europe", weight: 20 },
      { assetClass: "Equity", region: "EM", weight: 10 },
      { assetClass: "Bonds", region: "Global", weight: 20 },
      { assetClass: "Real Estate (REITs)", region: "Global", weight: 10 },
    ];
    const normal = computeMetrics(allocation, "CHF", undefined, false, "normal");
    const crisis = computeMetrics(allocation, "CHF", undefined, false, "crisis");
    // Portfolio σ strictly rises (the clean invariant — diversification
    // benefits shrink when correlations rise).
    expect(crisis.vol).toBeGreaterThan(normal.vol);
    // Tracking error vs ACWI also strictly rises: in crisis the bonds-
    // equity correlation flips positive while ACWI is pure equity, so the
    // active sleeve is more correlated with the benchmark and the active
    // weight on bonds carries a larger σ-contribution.
    expect(crisis.trackingError).toBeGreaterThanOrEqual(normal.trackingError);
    // (Note: β is intentionally NOT asserted to rise — Var(ACWI) itself
    //  expands in crisis as intra-equity correlations climb, and for some
    //  mixes the denominator outpaces the Cov(p, ACWI) numerator, so β
    //  can compress slightly. The vol/TE invariants above are the right
    //  signature of "diversification benefit shrinks under stress".)
  });

  it("crisis regime worsens MC tail risk (CVaR99 strictly lower) at same seed", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Bonds", region: "Global", weight: 30 },
      { assetClass: "Real Estate (REITs)", region: "Global", weight: 10 },
    ];
    const opts = { paths: 4_000, seed: 42, baseCurrency: "CHF" as const };
    const normal = runMonteCarlo(allocation, 10, 100_000, { ...opts, riskRegime: "normal" });
    const crisis = runMonteCarlo(allocation, 10, 100_000, { ...opts, riskRegime: "crisis" });
    // Crisis fan widens ⇒ CVaR99 (mean of bottom 1 % final wealth) drops.
    expect(crisis.cvar99Final).toBeLessThan(normal.cvar99Final);
    // Median is approximately unchanged (drift dominates correlation).
    const medRel = Math.abs(crisis.finalP50 - normal.finalP50) / normal.finalP50;
    expect(medRel).toBeLessThan(0.05);
  });

  it("default riskRegime is 'normal' — backward compatible", async () => {
    const { computeMetrics } = await import("../src/lib/metrics");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Bonds", region: "Global", weight: 40 },
    ];
    const implicit = computeMetrics(allocation, "CHF");
    const explicit = computeMetrics(allocation, "CHF", undefined, false, "normal");
    expect(implicit.vol).toBeCloseTo(explicit.vol, 12);
    expect(implicit.beta).toBeCloseTo(explicit.beta, 12);
    expect(implicit.trackingError).toBeCloseTo(explicit.trackingError, 12);
  });
});

describe("Lieferung 2 — Student-t tail model", () => {
  it("Student-t (df=5) inflates CVaR99 vs Gauss at same seed and σ", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Bonds", region: "Global", weight: 40 },
    ];
    const opts = { paths: 6_000, seed: 7, baseCurrency: "CHF" as const };
    const gauss = runMonteCarlo(allocation, 15, 100_000, { ...opts, tailModel: "gauss" });
    const studentT = runMonteCarlo(allocation, 15, 100_000, { ...opts, tailModel: "studentT", studentTDf: 5 });
    // Heavy tails ⇒ deeper extreme losses.
    expect(studentT.cvar99Final).toBeLessThan(gauss.cvar99Final);
    // Median essentially unchanged — variance correction keeps σ matched.
    const medRel = Math.abs(studentT.finalP50 - gauss.finalP50) / gauss.finalP50;
    expect(medRel).toBeLessThan(0.06);
  });

  it("default tailModel is 'gauss' — backward compatible", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const opts = { paths: 2_000, seed: 999, baseCurrency: "CHF" as const };
    const implicit = runMonteCarlo(allocation, 10, 100_000, opts);
    const explicit = runMonteCarlo(allocation, 10, 100_000, { ...opts, tailModel: "gauss", riskRegime: "normal" });
    expect(implicit.finalP50).toBeCloseTo(explicit.finalP50, 6);
    expect(implicit.cvar99Final).toBeCloseTo(explicit.cvar99Final, 6);
    expect(implicit.cvar95Final).toBeCloseTo(explicit.cvar95Final, 6);
  });

  it("studentTDf is clamped into [3, 100]", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const opts = { paths: 1_500, seed: 11, baseCurrency: "CHF" as const, tailModel: "studentT" as const };
    // df=2 → clamped to 3 (variance of t-distribution undefined for df ≤ 2).
    // df=500 → clamped to 100 (effectively Gauss).
    const tooLow = runMonteCarlo(allocation, 5, 100_000, { ...opts, studentTDf: 2 });
    const atFloor = runMonteCarlo(allocation, 5, 100_000, { ...opts, studentTDf: 3 });
    const tooHigh = runMonteCarlo(allocation, 5, 100_000, { ...opts, studentTDf: 500 });
    const atCeil = runMonteCarlo(allocation, 5, 100_000, { ...opts, studentTDf: 100 });
    expect(tooLow.cvar99Final).toBeCloseTo(atFloor.cvar99Final, 6);
    expect(tooHigh.cvar99Final).toBeCloseTo(atCeil.cvar99Final, 6);
  });
});

describe("Lieferung 2 — Crisis-Σ × Student-t orthogonality", () => {
  it("stacking both worsens CVaR99 strictly more than either alone", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [
      { assetClass: "Equity", region: "USA", weight: 50 },
      { assetClass: "Equity", region: "Europe", weight: 20 },
      { assetClass: "Bonds", region: "Global", weight: 30 },
    ];
    const opts = { paths: 5_000, seed: 314, baseCurrency: "CHF" as const };
    const baseline = runMonteCarlo(allocation, 12, 100_000, opts);
    const crisisOnly = runMonteCarlo(allocation, 12, 100_000, { ...opts, riskRegime: "crisis" });
    const tOnly = runMonteCarlo(allocation, 12, 100_000, { ...opts, tailModel: "studentT", studentTDf: 5 });
    const both = runMonteCarlo(allocation, 12, 100_000, { ...opts, riskRegime: "crisis", tailModel: "studentT", studentTDf: 5 });
    // Each toggle alone is worse than baseline.
    expect(crisisOnly.cvar99Final).toBeLessThan(baseline.cvar99Final);
    expect(tOnly.cvar99Final).toBeLessThan(baseline.cvar99Final);
    // Both stacked is at least as bad as either alone.
    expect(both.cvar99Final).toBeLessThanOrEqual(crisisOnly.cvar99Final);
    expect(both.cvar99Final).toBeLessThanOrEqual(tOnly.cvar99Final);
  });
});

describe("Lieferung 2 — Student-t sampler statistical properties", () => {
  // Sampler-level guard: any future edit to the studentT() chi²
  // construction or variance correction should keep these invariants.
  // We can't import studentT directly (it's not exported), so we read
  // the empirical distribution of MC log-returns at H=1Y for a single
  // pure-equity sleeve, where the per-year shock IS the sampler output
  // (modulo a deterministic drift).
  it("Student-t empirical variance ≈ Gauss empirical variance across df ∈ {3,5,10,30}", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const opts = { paths: 20_000, seed: 2026, baseCurrency: "CHF" as const };
    // 1Y horizon ⇒ each path's final wealth = exp(μ - σ²/2 + σ·shock)·V0.
    // log(final/V0) = (μ - σ²/2) + σ·shock, so variance of log-return ≈ σ²
    // independent of tail model when the variance correction is right.
    const gauss = runMonteCarlo(allocation, 1, 100_000, { ...opts, tailModel: "gauss" });
    const dfs = [3, 5, 10, 30] as const;
    // Use the spread between P10 and P90 of final wealth as a proxy for σ —
    // in 1Y, this should be within ~10 % across df values. For Gauss the
    // P10/P90 ratio is exp(σ·1.282 - σ·(-1.282)) = exp(2.564·σ); for t-df
    // the ratio is slightly tighter at the inner percentiles (fatter tails
    // pull mass to the extremes, not the middle), so we allow ±15 %.
    const gaussRatio = gauss.finalP90 / gauss.finalP10;
    for (const df of dfs) {
      const t = runMonteCarlo(allocation, 1, 100_000, { ...opts, tailModel: "studentT", studentTDf: df });
      const tRatio = t.finalP90 / t.finalP10;
      const rel = Math.abs(tRatio - gaussRatio) / gaussRatio;
      expect(rel).toBeLessThan(0.15);
    }
  });

  it("Student-t produces strictly worse CVaR99 than Gauss for every df ∈ {3,5,10}", async () => {
    const { runMonteCarlo } = await import("../src/lib/monteCarlo");
    const allocation = [{ assetClass: "Equity", region: "USA", weight: 100 }];
    const opts = { paths: 8_000, seed: 99, baseCurrency: "CHF" as const };
    const gauss = runMonteCarlo(allocation, 10, 100_000, { ...opts, tailModel: "gauss" });
    for (const df of [3, 5, 10] as const) {
      const t = runMonteCarlo(allocation, 10, 100_000, { ...opts, tailModel: "studentT", studentTDf: df });
      // Heavier-than-Gauss tails ⇒ deeper CVaR99. Gap shrinks as df↑30.
      expect(t.cvar99Final).toBeLessThan(gauss.cvar99Final);
    }
  });
});

// ---------------------------------------------------------------------------
// Task #156 — listUnassignedInstruments
// ---------------------------------------------------------------------------
describe("listUnassignedInstruments", () => {
  it("returns only instruments whose role is 'unassigned'", () => {
    const rows = listUnassignedInstruments();
    for (const r of rows) {
      expect(getInstrumentRole(r.isin)).toBe("unassigned");
    }
  });

  it("is sorted alphabetically by name (stable order for the picker)", () => {
    const rows = listUnassignedInstruments();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].name.localeCompare(rows[i - 1].name)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never includes any default / alternative / pool ISIN", () => {
    const rows = listUnassignedInstruments();
    const isins = new Set(rows.map((r) => r.isin));
    for (const isin of isins) {
      const role = getInstrumentRole(isin);
      expect(role === "default" || role === "alternative" || role === "pool").toBe(false);
    }
  });
});

// ============================================================================
// Task #174 — Explain tab first-class Cash pseudo-group
// ============================================================================
//
// The Cash row in Explain is NOT a real catalog bucket. It is keyed by the
// sentinel `bucketKey === "Cash"` (`EXPLAIN_CASH_BUCKET_SENTINEL`) which is
// recognised by `resolveSleeve` and routed through the synthesizer the same
// way Build's first-class Cash slider feeds into portfolio.ts. These tests
// cover allocation contribution, validation exemption, and the legacy
// `manualMeta.assetClass === "Cash"` migration on workspace load.
import {
  synthesizePersonalPortfolio,
  runExplainValidation,
  EXPLAIN_CASH_BUCKET_SENTINEL,
  type PersonalPosition,
} from "../src/lib/personalPortfolio";
import { explainWorkspaceHasContent } from "../src/lib/explainCompare";

describe("Explain Cash sentinel (Task #174)", () => {
  it("synthesizer maps the Cash sentinel into a {Cash | <currency>} sleeve", () => {
    const positions: PersonalPosition[] = [
      { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 70 },
      {
        isin: "",
        bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
        weight: 30,
        cashCurrency: "EUR",
      },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD", "en");
    const cash = out.allocation.find((a) => a.assetClass === "Cash");
    expect(cash).toBeDefined();
    expect(cash!.region).toBe("EUR");
    expect(cash!.weight).toBe(30);
    // Cash row never produces an etfImplementation entry — there is no
    // ISIN and no manualMeta.
    const cashRows = out.etfImplementation.filter(
      (r) => r.assetClass === "Cash",
    );
    expect(cashRows.length).toBe(0);
  });

  it("Cash sentinel without explicit currency falls back to 'Global' region", () => {
    const positions: PersonalPosition[] = [
      { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 80 },
      { isin: "", bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL, weight: 20 },
    ];
    const out = synthesizePersonalPortfolio(positions, "CHF", "en");
    const cash = out.allocation.find((a) => a.assetClass === "Cash");
    expect(cash).toBeDefined();
    expect(cash!.region).toBe("Global");
  });

  it("validation does NOT raise 'Row has no ETF selected' for Cash sentinel rows", () => {
    const positions: PersonalPosition[] = [
      { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 50 },
      {
        isin: "",
        bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
        weight: 50,
        cashCurrency: "USD",
      },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD", "en");
    const noEtf = v.errors.find((e) =>
      /no ETF selected|ohne ausgewählten ETF/i.test(e.message),
    );
    expect(noEtf).toBeUndefined();
    // Sum is 100 and no per-row issues, so the workspace must validate.
    expect(v.isValid).toBe(true);
  });

  it("explainWorkspaceHasContent recognises a Cash-only workspace as non-empty", () => {
    expect(
      explainWorkspaceHasContent({
        v: 1,
        baseCurrency: "USD",
        riskAppetite: "Moderate",
        horizon: 10,
        hedged: false,
        lookThroughView: true,
        positions: [
          {
            isin: "",
            bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
            weight: 100,
            cashCurrency: "USD",
          },
        ],
      }),
    ).toBe(true);
  });

  it("Cash slice still counts toward the equity-cap denominator (no double-count)", () => {
    // 60% equity + 40% cash on a Moderate profile (cap 70%) → no warning.
    const v = runExplainValidation(
      [
        { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 60 },
        {
          isin: "",
          bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
          weight: 40,
          cashCurrency: "USD",
        },
      ],
      "Moderate",
      "USD",
      "en",
    );
    const overCap = v.warnings.find((w) =>
      /risk-asset weight|risiko-aktien-quote/i.test(w.message),
    );
    expect(overCap).toBeUndefined();
  });
});

describe("Explain Cash sentinel — handoff & migration (Task #174)", () => {
  it("explainWorkspaceToSlotPortfolio retains the Cash sentinel slice in the Compare slot allocation", async () => {
    const { explainWorkspaceToSlotPortfolio } = await import(
      "../src/lib/explainCompare"
    );
    const slot = explainWorkspaceToSlotPortfolio(
      {
        v: 1,
        baseCurrency: "USD",
        riskAppetite: "Moderate",
        horizon: 10,
        hedged: false,
        lookThroughView: true,
        positions: [
          { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 60 },
          {
            isin: "",
            bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
            weight: 40,
            cashCurrency: "EUR",
          },
        ],
      },
      "en",
    );
    const cash = slot.output.allocation.find((a) => a.assetClass === "Cash");
    expect(cash).toBeDefined();
    expect(cash!.weight).toBe(40);
    expect(cash!.region).toBe("EUR");
    // Cash never produces an etfImplementation row.
    expect(
      slot.output.etfImplementation.find((r) => r.assetClass === "Cash"),
    ).toBeUndefined();
  });

  it("explainWorkspaceToSlotPortfolio handles a Cash-only workspace (allocation has only Cash)", async () => {
    const { explainWorkspaceToSlotPortfolio } = await import(
      "../src/lib/explainCompare"
    );
    const slot = explainWorkspaceToSlotPortfolio(
      {
        v: 1,
        baseCurrency: "CHF",
        riskAppetite: "Low",
        horizon: 5,
        hedged: false,
        lookThroughView: true,
        positions: [
          {
            isin: "",
            bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
            weight: 100,
            cashCurrency: "CHF",
          },
        ],
      },
      "en",
    );
    expect(slot.output.allocation.length).toBe(1);
    expect(slot.output.allocation[0].assetClass).toBe("Cash");
    expect(slot.output.allocation[0].weight).toBe(100);
  });

  it("sanitizeWorkspace migrates legacy manual Cash entries (manualMeta.assetClass='Cash') into the sentinel form and carries cashCurrency over from manualMeta.currency", async () => {
    // Drive the sanitize path via the public listSavedExplainPortfolios
    // entry. Seed localStorage with a legacy-shaped workspace and assert
    // the loaded shape is the new sentinel form.
    const { listSavedExplainPortfolios } = await import(
      "../src/lib/savedExplainPortfolios"
    );
    const seeded = [
      {
        id: "legacy-cash-1",
        name: "Legacy Cash",
        createdAt: 1700000000000,
        workspace: {
          v: 1,
          baseCurrency: "USD",
          riskAppetite: "Moderate",
          horizon: 10,
          hedged: false,
          lookThroughView: true,
          positions: [
            {
              isin: "FAKE-CASH-ISIN",
              bucketKey: "",
              weight: 25,
              manualMeta: {
                assetClass: "Cash",
                region: "Global",
                currency: "EUR",
              },
            },
          ],
        },
      },
    ];
    // engine.test.ts runs in the node env (no jsdom), so stub a minimal
    // localStorage on globalThis.window for the duration of this test.
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    try {
      store.set(
        "investment-lab.savedExplainPortfolios.v1",
        JSON.stringify(seeded),
      );
      const loaded = listSavedExplainPortfolios();
      expect(loaded.length).toBe(1);
      const pos = loaded[0].workspace.positions[0];
      expect(pos.bucketKey).toBe("Cash");
      expect(pos.isin).toBe("");
      expect(pos.manualMeta).toBeUndefined();
      expect(pos.cashCurrency).toBe("EUR");
      expect(pos.weight).toBe(25);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

// ---------------------------------------------------------------------------
// Task #194 — Explain ISIN-picker sort order: Default → Alt 1..N (catalog
// slot order) → Pool (catalog insertion order) → Unassigned. Previously
// alphabetised within the same role, which silently re-ordered the
// curated alternatives.
// ---------------------------------------------------------------------------
describe("comparePickerRows — Explain picker sort order", () => {
  // Equity-USA's curated alternatives are intentionally non-alphabetical
  // by name (Vanguard / SPDR / UBS), so this bucket is a perfect fixture
  // for asserting that slot order — not name order — wins.
  const EQUITY_USA = "Equity-USA";
  const DEFAULT_ISIN = "IE00B5BMR087"; // iShares Core S&P 500
  const ALT1 = "IE00BFMXXD54"; // Vanguard S&P 500
  const ALT2 = "IE00B6YX5C33"; // SPDR S&P 500
  const ALT3 = "LU0136234654"; // UBS MSCI USA

  it("Equity-USA fixture exercises a real slot-vs-alphabetical mismatch", () => {
    // Sanity gate: if a catalog edit ever moves these ISINs out of
    // Equity-USA or re-orders the alternatives array, this test
    // becomes meaningless — fail loudly so the maintainer fixes it.
    expect(getInstrumentRole(DEFAULT_ISIN)).toBe("default");
    expect(getInstrumentRole(ALT1)).toBe("alternative");
    expect(getInstrumentRole(ALT2)).toBe("alternative");
    expect(getInstrumentRole(ALT3)).toBe("alternative");
    expect(getInstrumentAltIndex(ALT1)).toBe(1);
    expect(getInstrumentAltIndex(ALT2)).toBe(2);
    expect(getInstrumentAltIndex(ALT3)).toBe(3);
    const def = getCatalogEntry(EQUITY_USA)!;
    expect(def.isin).toBe(DEFAULT_ISIN);
  });

  it("orders default first, then alternatives by 1-based slot index, ignoring name", () => {
    // Names that would alphabetise as SPDR < UBS < Vanguard if the old
    // bug were still in place — slot order is V → S → U.
    const rows = [
      { isin: ALT3, name: "UBS MSCI USA UCITS ETF USD dis" },
      { isin: ALT2, name: "SPDR S&P 500 UCITS" },
      { isin: DEFAULT_ISIN, name: "iShares Core S&P 500 UCITS" },
      { isin: ALT1, name: "Vanguard S&P 500 UCITS" },
    ];
    rows.sort(comparePickerRows);
    expect(rows.map((r) => r.isin)).toEqual([
      DEFAULT_ISIN, // role rank 0
      ALT1, // alt 1
      ALT2, // alt 2
      ALT3, // alt 3
    ]);
  });

  it("orders pool entries by catalog insertion order regardless of input order", () => {
    // Equity-USA pool: ["IE0031442068", "IE00B6YX5D40", "IE00BD4TXW66"]
    // Sanity-check the catalog still matches the test's assumption.
    expect(getInstrumentPoolIndex("IE0031442068")).toBe(1);
    expect(getInstrumentPoolIndex("IE00B6YX5D40")).toBe(2);
    expect(getInstrumentPoolIndex("IE00BD4TXW66")).toBe(3);
    // Feed in REVERSE catalog order with names whose alphabetical
    // order is yet a third permutation — the comparator must use the
    // pool index, not stable-sort baseline and not the name.
    const rows = [
      { isin: "IE00BD4TXW66", name: "A-name-third-in-pool" },
      { isin: "IE00B6YX5D40", name: "Z-name-second-in-pool" },
      { isin: "IE0031442068", name: "M-name-first-in-pool" },
    ];
    for (const r of rows) {
      expect(getInstrumentRole(r.isin)).toBe("pool");
    }
    const sorted = [...rows].sort(comparePickerRows);
    expect(sorted.map((r) => r.isin)).toEqual([
      "IE0031442068",
      "IE00B6YX5D40",
      "IE00BD4TXW66",
    ]);
  });

  it("orders mixed roles default → alternative → pool", () => {
    const rows = [
      { isin: "IE00BD4TXW66", name: "pool entry" },
      { isin: ALT2, name: "SPDR S&P 500 UCITS" },
      { isin: DEFAULT_ISIN, name: "iShares Core S&P 500 UCITS" },
      { isin: ALT1, name: "Vanguard S&P 500 UCITS" },
    ];
    rows.sort(comparePickerRows);
    expect(rows.map((r) => getInstrumentRole(r.isin))).toEqual([
      "default",
      "alternative",
      "alternative",
      "pool",
    ]);
    expect(rows.map((r) => r.isin)).toEqual([
      DEFAULT_ISIN,
      ALT1,
      ALT2,
      "IE00BD4TXW66",
    ]);
  });
});
