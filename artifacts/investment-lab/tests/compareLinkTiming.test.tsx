// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// compareLinkTiming.test.tsx
// ----------------------------------------------------------------------------
// Locks in the Build → Compare Slot A auto-link timing fix.
//
// Compare and Build are mounted simultaneously by their parent <Tabs> via
// `forceMount`, which means Compare's useState() initializers run *before*
// Build's mount-time publish lands. Without the one-shot ref guard inside
// ComparePortfolios, Slot A would never auto-link on this initial-load path
// and the "Linked to Build" badge would not render until the user took
// further action.
//
// These tests render the real ComparePortfolios component (no extracted
// hook, no test-double) so the tests guard against regressions in the
// actual production code path: useState seeds + the bootstrap block in the
// subscribe-effect + the initialLinkPendingRef guard.
//
// Test #1 — "Compare opens first, Build publishes later — Slot A
//           auto-links once": the badge does not render until the first
//           publication, then the linked badge appears.
//
// Test #2 — "Repeated unlink → re-link cycles followed by Build edits":
//           after the user explicitly unlinks (or re-links), subsequent
//           Build publications must never surprise-flip the link state.
//           Re-linking is only ever user-initiated from that point on.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider } from "../src/lib/i18n";
import { ComparePortfolios } from "../src/components/investment/ComparePortfolios";
import {
  setLastBuildInput,
  setLastBuildManualWeights,
} from "../src/lib/settings";
import type { PortfolioInput } from "../src/lib/types";

// Minimal shim for a Radix-required pointer-capture API that jsdom does
// not implement. Same pattern as MaximisableSection.test.tsx, plus a
// ResizeObserver stub for downstream Radix Select / chart wrappers that
// observe their container even before the user has clicked Generate.
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
  // Reset cross-tab in-memory channels between tests so each scenario starts
  // from a clean "Build has never published" baseline. Compare's useState
  // initializers read these synchronously on mount, so resetting *before*
  // render is what makes the "Compare mounted before Build published" path
  // reproducible.
  setLastBuildInput(null);
  setLastBuildManualWeights(null);
  // Stable, predictable language so badge text assertions are deterministic.
  window.localStorage.setItem("investment-lab.lang.v1", "en");
});

afterEach(() => {
  cleanup();
  setLastBuildInput(null);
  setLastBuildManualWeights(null);
  vi.restoreAllMocks();
});

function mountCompare() {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <ComparePortfolios />
      </TooltipProvider>
    </LanguageProvider>,
  );
}

// Use the same baseCurrency the Compare form defaults to so that mirroring
// the published input back into the form does NOT churn the
// preferredExchange auto-sync effect (CHF → SIX is the default for both).
// Without this, the secondary effect would fire setValue("portA.preferredExchange",...)
// at a moment when syncingRef has already cleared, surprise-tripping the
// auto-pin watcher and inflating these tests' assertions with unrelated
// behaviour.
function makeBuildInput(overrides: Partial<PortfolioInput> = {}): PortfolioInput {
  return {
    baseCurrency: "CHF",
    riskAppetite: "Moderate",
    horizon: 10,
    targetEquityPct: 50,
    numETFs: 10,
    numETFsMin: 8,
    preferredExchange: "SIX",
    thematicPreference: "None",
    includeCurrencyHedging: false,
    includeSyntheticETFs: false,
    lookThroughView: false,
    includeCrypto: false,
    includeListedRealEstate: false,
    includeCommodities: true,
    ...overrides,
  };
}

describe("Compare Slot A — auto-link timing", () => {
  it("Compare opens first, Build publishes later — Slot A auto-links once", () => {
    // Build has not published. Compare mounts, useState initializers see
    // null and seed linked=false / hasBuildPublished=false. The link
    // controls (badge or re-link button) must NOT render in this state —
    // they're gated on hasBuildPublished, not just linked.
    mountCompare();
    expect(screen.queryByTestId("compare-slot-a-link-controls")).toBeNull();
    expect(screen.queryByTestId("compare-slot-a-linked-badge")).toBeNull();
    expect(screen.queryByTestId("compare-slot-a-relink-button")).toBeNull();

    // Build publishes for the first time AFTER Compare's effects ran. The
    // subscribe handler observes a non-null input, sees that
    // initialLinkPendingRef is still true, and flips both
    // hasBuildPublished and linked to true exactly once.
    act(() => {
      setLastBuildInput(makeBuildInput() as unknown as Record<string, unknown>);
    });

    expect(screen.getByTestId("compare-slot-a-link-controls")).toBeTruthy();
    expect(screen.getByTestId("compare-slot-a-linked-badge")).toBeTruthy();
    expect(screen.queryByTestId("compare-slot-a-relink-button")).toBeNull();

    // A second publication must not toggle anything — the one-shot
    // initialLinkPendingRef guard already cleared, and Slot A is already
    // linked. No exception, badge still shows.
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 60 }) as unknown as Record<string, unknown>,
      );
    });
    expect(screen.getByTestId("compare-slot-a-linked-badge")).toBeTruthy();
    expect(screen.queryByTestId("compare-slot-a-relink-button")).toBeNull();
  });

  it("repeated unlink → re-link cycles preserve the user-chosen state across Build edits", () => {
    mountCompare();

    // 1. Initial Build publication while Compare is mounted: auto-links.
    act(() => {
      setLastBuildInput(makeBuildInput() as unknown as Record<string, unknown>);
    });
    expect(screen.getByTestId("compare-slot-a-linked-badge")).toBeTruthy();

    // 2. User unlinks via the pin button. After this, the
    //    initialLinkPendingRef must be cleared so further Build
    //    publications never surprise-re-link.
    act(() => {
      fireEvent.click(screen.getByTestId("compare-slot-a-unpin-button"));
    });
    expect(screen.queryByTestId("compare-slot-a-linked-badge")).toBeNull();
    expect(screen.getByTestId("compare-slot-a-relink-button")).toBeTruthy();

    // 3. Build edits keep streaming through the channel. Slot A must
    //    stay unlinked — this is the regression we're guarding against.
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 65 }) as unknown as Record<string, unknown>,
      );
    });
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 70 }) as unknown as Record<string, unknown>,
      );
    });
    expect(screen.queryByTestId("compare-slot-a-linked-badge")).toBeNull();
    expect(screen.getByTestId("compare-slot-a-relink-button")).toBeTruthy();

    // 4. User explicitly re-links. Badge should come back.
    act(() => {
      fireEvent.click(screen.getByTestId("compare-slot-a-relink-button"));
    });
    expect(screen.getByTestId("compare-slot-a-linked-badge")).toBeTruthy();

    // 5. Build edits while linked: badge must stay (no toggle / no error).
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 75 }) as unknown as Record<string, unknown>,
      );
    });
    expect(screen.getByTestId("compare-slot-a-linked-badge")).toBeTruthy();

    // 6. User unlinks a second time, then more Build edits arrive. Same
    //    contract: stays unlinked.
    act(() => {
      fireEvent.click(screen.getByTestId("compare-slot-a-unpin-button"));
    });
    expect(screen.getByTestId("compare-slot-a-relink-button")).toBeTruthy();
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 80 }) as unknown as Record<string, unknown>,
      );
    });
    act(() => {
      setLastBuildInput(
        makeBuildInput({ targetEquityPct: 85 }) as unknown as Record<string, unknown>,
      );
    });
    expect(screen.queryByTestId("compare-slot-a-linked-badge")).toBeNull();
    expect(screen.getByTestId("compare-slot-a-relink-button")).toBeTruthy();
  });
});
