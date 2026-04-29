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
}: {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  baseCurrency: BaseCurrency;
  lookThroughView: boolean;
  hedged?: boolean;
  includeSyntheticETFs?: boolean;
}) {
  const [riskRegime, setRiskRegime] = useState<RiskRegime>("normal");
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
});
