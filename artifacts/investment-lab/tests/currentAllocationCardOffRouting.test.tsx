// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// Task #294 — CurrentAllocationCard OFF-mode routing consistency.
//
// When Look-Through is OFF, Explain's "Current Allocation" donut + legend
// must route each user row through the shared region-only router
// (`mapAllocationToAssets`) so manual rows like "Equity - Asia Pacific
// ex-Japan" or "Equity - Other" land on the same CMA bucket the
// Look-Through ON path would pick. Without this fix the OFF-mode chart
// silently rendered raw row labels ("Equity - Asia Pacific ex-Japan"),
// while ON-mode rendered "Japan Equity" — contradicting Task #294's
// routing-consistency contract.
//
// The table below the chart still shows the user's raw row buckets
// verbatim (a deliberate UX rule the test also pins).
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { LanguageProvider } from "../src/lib/i18n";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { CurrentAllocationCard } from "../src/components/investment/CurrentAllocationCard";
import type { AssetAllocation } from "../src/lib/types";

beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (
    typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver ===
    "undefined"
  ) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver: unknown }).ResizeObserver =
      ResizeObserverStub;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      ResizeObserverStub;
  }
  window.localStorage.setItem("investment-lab.lang.v1", "en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderCard(allocation: AssetAllocation[]) {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <CurrentAllocationCard
          allocation={allocation}
          etfImplementation={[]}
          baseCurrency="USD"
          lookThroughView={false}
        />
      </TooltipProvider>
    </LanguageProvider>,
  );
}

describe("CurrentAllocationCard — OFF-mode CMA routing (Task #294)", () => {
  it("renders CMA bucket labels in the legend when Look-Through is OFF", () => {
    // Asia Pacific ex-Japan must land on Japan Equity, "Other" on
    // Other / Residual, and a sector label like "Technology" on
    // Thematic Equity — the same routing the Look-Through ON path
    // applies via mapAllocationToAssetsLookthrough's routeByRegion
    // fallback.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Asia Pacific ex-Japan", weight: 30 },
      { assetClass: "Equity", region: "Other", weight: 20 },
      { assetClass: "Equity", region: "Technology", weight: 10 },
      { assetClass: "Equity", region: "USA", weight: 40 },
    ];
    renderCard(allocation);

    const legend = screen.getByTestId("explain-current-allocation-legend");
    const text = legend.textContent ?? "";

    // CMA labels rendered (routed):
    expect(text).toContain("Japan Equity");
    expect(text).toContain("Other / Residual");
    expect(text).toContain("Thematic Equity");
    expect(text).toContain("US Equity");

    // Raw row labels NOT rendered in the chart legend (they only belong
    // in the per-row table below):
    expect(text).not.toContain("Asia Pacific ex-Japan");
    expect(text).not.toContain("Equity - Other");
    expect(text).not.toContain("Technology");
  });

  it("still shows the user's raw row labels verbatim in the per-row table below the chart", () => {
    // The table is a separate UX surface — it intentionally surfaces the
    // user's row-level labels (so they recognise what they typed),
    // independent of the donut/legend's CMA-routed view.
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Asia Pacific ex-Japan", weight: 50 },
      { assetClass: "Equity", region: "Other", weight: 50 },
    ];
    renderCard(allocation);

    const card = screen.getByTestId("explain-current-allocation");
    const table = card.querySelector("table");
    expect(table).toBeTruthy();
    const tableText = within(table as HTMLElement).getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .join("\n");
    expect(tableText).toContain("Asia Pacific ex-Japan");
    expect(tableText).toContain("Other");
  });

  it("localizes the residual bucket label to 'Sonstige / Rest' in DE", () => {
    window.localStorage.setItem("investment-lab.lang.v1", "de");
    const allocation: AssetAllocation[] = [
      { assetClass: "Equity", region: "Other", weight: 100 },
    ];
    renderCard(allocation);

    const legend = screen.getByTestId("explain-current-allocation-legend");
    expect(legend.textContent ?? "").toContain("Sonstige / Rest");
    expect(legend.textContent ?? "").not.toContain("Other / Residual");
  });
});
