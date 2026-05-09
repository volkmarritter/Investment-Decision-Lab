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
//
// Task #224 — extends the same contract to the other two surfaces by
// rendering the actual production components (BuildPortfolio's
// "Allocation by bucket" table and ComparePortfolios' "Structural
// Differences" table) with a stubbed `buildPortfolio` so we can pin
// the per-bucket ETF count deterministically without driving the full
// engine.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Hoisted fixtures used by the vi.mock factory below. Two outputs share
// the same blended bucket (Equity - USA, 2 ETFs) and a single-ETF bucket
// (Fixed Income - Global) so a single fixture exercises both the
// positive and negative cases on a single render. Outputs A and B for
// the Compare surface differ only by ISINs so each side computes a
// distinct count map (A: blended Equity-USA; B: blended Fixed-Income-
// Global) — that way the test can assert the per-side decoration in
// the structural-differences table independently.
const { buildOutput, compareOutputA, compareOutputB } = vi.hoisted(() => {
  type Row = {
    bucket: string;
    assetClass: string;
    weight: number;
    intent: string;
    exampleETF: string;
    rationale: string;
    isin: string;
    ticker: string;
    exchange: string;
    terBps: number;
    domicile: string;
    replication: "Physical" | "Synthetic";
    distribution: "Accumulating" | "Distributing";
    currency: string;
    comment: string;
    catalogKey: string | null;
    selectedSlot: number;
    selectableOptions: never[];
  };
  const row = (
    bucket: string,
    isin: string,
    weight: number,
    overrides: Partial<Row> = {},
  ): Row => ({
    bucket,
    assetClass: bucket.split(" - ")[0] ?? "",
    weight,
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
  });
  const allocation = [
    { assetClass: "Equity", region: "USA", weight: 60 },
    { assetClass: "Fixed Income", region: "Global", weight: 40 },
  ];
  const buildOutput = {
    allocation,
    etfImplementation: [
      row("Equity - USA", "IE00B5BMR087", 30),
      row("Equity - USA", "IE00BFMXXD54", 30),
      row("Fixed Income - Global", "IE00BDBRDM35", 40),
    ],
    rationale: [],
    risks: [],
    learning: [],
  };
  const compareOutputA = {
    allocation,
    etfImplementation: [
      row("Equity - USA", "IE00B5BMR087", 30),
      row("Equity - USA", "IE00BFMXXD54", 30),
      row("Fixed Income - Global", "IE00BDBRDM35", 40),
    ],
    rationale: [],
    risks: [],
    learning: [],
  };
  const compareOutputB = {
    allocation,
    etfImplementation: [
      row("Equity - USA", "IE00B3XXRP09", 60),
      row("Fixed Income - Global", "IE00BZ163L38", 20),
      row("Fixed Income - Global", "IE00B3VWN518", 20),
    ],
    rationale: [],
    risks: [],
    learning: [],
  };
  return { buildOutput, compareOutputA, compareOutputB };
});

// Stub `buildPortfolio` so BuildPortfolio's "Generate" click and
// ComparePortfolios' "Compare" click each return a deterministic output
// with the bucket-count distribution we need. computeNaturalBucketCount
// is exported alongside it and is called elsewhere in BuildPortfolio's
// reactive effects, so we pass it through to the real implementation.
vi.mock("@/lib/portfolio", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/portfolio")>("@/lib/portfolio");
  return {
    ...actual,
    buildPortfolio: vi.fn(
      (input: { targetEquityPct?: number }, _lang: unknown, _mw: unknown, picks?: unknown) => {
        // ComparePortfolios passes a 4th `picks` arg; BuildPortfolio does
        // not. For Build we always return `buildOutput`. For Compare we
        // discriminate the two slots by their (different) default
        // `targetEquityPct` — Slot A defaults to 50, Slot B to 90 — so
        // the per-slot output is stable across however many subscribe /
        // value-watcher calls Compare makes after the initial submit.
        if (picks === undefined) return buildOutput;
        return (input?.targetEquityPct ?? 0) >= 80 ? compareOutputB : compareOutputA;
      },
    ),
  };
});

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
import { BuildPortfolio } from "../src/components/investment/BuildPortfolio";
import { ComparePortfolios } from "../src/components/investment/ComparePortfolios";
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

