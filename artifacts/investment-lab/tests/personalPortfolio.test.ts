
import { describe, it, expect } from "vitest";
import {
  synthesizePersonalPortfolio,
  runExplainValidation,
  normalizeWeights,
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
