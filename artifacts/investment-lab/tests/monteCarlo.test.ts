import { describe, expect, it } from "vitest";

import { runMonteCarlo } from "../src/lib/monteCarlo";
import {
  mapAllocationToAssets,
  mapAllocationToAssetsLookthrough,
  portfolioVol,
} from "../src/lib/metrics";
import { profileFor } from "../src/lib/lookthrough";
import type { AssetAllocation, ETFImplementation } from "../src/lib/types";

// Pin Task #89 — apply ETF look-through to the Monte Carlo engine. Three
// invariants this file locks in:
//
//   (a) When the caller passes an etfImplementation list, MC's headline
//       expectedVol agrees with the analytical Risk-&-Performance tile
//       (portfolioVol over the look-through exposures) for an
//       Equity-Europe row backed by a multi-country ETF (UK + CH + EU
//       continental countries) — i.e. the same number you read on screen.
//   (b) When the caller does NOT pass an etfImplementation list (or
//       passes []), every result field is byte-identical to the legacy
//       region-only path. This is the backward-compat contract the
//       three production call sites rely on when Look-Through is OFF.
//   (c) The legacy Equity-Global ACWI expansion is preserved on the
//       no-look-through path (a regression here would silently change
//       every default report).
//   (d) Equity-Home routes per base currency on BOTH paths (look-through
//       defers to the same helper metrics.ts uses, and the legacy path
//       collapses Home → home-currency equity_* bucket) — neither
//       silently drops to a generic equity bucket.

const baseEuropeETF: Omit<ETFImplementation, "weight" | "bucket"> = {
  assetClass: "Equity",
  intent: "",
  exampleETF: "iShares Core MSCI Europe UCITS",
  rationale: "",
  isin: "IE00B4K48X80",
  ticker: "",
  exchange: "",
  terBps: 12,
  domicile: "IE",
  replication: "Physical",
  distribution: "Accumulating",
  currency: "EUR",
  comment: "",
};

