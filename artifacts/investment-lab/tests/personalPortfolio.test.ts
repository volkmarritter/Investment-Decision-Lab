
import { describe, it, expect } from "vitest";
import {
  synthesizePersonalPortfolio,
  runExplainValidation,
  normalizeManualRegion,
  normalizeWeights,
  assetClassNeedsRegion,
  NO_REGION_ASSET_CLASSES,
  type PersonalPosition,
} from "@/lib/personalPortfolio";
import {
  ALL_BUCKET_KEYS,
  getBucketKeyForIsin,
  getBucketMeta,
  getInstrumentByIsin,
  listInstruments,
} from "@/lib/etfs";

const ISIN_USA = "IE00B5BMR087"; // Equity-USA       (Equity, North America)
const ISIN_USA_HEDGED_EUR = "IE00B3ZW0K18"; // Equity-USA-EUR (hedged)
const ISIN_EUROPE = "IE00B4K48X80"; // Equity-Europe   (Equity, Europe)
const ISIN_FI_GLOBAL = "IE00B3F81409"; // FixedIncome-Global (Fixed Income, Global)

describe("synthesizePersonalPortfolio", () => {
  it("groups multiple ETFs in the same bucket into one allocation row", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 30 },
      { isin: "IE00BFMXXD54", bucketKey: "Equity-USA", weight: 20 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 50 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    expect(out.allocation).toHaveLength(2);
    const usaRow = out.allocation.find(
      (r) => r.assetClass === "Equity" && r.region === "USA",
    );
    expect(usaRow).toBeDefined();
    expect(usaRow!.weight).toBe(50); // 30 + 20 summed into the USA bucket
    expect(out.etfImplementation).toHaveLength(3);
    const usaEtfs = out.etfImplementation.filter((e) => e.assetClass === "Equity");
    expect(usaEtfs.map((e) => e.weight).sort()).toEqual([20, 30]);
    expect(out.totalWeight).toBe(100);
  });

  it("sorts allocation by canonical asset-class order (FI before Equity)", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 60 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 40 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    expect(out.allocation.map((r) => r.assetClass)).toEqual([
      "Fixed Income",
      "Equity",
    ]);
  });

  it("drops zero/negative-weight positions silently", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 100 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 0 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    expect(out.allocation).toHaveLength(1);
    expect(out.etfImplementation).toHaveLength(1);
    expect(out.totalWeight).toBe(100);
  });

  it("populates ETFImplementation rows with full instrument metadata", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 100 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    const row = out.etfImplementation[0];
    const inst = getInstrumentByIsin(ISIN_USA)!;
    expect(row.isin).toBe(ISIN_USA);
    expect(row.terBps).toBe(inst.terBps);
    expect(row.currency).toBe(inst.currency);
    expect(row.replication).toBe(inst.replication);
    expect(row.exampleETF).toBe(inst.name);
    expect(row.catalogKey).toBe("Equity-USA");
    expect(row.selectableOptions).toEqual([]); // no per-bucket alternatives in Explain
  });

  it("emits German rationale text when lang=de", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 100 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD", "de");
    expect(out.etfImplementation[0].intent).toMatch(/Selbst gewählter/);
  });
});

