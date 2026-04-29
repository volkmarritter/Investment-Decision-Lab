// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// mcMetricsAgreement.test.tsx
// ----------------------------------------------------------------------------
// Higher-level UI agreement check on top of Task #89.
//
// Task #89 wired the Monte Carlo engine to the same look-through helper
// (`mapAllocationToAssetsLookthrough`) the Risk & Performance Metrics tile
// already uses, so the two cards now agree on σ / CVaR / Path-MDD when
// Look-Through is ON. The engine-level tests in monteCarlo.test.ts pin
// routing behaviour (look-through routing, no-arg backward-compat,
// Equity-Global expansion, Equity-Home routing).
//
// What's missing — and what THIS file adds — is an integration check at
// the rendered-DOM level: a future refactor that bypasses
// `mapAllocationToAssetsLookthrough` in one card but not the other (or
// passes a different `etfImplementation` / `riskRegime` / `baseCurrency`
// to one card but not the other) wouldn't be caught by the engine tests
// because each engine in isolation still computes a self-consistent σ.
// The bug only surfaces when the user reads the two on-screen σ values
// side by side and they disagree.
//
// This test renders BOTH cards through the same parent prop wiring
// `BuildPortfolio` uses (same `allocation`, same `baseCurrency`, same
// `hedged` / `includeSyntheticETFs`, the same `lookThroughView ?
// etfImpl : undefined` gating, and a lifted-up `riskRegime` shared
// between the two cards — Task #99). It then reads the σ value
// rendered inside each card and asserts they agree to within sampling
// noise (< 0.5pp).
//
// The wrapper deliberately stops short of mounting the full
// BuildPortfolio (form + auto-generation + a dozen unrelated tabs) so
// the test stays focused on the regression it guards against and is
// not coupled to the form's portfolio-generation heuristics — only to
// the prop-wiring boundary BuildPortfolio shares with both cards.
// ----------------------------------------------------------------------------

import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider } from "../src/lib/i18n";
import { MonteCarloSimulation } from "../src/components/investment/MonteCarloSimulation";
import { PortfolioMetrics } from "../src/components/investment/PortfolioMetrics";
import type {
  AssetAllocation,
  BaseCurrency,
  ETFImplementation,
} from "../src/lib/types";
import type { RiskRegime } from "../src/lib/metrics";

// jsdom shims used elsewhere in the suite (Radix popovers / Recharts'
// ResponsiveContainer observe their parents on first render even before
// the user interacts with them, so without these stubs the cards throw
// during mount).
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  // Pin language so the label text we look up below is deterministic
  // ("Volatility" / "Expected Volatility", not the German equivalents).
  window.localStorage.setItem("investment-lab.lang.v1", "en");
});

afterEach(() => {
  cleanup();
});

// Minimal parent that mirrors BuildPortfolio's wiring of these two cards:
//   - same `allocation` to both;
//   - same `baseCurrency`, `hedged`, `includeSyntheticETFs`;
//   - `etfImplementation` is gated on `lookThroughView` and passed to BOTH
//     cards as `etfProp` (so toggling the parent flag flips both at once);
//   - `riskRegime` is lifted up (controlled mode on both cards) so they
//     share the Crisis-Σ flip — same contract as Task #99.
function BothCards({
  allocation,
  etfImplementation,
  baseCurrency,
  lookThroughView,
  hedged,
  includeSyntheticETFs,
  initialRegime = "normal",
}: {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  baseCurrency: BaseCurrency;
  lookThroughView: boolean;
  hedged?: boolean;
  includeSyntheticETFs?: boolean;
  // Lets a single test render the pair under a non-default regime
  // (e.g. "crisis") without having to click the toggle. Mirrors how
  // BuildPortfolio would behave if the user had landed on the page
  // with the regime already flipped — same lifted-up wiring, just a
  // different starting value.
  initialRegime?: RiskRegime;
}) {
  const [riskRegime, setRiskRegime] = useState<RiskRegime>(initialRegime);
  const etfProp = lookThroughView ? etfImplementation : undefined;
  return (
    <>
      <MonteCarloSimulation
        allocation={allocation}
        horizonYears={10}
        baseCurrency={baseCurrency}
        hedged={hedged}
        includeSyntheticETFs={includeSyntheticETFs}
        etfImplementation={etfProp}
        riskRegime={riskRegime}
        onRiskRegimeChange={setRiskRegime}
      />
      <PortfolioMetrics
        allocation={allocation}
        baseCurrency={baseCurrency}
        etfImplementation={etfProp}
        includeSyntheticETFs={includeSyntheticETFs}
        hedged={hedged}
        riskRegime={riskRegime}
        onRiskRegimeChange={setRiskRegime}
      />
    </>
  );
}

