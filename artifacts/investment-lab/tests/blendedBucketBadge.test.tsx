// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// blendedBucketBadge.test.tsx
// ----------------------------------------------------------------------------
// Task #223 — regression test for the blended-bucket badge introduced in
// Task #222. The badge appears next to allocation rows whose bucket
// holds 2+ ETFs (Build, Explain's CurrentAllocationCard, Compare's
// structural-differences table). We pin the contract:
//
//   1. When two ETFs share the same bucket, the badge renders for that
//      row with the correct count and tooltip text — verified in BOTH
//      EN and DE.
//   2. When every bucket holds exactly one ETF, no badge renders.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// We mock the Tooltip primitives so the TooltipContent is always rendered
// inline (not in a Portal, not gated on open state). This lets us assert
// the actual i18n tooltip text deterministically without driving Radix's
// pointer/focus state machine inside jsdom (which is unreliable here —
// see prior attempts with fireEvent.pointerEnter / userEvent.hover).
vi.mock("@/components/ui/tooltip", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const trigger = ({
    children,
  }: {
    children?: React.ReactNode;
    asChild?: boolean;
  }) => React.createElement(React.Fragment, null, children);
  return {
    TooltipProvider: passthrough,
    Tooltip: passthrough,
    TooltipTrigger: trigger,
    TooltipContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        "div",
        { "data-testid": "mock-tooltip-content" },
        children,
      ),
  };
});

import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider, t as translate } from "../src/lib/i18n";
import { CurrentAllocationCard } from "../src/components/investment/CurrentAllocationCard";
import type {
  AssetAllocation,
  ETFImplementation,
} from "../src/lib/types";

// jsdom shims used elsewhere in the suite (Recharts' ResponsiveContainer
// and Radix tooltip touch ResizeObserver / pointer-capture APIs that
// jsdom doesn't ship).
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
  window.localStorage.setItem("investment-lab.lang.v1", "en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function makeEtf(
  bucket: string,
  isin: string,
  overrides: Partial<ETFImplementation> = {},
): ETFImplementation {
  return {
    bucket,
    assetClass: bucket.split(" - ")[0] ?? "",
    weight: 50,
    intent: "",
    exampleETF: `Example ${isin}`,
    rationale: "",
    isin,
    ticker: "",
    exchange: "",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
    ...overrides,
  };
}

function renderCard(
  allocation: AssetAllocation[],
  etfs: ETFImplementation[],
) {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <CurrentAllocationCard
          allocation={allocation}
          etfImplementation={etfs}
          baseCurrency="USD"
          lookThroughView={false}
        />
      </TooltipProvider>
    </LanguageProvider>,
  );
}

describe("BlendedBucketBadge — Task #223", () => {
  const allocation: AssetAllocation[] = [
    { assetClass: "Equity", region: "USA", weight: 60 },
    { assetClass: "Fixed Income", region: "Global", weight: 40 },
  ];

  it("renders the badge with the correct count, aria, and EN tooltip for a blended bucket", () => {
    const etfs = [
      makeEtf("Equity - USA", "IE00B5BMR087"),
      makeEtf("Equity - USA", "IE00BFMXXD54"),
      makeEtf("Fixed Income - Global", "IE00BDBRDM35"),
    ];

    renderCard(allocation, etfs);

    const badge = screen.getByTestId("explain-blended-badge-Equity-USA");
    expect(badge.textContent).toContain("2 ETFs");

    const wrapper = badge.parentElement;
    expect(wrapper?.getAttribute("aria-label")).toBe(
      "Bucket blended from 2 ETFs",
    );

    const expectedEn = translate("en", "blendedBucket.tooltip").replace(
      "{count}",
      "2",
    );
    expect(screen.getByText(expectedEn)).toBeTruthy();

    expect(
      screen.queryByTestId("explain-blended-badge-Fixed Income-Global"),
    ).toBeNull();
  });

  it("renders the German tooltip + aria when locale is DE", () => {
    window.localStorage.setItem("investment-lab.lang.v1", "de");

    const etfs = [
      makeEtf("Equity - USA", "IE00B5BMR087"),
      makeEtf("Equity - USA", "IE00BFMXXD54"),
      makeEtf("Fixed Income - Global", "IE00BDBRDM35"),
    ];

    renderCard(allocation, etfs);

    const badge = screen.getByTestId("explain-blended-badge-Equity-USA");
    expect(badge.textContent).toContain("2 ETFs");

    const wrapper = badge.parentElement;
    expect(wrapper?.getAttribute("aria-label")).toBe(
      "Bucket gemischt aus 2 ETFs",
    );

    const expectedDe = translate("de", "blendedBucket.tooltip").replace(
      "{count}",
      "2",
    );
    expect(screen.getByText(expectedDe)).toBeTruthy();
  });

  it("renders no badge when every bucket holds exactly one ETF", () => {
    const etfs = [
      makeEtf("Equity - USA", "IE00B5BMR087"),
      makeEtf("Fixed Income - Global", "IE00BDBRDM35"),
    ];

    renderCard(allocation, etfs);

    expect(
      screen.queryByTestId("explain-blended-badge-Equity-USA"),
    ).toBeNull();
    expect(
      screen.queryByTestId("explain-blended-badge-Fixed Income-Global"),
    ).toBeNull();
    expect(screen.queryAllByTestId(/^explain-blended-badge-/).length).toBe(0);
  });
});