describe("runExplainValidation", () => {
  it("flags weights that don't sum to 100% as a hard error", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 60 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 30 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(v.isValid).toBe(false);
    expect(v.errors.some((e) => /sum/i.test(e.message) || /not 100/i.test(e.message))).toBe(true);
  });

  it("accepts a valid 100%-sum portfolio with no warnings or errors", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 60 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 40 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(v.errors).toEqual([]);
    expect(v.isValid).toBe(true);
  });

  it("flags duplicate ISIN as an error", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 50 },
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 50 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(v.isValid).toBe(false);
    expect(v.errors.some((e) => /Duplicate ISIN/i.test(e.message))).toBe(true);
  });

  it("flags per-row weight outside (0, 100] as an error", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 150 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(v.errors.some((e) => /Invalid weight/i.test(e.message))).toBe(true);
  });

  it("treats an empty portfolio as a soft warning, not an error", () => {
    const v = runExplainValidation([], "Moderate", "USD");
    expect(v.errors).toEqual([]);
    expect(v.isValid).toBe(false); // still blocks analysis
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it("warns when equity slightly exceeds the risk-profile cap (Low cap=40)", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 50 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 50 },
    ];
    const v = runExplainValidation(positions, "Low", "USD");
    expect(v.warnings.some((w) => /above the 40% guideline/i.test(w.message))).toBe(true);
    expect(v.isValid).toBe(true); // soft warning, not error
  });

  it("errors when equity grossly exceeds the risk-profile cap (Low + 100% equity)", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 100 },
    ];
    const v = runExplainValidation(positions, "Low", "USD");
    expect(v.errors.some((e) => /significantly exceeds/i.test(e.message))).toBe(true);
    expect(v.isValid).toBe(false);
  });

  it("warns when both hedged and unhedged variants of the same sleeve are present", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 30 },
      { isin: ISIN_USA_HEDGED_EUR, bucketKey: "Equity-USA-EUR", weight: 30 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 40 },
    ];
    const v = runExplainValidation(positions, "Moderate", "EUR");
    expect(v.warnings.some((w) => /hedged and unhedged/i.test(w.message))).toBe(true);
  });

  it("warns when the persisted bucketKey no longer matches the live catalog", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-Europe", weight: 100 }, // wrong bucket
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(
      v.warnings.some((w) => /moved in the catalog|no longer registered/i.test(w.message)),
    ).toBe(true);
  });

  it("errors when the bucketKey is not in the live BUCKETS table", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "ThisBucketDoesNotExist", weight: 100 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    expect(v.errors.some((e) => /Unknown bucket/i.test(e.message))).toBe(true);
  });

  it("renders German error messages when lang=de", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 60 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD", "de");
    expect(v.errors.some((e) => /Summe der Gewichte/i.test(e.message))).toBe(true);
  });
});

describe("ISIN ↔ bucket inverse map (etfs.ts accessors)", () => {
  it("every catalog ISIN resolves to exactly one bucket", () => {
    const all = listInstruments();
    expect(all.length).toBeGreaterThan(0);
    for (const inst of all) {
      const bk = getBucketKeyForIsin(inst.isin);
      expect(bk).toBeDefined();
      expect(ALL_BUCKET_KEYS).toContain(bk!);
      expect(inst.bucketKey).toBe(bk);
    }
  });

  it("getBucketMeta decodes hedged/synthetic suffixes correctly", () => {
    const usa = getBucketMeta("Equity-USA")!;
    expect(usa.assetClass).toBe("Equity");
    expect(usa.region).toBe("USA");
    expect(usa.hedged).toBe(false);
    expect(usa.synthetic).toBe(false);

    const usaEur = getBucketMeta("Equity-USA-EUR")!;
    expect(usaEur.assetClass).toBe("Equity");
    expect(usaEur.region).toBe("USA");
    expect(usaEur.hedged).toBe(true);
    expect(usaEur.hedgeCurrency).toBe("EUR");

    // The unhedged base bucket has no hedge currency.
    expect(usa.hedgeCurrency).toBeUndefined();

    // CHF / GBP variants populate hedgeCurrency too — these are the labels
    // that disambiguate the three "USA (hedged)" rows in the Explain tree.
    const usaChf = getBucketMeta("Equity-USA-CHF")!;
    expect(usaChf.hedged).toBe(true);
    expect(usaChf.hedgeCurrency).toBe("CHF");
    const usaGbp = getBucketMeta("Equity-USA-GBP")!;
    expect(usaGbp.hedged).toBe(true);
    expect(usaGbp.hedgeCurrency).toBe("GBP");

    const usaSyn = getBucketMeta("Equity-USA-Synthetic")!;
    expect(usaSyn.synthetic).toBe(true);
    expect(usaSyn.assetClass).toBe("Equity");
    expect(usaSyn.region).toBe("USA");
    expect(usaSyn.hedgeCurrency).toBeUndefined();

    const fi = getBucketMeta("FixedIncome-Global")!;
    expect(fi.assetClass).toBe("Fixed Income");
  });

  it("getInstrumentByIsin returns undefined for unknown ISIN", () => {
    expect(getInstrumentByIsin("XX0000000000")).toBeUndefined();
    expect(getBucketKeyForIsin("XX0000000000")).toBeUndefined();
    expect(getBucketMeta("ThisBucketDoesNotExist")).toBeUndefined();
  });

  it("ALL_BUCKET_KEYS is non-empty and matches BUCKETS via getBucketMeta", () => {
    expect(ALL_BUCKET_KEYS.length).toBeGreaterThan(10);
    for (const k of ALL_BUCKET_KEYS) {
      expect(getBucketMeta(k)).toBeDefined();
    }
  });
});