// ---------------------------------------------------------------------------
// Task #224 — Build "Allocation by bucket" table + Compare "Structural
// Differences" table.
//
// These two surfaces render the badge inline (not via a sub-component
// like CurrentAllocationCard), so the Task #223 tests above don't cover
// them. We mount the actual production components here and rely on the
// `vi.mock("@/lib/portfolio")` factory at the top of this file to pin
// the per-bucket ETF count distribution. That means a refactor of the
// inline render in BuildPortfolio.tsx or ComparePortfolios.tsx that
// drops the badge — or wires the wrong testid / count — will fail this
// test, which is exactly the regression the task asks us to guard.
// ---------------------------------------------------------------------------
describe("BlendedBucketBadge — Task #224 (Build allocation table)", () => {
  function mountBuild() {
    return render(
      <LanguageProvider>
        <TooltipProvider>
          <BuildPortfolio />
        </TooltipProvider>
      </LanguageProvider>,
    );
  }

  it("renders the badge for the blended bucket (Equity - USA, 2 ETFs) after Generate", async () => {
    const { container } = mountBuild();

    // Submit the form directly via fireEvent.submit on the <form>
    // element. react-hook-form's handleSubmit is async (it runs
    // resolver-based validation in a microtask), so a plain
    // fireEvent.click on the submit button does NOT flush the
    // generate path inside a single act() boundary in jsdom. Wrapping
    // the submit + tick in an `await act(async ...)` makes the state
    // update from setOutput land before we query the DOM.
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form!);
      await Promise.resolve();
    });

    const blended = screen.getByTestId("build-blended-badge-Equity-USA");
    expect(blended.textContent).toContain("2 ETFs");
    const wrapper = blended.parentElement;
    expect(wrapper?.getAttribute("aria-label")).toBe(
      "Bucket blended from 2 ETFs",
    );

    // Single-ETF bucket — no badge.
    expect(
      screen.queryByTestId("build-blended-badge-Fixed Income-Global"),
    ).toBeNull();
  });
});

describe("BlendedBucketBadge — Task #224 (Compare structural-differences table)", () => {
  function mountCompare() {
    return render(
      <LanguageProvider>
        <TooltipProvider>
          <ComparePortfolios />
        </TooltipProvider>
      </LanguageProvider>,
    );
  }

  it("renders the per-side badges in the structural-differences table after Compare", async () => {
    const { container } = mountCompare();

    // Submit Compare's form directly (same async-handleSubmit reason as
    // the BuildPortfolio test above). The mocked buildPortfolio returns
    // compareOutputA for slot A's call and compareOutputB for slot B's
    // call (alternating discriminator in the mock factory). A's blended
    // bucket is Equity - USA (2 ETFs); B's blended bucket is Fixed
    // Income - Global (2 ETFs).
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form!);
      await Promise.resolve();
    });

    const aBlended = screen.getByTestId(
      "compare-blended-badge-A-Equity-USA",
    );
    expect(aBlended.textContent).toContain("2 ETFs");
    expect(aBlended.parentElement?.getAttribute("aria-label")).toBe(
      "Bucket blended from 2 ETFs",
    );

    const bBlended = screen.getByTestId(
      "compare-blended-badge-B-Fixed Income-Global",
    );
    expect(bBlended.textContent).toContain("2 ETFs");

    // Single-ETF buckets per side render no badge: A holds one
    // Fixed-Income-Global row, B holds one Equity-USA row.
    expect(
      screen.queryByTestId("compare-blended-badge-A-Fixed Income-Global"),
    ).toBeNull();
    expect(
      screen.queryByTestId("compare-blended-badge-B-Equity-USA"),
    ).toBeNull();
  });
});