describe("runMonteCarlo — ETF look-through", () => {
  it("(a) Equity-Europe ETF: expectedVol matches the look-through portfolioVol the metrics tile uses", () => {
    // Sanity: this is the test profile (~23% UK + ~15% CH) — if the curated
    // weights ever drift to single-digits, the look-through math no longer
    // moves σ enough to be a meaningful test of routing changes.
    const profile = profileFor("IE00B4K48X80")!;
    expect(profile).toBeTruthy();
    const totalGeo = Object.values(profile.geo).reduce((s, v) => s + v, 0);
    expect((profile.geo["United Kingdom"] ?? 0) / totalGeo).toBeGreaterThan(0.05);
    expect((profile.geo["Switzerland"] ?? 0) / totalGeo).toBeGreaterThan(0.05);

    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Europe", weight: 100 },
    ];
    const etfImpl: ETFImplementation[] = [
      { ...baseEuropeETF, bucket: "Equity - Europe", weight: 100 },
    ];

    // hedged=false + syntheticUsEffective=false so MC's muSigmaForKey
    // returns CMA σ untouched — directly comparable to portfolioVol which
    // also reads CMA σ raw. (The hedged/syntheticUS knobs only affect the
    // mu side, or σ for non-home foreign equity; pinning them here keeps
    // the assertion a pure routing test.)
    const exposures = mapAllocationToAssetsLookthrough(allocation, etfImpl);
    const analyticalVol = portfolioVol(exposures);

    const mc = runMonteCarlo(allocation, 1, 100_000, {
      etfImplementation: etfImpl,
      hedged: false,
      baseCurrency: "USD",
      syntheticUsEffective: false,
    });

    // expectedVol is computed analytically inside runMonteCarlo from the
    // same covariance loop as portfolioVol — equality should be exact
    // (same σ inputs, same correlation matrix, same wᵀΣw).
    expect(mc.expectedVol).toBeCloseTo(analyticalVol, 10);

    // And distinctly different from the region-only routing — a full Europe
    // sleeve has a measurably different portfolio vol when split into
    // UK/CH/continental EU vs. all-equity_eu (otherwise look-through would
    // be a no-op and there'd be nothing to fix).
    const regionOnlyVol = portfolioVol(mapAllocationToAssets(allocation));
    expect(Math.abs(mc.expectedVol - regionOnlyVol)).toBeGreaterThan(1e-4);
  });

  it("(b) no etfImplementation supplied → byte-identical to the legacy region-only path", () => {
    // Backward-compat contract: every existing call site (and every
    // pre-task #89 test) calls runMonteCarlo without etfImplementation.
    // None of those readings may move when the look-through code path is
    // added. Compare a representative report with: missing arg vs.
    // explicit []; both must yield the same expectedReturn, expectedVol
    // and tail aggregates as the pre-existing legacy run.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 60 },
      { assetClass: "Equity", region: "Europe", weight: 15 },
      { assetClass: "Fixed Income", region: "Global", weight: 20 },
      { assetClass: "Commodities", region: "Gold", weight: 5 },
    ];

    const baseOpts = {
      hedged: false as const,
      baseCurrency: "USD" as const,
      syntheticUsEffective: false,
      seed: 42,
      paths: 500,
    };

    const legacy = runMonteCarlo(allocation, 5, 100_000, baseOpts);
    const explicitEmpty = runMonteCarlo(allocation, 5, 100_000, {
      ...baseOpts,
      etfImplementation: [],
    });

    expect(explicitEmpty.expectedReturn).toBeCloseTo(legacy.expectedReturn, 12);
    expect(explicitEmpty.expectedVol).toBeCloseTo(legacy.expectedVol, 12);
    expect(explicitEmpty.finalP10).toBeCloseTo(legacy.finalP10, 6);
    expect(explicitEmpty.finalP50).toBeCloseTo(legacy.finalP50, 6);
    expect(explicitEmpty.finalP90).toBeCloseTo(legacy.finalP90, 6);
    expect(explicitEmpty.cvar95Return).toBeCloseTo(legacy.cvar95Return, 10);
    expect(explicitEmpty.cvar99Return).toBeCloseTo(legacy.cvar99Return, 10);
    expect(explicitEmpty.realizedMddP05).toBeCloseTo(legacy.realizedMddP05, 10);
    expect(explicitEmpty.realizedMddP50).toBeCloseTo(legacy.realizedMddP50, 10);
  });

  it("(c) legacy path: Equity-Global ACWI expansion is preserved (and differs from a single-bucket Global)", () => {
    // The legacy region-only path expands an "Equity-Global" row across
    // the BENCHMARK regional weights so MC σₚ matches the analytical
    // metrics view. Pin this expansion: a 100% Equity-Global allocation
    // must NOT collapse to a single "global equity" bucket — and its σₚ
    // must equal the σₚ produced by manually splitting Global across
    // US / EU / UK / CH / JP / EM (= the analytical mapAllocationToAssets
    // expansion). A regression here would silently change every default
    // report whose user picked "Global" instead of typed-out regions.
    const global: AssetAllocation[] = [
      { assetClass: "Equity", region: "Global", weight: 100 },
    ];

    const mcGlobal = runMonteCarlo(global, 1, 100_000, {
      hedged: false,
      baseCurrency: "USD",
      syntheticUsEffective: false,
    });

    // The analytical helper (no look-through) already does the same
    // ACWI expansion, so portfolioVol over its output is the right
    // reference number for the legacy MC path.
    const expectedVol = portfolioVol(mapAllocationToAssets(global));
    expect(mcGlobal.expectedVol).toBeCloseTo(expectedVol, 10);

    // And: this is *not* the same number you'd get if Global collapsed
    // to a single bucket — pin the difference vs. e.g. a 100% USA proxy
    // so a future "simplification" that drops the BENCHMARK split fails
    // here loudly.
    const usaOnly: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 100 },
    ];
    const mcUsa = runMonteCarlo(usaOnly, 1, 100_000, {
      hedged: false,
      baseCurrency: "USD",
      syntheticUsEffective: false,
    });
    expect(Math.abs(mcGlobal.expectedVol - mcUsa.expectedVol)).toBeGreaterThan(1e-4);
  });

  it("(b2) etfImplementation supplied with an unknown ISIN (no curated profile) → routing equals legacy region path", () => {
    // Operator-spotted edge case worth pinning explicitly: a user can
    // type any ISIN into the override panel; only the curated subset has
    // a look-through profile. The look-through helper is documented to
    // fall back to per-row region routing when profileFor() returns null,
    // so passing such an etfImplementation list to MC must NOT change
    // the headline numbers vs the legacy run. If a future refactor
    // accidentally drops the fallback (e.g. silently zeroes the row), a
    // user with an exotic ETF would see σ collapse — this test fails
    // loudly in that case.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "USA", weight: 70 },
      { assetClass: "Equity", region: "Europe", weight: 20 },
      { assetClass: "Fixed Income", region: "Global", weight: 10 },
    ];
    // Sanity: confirm the ISIN we're using really has no curated profile
    // (otherwise the test would silently degrade into a look-through
    // routing test and miss the fallback path).
    const FAKE_ISIN = "XX0000000000";
    expect(profileFor(FAKE_ISIN)).toBeNull();

    const etfImpl: ETFImplementation[] = [
      { bucket: "Equity - USA", assetClass: "Equity", weight: 70, intent: "", exampleETF: "Made-up", rationale: "", isin: FAKE_ISIN, ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
      { bucket: "Equity - Europe", assetClass: "Equity", weight: 20, intent: "", exampleETF: "Made-up", rationale: "", isin: FAKE_ISIN, ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "EUR", comment: "" },
      { bucket: "Fixed Income - Global", assetClass: "Fixed Income", weight: 10, intent: "", exampleETF: "Made-up", rationale: "", isin: FAKE_ISIN, ticker: "", exchange: "", terBps: 7, domicile: "IE", replication: "Physical", distribution: "Accumulating", currency: "USD", comment: "" },
    ];

    const baseOpts = {
      hedged: false as const,
      baseCurrency: "USD" as const,
      syntheticUsEffective: false,
      seed: 42,
      paths: 500,
    };

    const legacy = runMonteCarlo(allocation, 5, 100_000, baseOpts);
    const lookthroughNoProfile = runMonteCarlo(allocation, 5, 100_000, {
      ...baseOpts,
      etfImplementation: etfImpl,
    });

    // No curated profile → look-through helper falls back to region
    // routing → MC produces the same σ, drift and tail aggregates as
    // the legacy run (modulo nothing — the analytical portfolioMu /
    // portfolioSigma are deterministic functions of the bucket weights).
    expect(lookthroughNoProfile.expectedReturn).toBeCloseTo(legacy.expectedReturn, 12);
    expect(lookthroughNoProfile.expectedVol).toBeCloseTo(legacy.expectedVol, 12);
    expect(lookthroughNoProfile.cvar95Return).toBeCloseTo(legacy.cvar95Return, 10);
    expect(lookthroughNoProfile.cvar99Return).toBeCloseTo(legacy.cvar99Return, 10);
    expect(lookthroughNoProfile.realizedMddP05).toBeCloseTo(legacy.realizedMddP05, 10);
  });

  it("(d) Equity-Home routes per base currency on both paths — CHF base ≠ USD base", () => {
    // Equity-Home is a magic region that should resolve to the home-
    // currency equity bucket (equity_ch for CHF, equity_us for USD, …).
    // The legacy MC path does this via bucketKey; the look-through path
    // defers to the metrics helper, which uses the same HOME_EQUITY_KEY
    // table. Both must respect baseCurrency — a regression here would
    // make a Swiss user's "Home equity" sleeve silently price like US
    // large-cap.
    const home: AssetAllocation[] = [
      { assetClass: "Equity", region: "Home", weight: 100 },
    ];

    // Legacy path (no etfImplementation).
    const mcChfLegacy = runMonteCarlo(home, 1, 100_000, {
      hedged: false,
      baseCurrency: "CHF",
      syntheticUsEffective: false,
    });
    const mcUsdLegacy = runMonteCarlo(home, 1, 100_000, {
      hedged: false,
      baseCurrency: "USD",
      syntheticUsEffective: false,
    });

    // CHF home (SMI/Swiss equity) and USD home (US large-cap) have
    // materially different CMA σ — if Equity-Home collapsed to a single
    // bucket regardless of baseCurrency, these two would be equal.
    expect(Math.abs(mcChfLegacy.expectedVol - mcUsdLegacy.expectedVol)).toBeGreaterThan(1e-4);

    // Look-through path (with an etfImplementation list) — same expectation.
    // We give Home a Swiss large-cap ETF for CHF and a US large-cap for USD
    // since the look-through helper falls back to the row's region routing
    // when no curated profile exists for the ISIN. Either way, the result
    // must depend on baseCurrency.
    const swissEtf: ETFImplementation = {
      bucket: "Equity - Home",
      assetClass: "Equity",
      weight: 100,
      intent: "",
      exampleETF: "iShares SLI",
      rationale: "",
      isin: "DE0005933964",
      ticker: "",
      exchange: "",
      terBps: 51,
      domicile: "DE",
      replication: "Physical",
      distribution: "Distributing",
      currency: "EUR",
      comment: "",
    };
    const usEtf: ETFImplementation = {
      bucket: "Equity - Home",
      assetClass: "Equity",
      weight: 100,
      intent: "",
      exampleETF: "iShares Core S&P 500",
      rationale: "",
      isin: "IE00B5BMR087",
      ticker: "",
      exchange: "",
      terBps: 7,
      domicile: "IE",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "",
    };

    const mcChfLT = runMonteCarlo(home, 1, 100_000, {
      etfImplementation: [swissEtf],
      hedged: false,
      baseCurrency: "CHF",
      syntheticUsEffective: false,
    });
    const mcUsdLT = runMonteCarlo(home, 1, 100_000, {
      etfImplementation: [usEtf],
      hedged: false,
      baseCurrency: "USD",
      syntheticUsEffective: false,
    });
    expect(Math.abs(mcChfLT.expectedVol - mcUsdLT.expectedVol)).toBeGreaterThan(1e-4);
  });
});