describe("Explain integration: synthesizer + validator agree on sums", () => {
  it("validator sum matches synthesizer total for a clean portfolio", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 35.5 },
      { isin: ISIN_EUROPE, bucketKey: "Equity-Europe", weight: 24.5 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 40.0 },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    const out = synthesizePersonalPortfolio(positions, "USD");
    expect(v.isValid).toBe(true);
    expect(out.totalWeight).toBe(100);
  });
});


describe("normalizeManualRegion (Task #286 — legacy region label upgrade)", () => {
  it("rewrites 'Emerging Markets' → 'EM'", () => {
    expect(normalizeManualRegion("Emerging Markets")).toBe("EM");
  });
  it("rewrites 'United Kingdom' → 'UK'", () => {
    expect(normalizeManualRegion("United Kingdom")).toBe("UK");
  });
  it("passes through new canonical labels unchanged", () => {
    for (const r of ["EM", "UK", "USA", "Europe", "Switzerland", "Japan", "Global", "Technology", "Healthcare", "Sustainability", "Cybersecurity", "Other", "Thematic", "Asia Pacific ex-Japan"]) {
      expect(normalizeManualRegion(r)).toBe(r);
    }
  });
});

describe("normalizeWeights", () => {
  it("scales positions whose weights sum to <100% up to exactly 100%", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 30 },
      { isin: ISIN_EUROPE, bucketKey: "Equity-Europe", weight: 20 },
    ];
    const out = normalizeWeights(positions);
    const sum = out.reduce((a, p) => a + p.weight, 0);
    expect(sum).toBe(100);
    const usa = out.find((p) => p.isin === ISIN_USA)!;
    const eur = out.find((p) => p.isin === ISIN_EUROPE)!;
    expect(usa.weight).toBeCloseTo(60, 1);
    expect(eur.weight).toBeCloseTo(40, 1);
  });

  it("scales positions whose weights sum to >100% down to exactly 100%", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 80 },
      { isin: ISIN_EUROPE, bucketKey: "Equity-Europe", weight: 80 },
    ];
    const out = normalizeWeights(positions);
    const sum = out.reduce((a, p) => a + p.weight, 0);
    expect(sum).toBe(100);
    expect(out[0].weight).toBeCloseTo(50, 1);
    expect(out[1].weight).toBeCloseTo(50, 1);
  });

  it("absorbs rounding residual into the largest position", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 50 },
      { isin: ISIN_EUROPE, bucketKey: "Equity-Europe", weight: 25 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 25 },
    ];
    const out = normalizeWeights(positions);
    const sum = out.reduce((a, p) => a + p.weight, 0);
    expect(Math.round(sum * 10) / 10).toBe(100);
    const max = Math.max(...out.map((p) => p.weight));
    expect(out.find((p) => p.isin === ISIN_USA)!.weight).toBe(max);
  });

  it("returns inputs unchanged when total is zero (cannot scale from 0)", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 0 },
      { isin: ISIN_EUROPE, bucketKey: "Equity-Europe", weight: 0 },
    ];
    const out = normalizeWeights(positions);
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.weight === 0)).toBe(true);
  });

  it("preserves manualMeta on normalised positions", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 30 },
      {
        isin: "LU0000000000",
        bucketKey: "",
        weight: 30,
        manualMeta: { assetClass: "Real Estate", region: "Europe" },
      },
    ];
    const out = normalizeWeights(positions);
    const manual = out.find((p) => p.isin === "LU0000000000")!;
    expect(manual.manualMeta?.assetClass).toBe("Real Estate");
    expect(manual.manualMeta?.region).toBe("Europe");
  });
});