function renderBothCards(props: React.ComponentProps<typeof BothCards>) {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <BothCards {...props} />
      </TooltipProvider>
    </LanguageProvider>,
  );
}

// Locate the σ value rendered next to a given label inside its tile.
// Both cards format σ as "X.XX%" and place the value as the next visible
// `div` sibling within the tile container — but the two cards use slightly
// different tile classes (`rounded-lg` for MetricTile, `rounded-md` for the
// MC ticker stat). We walk up to the nearest tile-shaped container, then
// pick the first child whose text exactly matches the percentage shape so
// the lookup doesn't accidentally pick up the tile's `sub` line ("p.a." /
// "stdev" — no `%`).
function readPercentByLabel(labelText: string): number {
  const label = screen.getByText(labelText);
  const tile =
    label.closest("div.rounded-lg") ?? label.closest("div.rounded-md");
  if (!tile) {
    throw new Error(`Could not find a tile container for label "${labelText}"`);
  }
  const valueEl = Array.from(tile.querySelectorAll("div")).find((el) =>
    /^-?\d+(?:\.\d{1,2})?%$/.test((el.textContent ?? "").trim()),
  );
  if (!valueEl) {
    throw new Error(`Could not find a %-value next to label "${labelText}"`);
  }
  return parseFloat((valueEl.textContent ?? "").trim());
}

// Multi-country Europe ETF used as the look-through fixture. Same ISIN the
// engine tests use; ~23% UK + ~15% CH means the look-through route shifts
// the Europe sleeve materially vs the region-only route, so this is a
// non-trivial test of the wiring (not just two zeros agreeing).
const europeETF: ETFImplementation = {
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
  bucket: "Equity - Europe",
  weight: 70,
};

// Europe-heavy mixed portfolio: 70% Equity-Europe + 30% Fixed-Income-Global.
// Mixing in a bond sleeve makes the σ test sensitive to the cross-asset
// covariance terms (not just the pure-equity diagonal), so a future bug
// that, say, drops bond rows from one card's exposure list while keeping
// them in the other would also fail this assertion.
const allocation: AssetAllocation[] = [
  { assetClass: "Equity", region: "Europe", weight: 70 },
  { assetClass: "Fixed Income", region: "Global", weight: 30 },
];