describe("Manual-entry positions (manualMeta override)", () => {
  it("synthesizer aggregates manual rows by sleeve (assetClass+region)", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 60 },
      {
        isin: "LU9999999999",
        bucketKey: "",
        weight: 40,
        manualMeta: { assetClass: "Real Estate", region: "Europe" },
      },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    expect(out.totalWeight).toBe(100);
    expect(out.allocation).toHaveLength(2);
    const re = out.allocation.find((r) => r.assetClass === "Real Estate");
    expect(re).toBeDefined();
    expect(re?.region).toBe("Europe");
    expect(re?.weight).toBe(40);
    const impl = out.etfImplementation.find((r) => r.isin === "LU9999999999");
    expect(impl).toBeDefined();
    expect(impl?.assetClass).toBe("Real Estate");
  });

  // Task #270 — off-catalog manual rows must not silently land at
  // 0.0 bps in the Fee Estimator. The synthesizer now resolves the
  // ETFImplementation row's `terBps` via a precedence chain:
  //   manualMeta.terBps  →  caller-supplied terLookup(isin)  →
  //   getETFTer(assetClass, region)
  // The historical bug surfaced as Blended TER and Annual Fee
  // collapsing to ~0 whenever an Explain row had no Quick-fill TER.
  it("Task #270 — falls back to terLookup then asset-class default for manual rows", () => {
    const isinNoTer = "LU2700000001";
    const isinWithLookup = "LU2700000002";
    const isinExplicit = "LU2700000003";
    const positions: PersonalPosition[] = [
      {
        isin: isinNoTer,
        bucketKey: "",
        weight: 33,
        manualMeta: { assetClass: "Equity", region: "USA" },
      },
      {
        isin: isinWithLookup,
        bucketKey: "",
        weight: 33,
        manualMeta: { assetClass: "Equity", region: "USA" },
      },
      {
        isin: isinExplicit,
        bucketKey: "",
        weight: 34,
        manualMeta: { assetClass: "Equity", region: "USA", terBps: 17 },
      },
    ];
    const lookup = (isin: string): number | undefined =>
      isin === isinWithLookup ? 9 : undefined;
    const out = synthesizePersonalPortfolio(positions, "USD", "en", lookup);
    const noTerRow = out.etfImplementation.find((r) => r.isin === isinNoTer)!;
    const lookupRow = out.etfImplementation.find(
      (r) => r.isin === isinWithLookup,
    )!;
    const explicitRow = out.etfImplementation.find(
      (r) => r.isin === isinExplicit,
    )!;
    // No manualMeta.terBps + no lookup hit → asset-class default
    // (Equity/USA from getETFTer, currently > 0). Critically NOT 0.
    expect(noTerRow.terBps).toBeGreaterThan(0);
    // Cache lookup wins when manualMeta.terBps is absent.
    expect(lookupRow.terBps).toBe(9);
    // Operator-typed manualMeta.terBps wins over the lookup.
    expect(explicitRow.terBps).toBe(17);
    // Task #271 — each manual row carries a terSource discriminator
    // mirroring the precedence step that produced the bps value, so the
    // Fee Estimator can render a per-row "operator / justETF / default"
    // badge without re-deriving the chain in the UI.
    expect(noTerRow.terSource).toBe("default");
    expect(lookupRow.terSource).toBe("justetf");
    expect(explicitRow.terSource).toBe("operator");
  });

  // Task #271 — catalog rows (real instrument lookup) must NOT receive a
  // terSource: the Build/Compare flow consumes the same ETFImplementation
  // shape and would start showing badges for curated rows otherwise. Only
  // off-catalog manual rows are tagged.
  it("Task #271 — catalog rows leave terSource undefined", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 100 },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    const row = out.etfImplementation.find((r) => r.isin === ISIN_USA)!;
    expect(row.terSource).toBeUndefined();
  });

  it("validator does not flag manual rows as unknown bucket", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 30 },
      { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 50 },
      {
        isin: "LU9999999999",
        bucketKey: "",
        weight: 20,
        manualMeta: { assetClass: "Real Estate", region: "Europe" },
      },
    ];
    const v = runExplainValidation(positions, "Moderate", "USD");
    const unknown = [...v.errors, ...v.warnings].find((s) =>
      /unknown bucket|unbekannter bucket|no longer registered|nicht mehr im katalog/i.test(
        s.message,
      ),
    );
    expect(unknown).toBeUndefined();
    expect(v.isValid).toBe(true);
  });

  it("normalises region to 'Global' for region-less manual asset classes (Commodities, Cash, Digital Assets)", () => {
    // Legacy saved files / pre-UI-change manualMeta blobs may carry a
    // non-"Global" region value for asset classes where geography
    // carries no signal. The sleeve resolver must collapse those to
    // "Global" so sleeve grouping and exports stay consistent —
    // matching the UI which now hides the Region selector entirely
    // for these asset classes.
    const positions: PersonalPosition[] = [
      { isin: "IE000000GOLD", bucketKey: "", weight: 40,
        manualMeta: { assetClass: "Commodities", region: "Europe" } },
      { isin: "IE000000CASH", bucketKey: "", weight: 30,
        manualMeta: { assetClass: "Cash", region: "USA" } },
      { isin: "IE0000CRYPTO", bucketKey: "", weight: 30,
        manualMeta: { assetClass: "Digital Assets", region: "Japan" } },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    const regionsByClass = new Map(
      out.allocation.map((r) => [r.assetClass, r.region]),
    );
    expect(regionsByClass.get("Commodities")).toBe("Global");
    expect(regionsByClass.get("Cash")).toBe("Global");
    expect(regionsByClass.get("Digital Assets")).toBe("Global");
    // Implementation-table buckets must follow the normalised label.
    const goldImpl = out.etfImplementation.find((r) => r.isin === "IE000000GOLD");
    expect(goldImpl?.bucket).toBe("Commodities - Global");
  });

  // Task #247 — Fixed Income was removed from this list (moved into
  // NO_REGION_ASSET_CLASSES) because monteCarlo.ts:bucketKey() collapses
  // every FI sleeve to a single `bonds` CMA bucket regardless of region.
  // The dedicated FI-collapse cases below pin the new behaviour.
  it("preserves region for region-bearing manual asset classes (Equity, Real Estate)", () => {
    const positions: PersonalPosition[] = [
      { isin: "IE0000EQ_USA", bucketKey: "", weight: 70,
        manualMeta: { assetClass: "Equity", region: "USA" } },
      { isin: "IE0000RE_JPN", bucketKey: "", weight: 30,
        manualMeta: { assetClass: "Real Estate", region: "Japan" } },
    ];
    const out = synthesizePersonalPortfolio(positions, "USD");
    const regionsByClass = new Map(
      out.allocation.map((r) => [r.assetClass, r.region]),
    );
    expect(regionsByClass.get("Equity")).toBe("USA");
    expect(regionsByClass.get("Real Estate")).toBe("Japan");
  });

  // Task #247 — manual Fixed Income rows: the Region selector is hidden
  // in the UI and `resolveSleeve` collapses any stored region (legacy
  // saved files, pasted imports) to "Global" so the allocation row, ETF
  // Implementation `bucket` label and downstream Compare key are all
  // consistent — no more "Fixed Income / Switzerland" vs "Fixed Income
  // / USA" duplicates that compute identically because monteCarlo.ts
  // collapses every FI region to the single `bonds` CMA bucket.
  describe("Task #247 — Fixed Income manual rows collapse region to Global", () => {
    it("Fixed Income is in NO_REGION_ASSET_CLASSES (assetClassNeedsRegion === false)", () => {
      expect(NO_REGION_ASSET_CLASSES.has("Fixed Income")).toBe(true);
      expect(assetClassNeedsRegion("Fixed Income")).toBe(false);
      // Sanity: the other region-less classes stay in the set, and
      // region-bearing classes (Equity, Real Estate) stay out of it.
      expect(assetClassNeedsRegion("Commodities")).toBe(false);
      expect(assetClassNeedsRegion("Cash")).toBe(false);
      expect(assetClassNeedsRegion("Digital Assets")).toBe(false);
      expect(assetClassNeedsRegion("Equity")).toBe(true);
      expect(assetClassNeedsRegion("Real Estate")).toBe(true);
    });

    it("synthesize: a manual FI row with stored region 'Switzerland' produces a single 'Fixed Income - Global' allocation+impl row", () => {
      const positions: PersonalPosition[] = [
        {
          isin: "LU0000000999",
          bucketKey: "",
          weight: 100,
          manualMeta: { assetClass: "Fixed Income", region: "Switzerland" },
        },
      ];
      const out = synthesizePersonalPortfolio(positions, "USD");
      expect(out.allocation).toHaveLength(1);
      expect(out.allocation[0]).toMatchObject({
        assetClass: "Fixed Income",
        region: "Global",
        weight: 100,
      });
      expect(out.etfImplementation).toHaveLength(1);
      expect(out.etfImplementation[0].bucket).toBe("Fixed Income - Global");
    });

    it("synthesize: two manual FI rows with different stored regions collapse into ONE 'Fixed Income - Global' sleeve (no duplicates)", () => {
      const positions: PersonalPosition[] = [
        {
          isin: "LU0000000111",
          bucketKey: "",
          weight: 40,
          manualMeta: { assetClass: "Fixed Income", region: "USA" },
        },
        {
          isin: "LU0000000222",
          bucketKey: "",
          weight: 60,
          manualMeta: { assetClass: "Fixed Income", region: "Switzerland" },
        },
      ];
      const out = synthesizePersonalPortfolio(positions, "USD");
      const fiRows = out.allocation.filter((r) => r.assetClass === "Fixed Income");
      expect(fiRows).toHaveLength(1);
      expect(fiRows[0].region).toBe("Global");
      expect(fiRows[0].weight).toBe(100);
      // Both ETF impl rows share the same bucket label.
      const buckets = out.etfImplementation
        .filter((e) => e.assetClass === "Fixed Income")
        .map((e) => e.bucket);
      expect(buckets).toEqual(["Fixed Income - Global", "Fixed Income - Global"]);
    });

    it("synthesize: catalog FI buckets are unaffected (region from getBucketMeta wins)", () => {
      const positions: PersonalPosition[] = [
        { isin: ISIN_FI_GLOBAL, bucketKey: "FixedIncome-Global", weight: 100 },
      ];
      const out = synthesizePersonalPortfolio(positions, "USD");
      expect(out.allocation).toHaveLength(1);
      // The catalog bucket's declared region (Global for the global agg
      // bond) is preserved — this branch goes through getBucketMeta,
      // not the manualMeta resolver.
      expect(out.allocation[0].assetClass).toBe("Fixed Income");
      expect(out.allocation[0].region).toBe("Global");
    });
  });

  it("validator skips hedging-coherence checks for manual rows", () => {
    const positions: PersonalPosition[] = [
      { isin: ISIN_USA_HEDGED_EUR, bucketKey: "Equity-USA-EUR", weight: 50 },
      {
        isin: "LU0000000001",
        bucketKey: "",
        weight: 50,
        manualMeta: { assetClass: "Equity", region: "USA" },
      },
    ];
    const v = runExplainValidation(positions, "Moderate", "EUR");
    const hedgingMsg = v.warnings.find((m) =>
      /hedg|absich/i.test(m),
    );
    expect(hedgingMsg).toBeUndefined();
  });
});