describe("Monte Carlo ↔ Risk & Performance σ agreement (UI integration)", () => {
  it("Look-Through ON: both cards show the same σ for a Europe-heavy mix", () => {
    renderBothCards({
      allocation,
      etfImplementation: [europeETF],
      baseCurrency: "USD",
      lookThroughView: true,
      hedged: false,
      includeSyntheticETFs: false,
    });

    const mcVol = readPercentByLabel("Expected Volatility");
    const metricsVol = readPercentByLabel("Volatility");

    // Sanity: the test only has teeth if σ is meaningfully > 0. A future
    // bug that zeros out one side would otherwise pass the agreement
    // check trivially.
    expect(mcVol).toBeGreaterThan(1);
    expect(metricsVol).toBeGreaterThan(1);

    // Agreement contract: both cards now route through the same look-
    // through helper, so the two on-screen σ values must agree to well
    // within display precision. 0.5pp leaves headroom for any future
    // benign rounding differences while still failing loudly if one card
    // silently bypasses the helper.
    expect(Math.abs(mcVol - metricsVol)).toBeLessThan(0.5);
  });

  it("Look-Through OFF: the legacy region-routing alignment also holds", () => {
    renderBothCards({
      allocation,
      etfImplementation: [europeETF],
      baseCurrency: "USD",
      lookThroughView: false,
      hedged: false,
      includeSyntheticETFs: false,
    });

    const mcVol = readPercentByLabel("Expected Volatility");
    const metricsVol = readPercentByLabel("Volatility");

    expect(mcVol).toBeGreaterThan(1);
    expect(metricsVol).toBeGreaterThan(1);
    expect(Math.abs(mcVol - metricsVol)).toBeLessThan(0.5);
  });

  // Task #107: Task #99 lifted the Crisis-Σ toggle up so both cards share
  // the same `riskRegime`. Task #100 (the two cases above) only pins σ
  // agreement under the default "normal" regime — a future refactor that
  // forgets to forward `riskRegime` to one of the two cards would still
  // pass those cases, while silently breaking the regime stakeholders
  // care about most. The case below renders the pair starting in
  // "crisis" mode and asserts (a) the two on-screen σ values still
  // agree, and (b) crisis σ has actually moved vs the normal baseline
  // — without (b) a no-op forward (e.g. hard-coded "normal" on one
  // side) would pass (a) trivially.
  it("Crisis-Σ regime: both cards still agree on σ, and σ actually moved vs normal", () => {
    // Crisis baseline: same wiring as the Look-Through ON case above,
    // but the shared lifted-up `riskRegime` starts at "crisis" so both
    // cards render through the crisis correlation matrix on first paint.
    const { unmount } = renderBothCards({
      allocation,
      etfImplementation: [europeETF],
      baseCurrency: "USD",
      lookThroughView: true,
      hedged: false,
      includeSyntheticETFs: false,
      initialRegime: "crisis",
    });

    const mcVolCrisis = readPercentByLabel("Expected Volatility");
    const metricsVolCrisis = readPercentByLabel("Volatility");

    // Sanity: only meaningful if σ > 0 on both sides.
    expect(mcVolCrisis).toBeGreaterThan(1);
    expect(metricsVolCrisis).toBeGreaterThan(1);

    // (a) Agreement contract under crisis: same < 0.5pp band as the
    // normal-regime cases. A future bug that forwards `riskRegime` to
    // one card but not the other would blow this open by several pp
    // (crisis correlations are materially higher across the equity
    // block + equity↔bonds, so a 70/30 mix moves visibly under crisis).
    expect(Math.abs(mcVolCrisis - metricsVolCrisis)).toBeLessThan(0.5);

    // Tear the crisis render down before mounting the normal baseline,
    // so the two renders don't share DOM state and `readPercentByLabel`
    // can't accidentally pick up the wrong tile.
    unmount();

    // Normal baseline for the same allocation + look-through wiring.
    renderBothCards({
      allocation,
      etfImplementation: [europeETF],
      baseCurrency: "USD",
      lookThroughView: true,
      hedged: false,
      includeSyntheticETFs: false,
      initialRegime: "normal",
    });

    const mcVolNormal = readPercentByLabel("Expected Volatility");
    const metricsVolNormal = readPercentByLabel("Volatility");

    expect(mcVolNormal).toBeGreaterThan(1);
    expect(metricsVolNormal).toBeGreaterThan(1);

    // (b) The test only has teeth if flipping the regime actually moves
    // σ. A no-op forward (e.g. one card pins regime to "normal"
    // internally) would make crisis ≈ normal on that side, which would
    // either fail (a) above (the OTHER card still moves) or — if BOTH
    // cards regressed to "normal" — would fail HERE because crisis
    // would equal normal. Equity-Europe sleeves move ~1pp+ between
    // regimes on this 70/30 mix; 0.5pp is a comfortable lower bound
    // that's well above sampling noise on the MC side.
    expect(mcVolCrisis - mcVolNormal).toBeGreaterThan(0.5);
    expect(metricsVolCrisis - metricsVolNormal).toBeGreaterThan(0.5);
  });
});
