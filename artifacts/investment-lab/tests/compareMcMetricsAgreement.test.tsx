// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// compareMcMetricsAgreement.test.tsx
// ----------------------------------------------------------------------------
// Compare-tab counterpart to mcMetricsAgreement.test.tsx (which pins the
// Build tab). Task #100 caught the Build-tab divergence between the Monte
// Carlo card and the Risk & Performance Metrics card; the Compare tab
// renders the SAME two cards per slot (Slot A and Slot B), wired through
// the same look-through gate inside ComparePortfolios.tsx, but had no
// equivalent test. A future refactor that touches Compare's prop wiring
// (e.g. drops `riskRegime` on one card, swaps slot A's
// `etfImplementation` into slot B's MC card, or forgets to gate one card
// on `inputX.lookThroughView`) would silently ship until a user noticed
// two side-by-side σ values disagreeing.
//
// To pin the actual Compare wiring (not a synthetic harness), this file
// renders the REAL `ComparePortfolios` component, drives it the way a
// user would (click "Compare Portfolios" to populate both slots, click
// the per-side look-through switch to flip routing, click the deep-dive
// mobile A/B tab to swap slots in view), and reads σ values straight
// out of the rendered Compare DOM. The deep-dive section's mobile
// layout already groups cards by type — `deepdive-mc-toggle` contains
// the MonteCarloSimulation for the active slot, `deepdive-risk-toggle`
// contains the PortfolioMetrics for the active slot — and Radix unmounts
// inactive tab content, so each `within(toggle)` lookup is naturally
// scoped to one card per slot at a time. (Both mobile and desktop
// markup are present in jsdom because there's no media-query
// enforcement, which is exactly why we MUST scope by testid rather than
// rely on screen-wide getByText.)
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { TooltipProvider } from "../src/components/ui/tooltip";
import { LanguageProvider } from "../src/lib/i18n";
import { ComparePortfolios } from "../src/components/investment/ComparePortfolios";
import {
  setLastBuildInput,
  setLastBuildManualWeights,
} from "../src/lib/settings";

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
  // Reset cross-tab in-memory channels so Compare mounts in a clean
  // "Build has never published" state — no link-to-Build side-effects to
  // pollute Slot A's form values mid-test (same pattern as
  // compareLinkTiming.test.tsx).
  setLastBuildInput(null);
  setLastBuildManualWeights(null);
  // Pin language so the label text we look up below is deterministic
  // ("Volatility" / "Expected Volatility", not the German equivalents),
  // and so the submit button's accessible name is "Compare Portfolios".
  window.localStorage.setItem("investment-lab.lang.v1", "en");
});

afterEach(() => {
  cleanup();
  setLastBuildInput(null);
  setLastBuildManualWeights(null);
});

function renderCompare() {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <ComparePortfolios />
      </TooltipProvider>
    </LanguageProvider>,
  );
}

// Compare's Slot B defaults are deliberately spicy (Very High risk, 90%
// equity, +Crypto, +Listed Real Estate, +Technology thematic tilt). On
// portfolios with that much asset-class granularity, the MC engine's
// 2,000-path empirical σ and the Metrics engine's analytical σ
// disagree by ~1-2pp purely from model-form differences (different
// handling of multi-bucket correlation / thematic over-weights), even
// though both consume the same allocation. Those gaps are NOT the
// wiring bugs this test is meant to catch (a wiring drop would cause
// 5pp+ swings or one card freezing on the wrong slot's value); they
// are real engine behaviour that the Build-tab counterpart sidesteps
// by feeding a hand-crafted two-bucket allocation
// `[Eq EU 70, FI Glob 30]`.
//
// To get the same "controlled inputs" property out of the real
// ComparePortfolios component (which doesn't accept a custom
// allocation, only form values), we simplify Slot B before submit:
// switch its risk appetite from "Very High" to "Low" (which the radio
// auto-syncs to a 20% equity target) and turn off the Crypto + Listed
// Real Estate toggles. This keeps Slot B materially DIFFERENT from
// Slot A (different equity target, different horizon, still has the
// thematic Tech tilt — but at 20% equity its impact on σ is small),
// so the cross-slot sanity check still bites, while bringing the per-
// slot MC↔Metrics gap inside the same 0.5pp tolerance the Build-tab
// test uses.
async function simplifySlotB(): Promise<void> {
  // Find the Card whose CardTitle reads "Portfolio B". The CardTitle
  // text is unique (only one Slot B form column on the page) and we
  // walk up to the nearest bordered container, which is the Card root.
  // Scoping all subsequent queries to this subtree is essential
  // because Slot A and Slot B render IDENTICAL form structures — a
  // bare `getByRole("radio", { name: "Low" })` would match BOTH
  // sides' Low radios and throw.
  const slotBTitle = screen.getByText("Portfolio B");
  const slotBCard = slotBTitle.closest('div[class*="border"]') as HTMLElement | null;
  if (!slotBCard) {
    throw new Error("Could not locate Slot B card container");
  }

  // Click "Low" in Slot B's Risk Appetite RadioGroup. The onValueChange
  // handler additionally jumps Slot B's targetEquityPct to 20 (the
  // canonical anchor for the Low band — see the map in
  // ComparePortfolios.tsx renderFormColumn), so this single radio
  // click reshapes the whole allocation toward a fixed-income-heavy
  // mix where MC and Metrics agree to within sampling noise.
  const lowRadio = within(slotBCard).getByRole("radio", { name: /^Low$/i });
  await act(async () => {
    fireEvent.click(lowRadio);
    await Promise.resolve();
  });

  // Toggle off "Listed Real Estate" and "Include Crypto" if currently
  // checked. The Switch markup is `<FormItem class="flex ..."> <label>
  // ... </label> <Switch role="switch" data-state="checked|unchecked" />
  // </FormItem>`, so we walk from the label text up to the FormItem
  // and pick the switch within. We guard on `data-state === "checked"`
  // so the helper is idempotent (re-running on an already-clean form
  // wouldn't accidentally re-enable them).
  const reSwitch = within(slotBCard)
    .getByText(/Listed Real Estate/i)
    .closest("[class*='flex']")
    ?.querySelector('[role="switch"]') as HTMLElement | null;
  const cryptoSwitch = within(slotBCard)
    .getByText(/Include Crypto/i)
    .closest("[class*='flex']")
    ?.querySelector('[role="switch"]') as HTMLElement | null;
  await act(async () => {
    if (reSwitch?.getAttribute("data-state") === "checked") {
      fireEvent.click(reSwitch);
    }
    if (cryptoSwitch?.getAttribute("data-state") === "checked") {
      fireEvent.click(cryptoSwitch);
    }
    await Promise.resolve();
  });
}

// Click the "Compare Portfolios" submit button that runs Compare's
// onSubmit handler — populating outputA / outputB / inputA / inputB
// using the form's current default values (CHF / Moderate / 50% equity
// for Slot A; CHF / Very High / 90% equity / +Crypto / +RealEstate for
// Slot B). Wrapped in async `act` because react-hook-form's
// handleSubmit returns a promise (it awaits validation before invoking
// onSubmit), so without flushing microtasks the deep-dive section
// `{inputA && inputB && ...}` is still gated off when our assertions
// run.
async function submitCompareForm(): Promise<void> {
  const submitBtn = screen.getByRole("button", { name: /compare portfolios/i });
  await act(async () => {
    fireEvent.click(submitBtn);
    // Two microtask flushes: one for handleSubmit's internal
    // validation promise, one for the resulting setState cascade.
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Click the per-side look-through Switch. The handler additionally
// re-runs `rebuildSide(prefix)` via `queueMicrotask`, which in turn
// updates `inputA` / `outputA` (the gating values both deep-dive cards
// read), so the post-click DOM reflects the new routing without a
// second submit. We wrap the click + flush in `act` so the microtask
// settles before the assertions read σ values.
async function clickLookThroughSwitch(side: "a" | "b"): Promise<void> {
  const sw = screen.getByTestId(`compare-${side}-lookthrough-switch`);
  await act(async () => {
    fireEvent.click(sw);
    // Flush the queueMicrotask deferral inside the toggle's onChange so
    // rebuildSide() lands before we re-read the cards.
    await Promise.resolve();
  });
}

// Inside the deep-dive mobile toggles, switch the active slot from "A"
// to "B". Each Tabs container has its own A/B TabsTrigger pair — we
// scope by the toggle's testid so flipping the MC toggle's tab does
// NOT also flip the Risk Metrics toggle's tab (the test asserts on
// each card type independently).
//
// Two non-obvious bits encoded here:
//   1. Radix UI's TabsTrigger only activates when it sees the full
//      production pointer sequence — `pointerDown` arms the value
//      change, `mouseDown` is what the trigger's React handler
//      actually toggles state on inside jsdom, and `click` finalises
//      activation / focus. Dispatching just `click` (or just
//      `pointerDown`) is a silent no-op: the tab state stays on the
//      previous value and the test would pass with two identical
//      readings off Slot A.
//   2. Even with the right event sequence, Radix unmounts the
//      previously active TabsContent and mounts the new one as a
//      state update, so we MUST flush the resulting React render with
//      an awaited `act` boundary before our σ-reading helpers run —
//      otherwise `within(toggle).getByText("Expected Volatility")`
//      will still find the OLD slot's label.
async function selectSlotInToggle(
  toggleTestId: string,
  slot: "A" | "B",
): Promise<void> {
  const toggle = screen.getByTestId(toggleTestId);
  const trigger = within(toggle).getByRole("tab", { name: `Portfolio ${slot}` });
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    // Flush React's commit phase so the new TabsContent mounts before
    // the next assertion runs.
    await Promise.resolve();
  });
}

// Locate the σ value rendered next to a given label inside its tile,
// scoped to a deep-dive Tabs container (`deepdive-mc-toggle` for the
// MC card or `deepdive-risk-toggle` for the Risk Metrics card). Both
// cards format σ as "X.XX%" and place the value as the next visible
// `div` sibling within the tile container, but the two cards use
// slightly different tile classes (`rounded-lg` for MetricTile,
// `rounded-md` for the MC ticker stat). We walk up to the nearest
// tile-shaped container, then pick the first child whose text exactly
// matches the percentage shape so the lookup doesn't accidentally pick
// up the tile's `sub` line ("p.a." / "stdev" — no `%`).
function readPercentInToggle(toggleTestId: string, labelText: string): number {
  const toggle = screen.getByTestId(toggleTestId);
  const label = within(toggle).getByText(labelText);
  const tile =
    label.closest("div.rounded-lg") ?? label.closest("div.rounded-md");
  if (!tile) {
    throw new Error(
      `Could not find a tile container for "${labelText}" inside ${toggleTestId}`,
    );
  }
  const valueEl = Array.from(tile.querySelectorAll("div")).find((el) =>
    /^-?\d+(?:\.\d{1,2})?%$/.test((el.textContent ?? "").trim()),
  );
  if (!valueEl) {
    throw new Error(
      `Could not find a %-value next to "${labelText}" inside ${toggleTestId}`,
    );
  }
  return parseFloat((valueEl.textContent ?? "").trim());
}

// Convenience: read both σ values for the slot that is currently
// selected in BOTH deep-dive toggles (selectSlotInToggle is called
// per-toggle, so the test must take care to have them in sync before
// invoking this).
function readSlotVols(): { mcVol: number; metricsVol: number } {
  return {
    mcVol: readPercentInToggle("deepdive-mc-toggle", "Expected Volatility"),
    metricsVol: readPercentInToggle("deepdive-risk-toggle", "Volatility"),
  };
}

describe("Compare tab: Monte Carlo ↔ Risk & Performance σ agreement per slot", () => {
  it("Look-Through ON for both slots: σ agrees within each slot independently", async () => {
    renderCompare();

    // Tame Slot B's defaults to a "Low" risk profile without crypto /
    // listed real estate so the agreement check operates on a portfolio
    // where the two engines naturally agree to within sampling noise
    // (see the comment on simplifySlotB above for why this matters).
    await simplifySlotB();

    // The "Compare Portfolios" submit button is the only thing standing
    // between the rendered form and the deep-dive section. A user who
    // never presses it never sees the cards, so neither does the test.
    await submitCompareForm();

    // Both slots default to lookThroughView=true (see defaultValues in
    // ComparePortfolios.tsx), so this single submit covers the ON path
    // for BOTH slots without any additional toggling.

    // Slot A is the default tab in both deep-dive toggles, so we can
    // read it straight away.
    const slotA = readSlotVols();

    // Sanity: each card's σ must be meaningfully > 0, otherwise the
    // agreement check is trivially satisfied (a future bug that zeros
    // out one card on both sides would still "agree").
    expect(slotA.mcVol).toBeGreaterThan(1);
    expect(slotA.metricsVol).toBeGreaterThan(1);

    // Per-slot agreement contract: within each slot, the MC card and
    // the Risk Metrics card both route through the same look-through
    // helper, so their on-screen σ values must agree to well within
    // display precision. 0.5pp leaves headroom for any future benign
    // rounding differences while still failing loudly if one card
    // silently bypasses the helper or is fed a stale prop.
    expect(Math.abs(slotA.mcVol - slotA.metricsVol)).toBeLessThan(0.5);

    // Switch BOTH deep-dive toggles to Slot B so we can read Slot B's
    // MC card and Slot B's Metrics card. Each toggle's TabsContent for
    // value="A" unmounts when value="B" becomes active (Radix default),
    // so we can keep using the same `within(toggle).getByText(...)`
    // lookup without ambiguity.
    await selectSlotInToggle("deepdive-mc-toggle", "B");
    await selectSlotInToggle("deepdive-risk-toggle", "B");

    const slotB = readSlotVols();

    expect(slotB.mcVol).toBeGreaterThan(1);
    expect(slotB.metricsVol).toBeGreaterThan(1);
    expect(Math.abs(slotB.mcVol - slotB.metricsVol)).toBeLessThan(0.5);

    // Cross-slot sanity: Slot A is the unmodified default (Moderate
    // risk, 50% equity, 10-year horizon) while Slot B has been
    // tamed to Low risk / 20% equity / no crypto / no real estate
    // (still 20-year horizon, still CHF, still Tech thematic). The
    // two allocations are still meaningfully different, so σ on the
    // two slots SHOULD differ — if they came out identical it would
    // mean one slot's props are silently leaking across, the exact
    // wiring bug this test guards against.
    expect(Math.abs(slotA.mcVol - slotB.mcVol)).toBeGreaterThan(0.5);
  });

  it("Look-Through OFF on Slot A: σ agreement on the OFF side still holds", async () => {
    renderCompare();

    // Same Slot B taming as the ON test — without it, Slot B's MC vs
    // Metrics naturally diverges by ~2pp on the spicy default
    // portfolio and would drown out the signal we're checking on the
    // OFF side.
    await simplifySlotB();

    // Generate first, THEN flip the look-through switch — that's the
    // production path: `rebuildSide()` is intentionally a no-op until
    // the slot has been generated at least once (see ComparePortfolios.tsx
    // around line 332), so toggling before pressing Compare just stages
    // the form value without surfacing it on the cards.
    await submitCompareForm();

    // Flip Slot A's look-through to OFF. The switch's onChange calls
    // `rebuildSide("portA")` via queueMicrotask, which re-runs
    // `buildPortfolio` for Slot A with the new lookThroughView=false
    // input. Both deep-dive Slot-A cards (MC + Risk Metrics) are
    // gated on `inputA.lookThroughView ? outputA.etfImplementation :
    // undefined`, so they BOTH switch to region-only routing in lock
    // step. Slot B is left ON, covering the asymmetric mixed state
    // Compare allows (each slot has its OWN per-slot toggle).
    await clickLookThroughSwitch("a");

    // Slot A is the default deep-dive tab, so we can read it without
    // changing toggles.
    const slotA = readSlotVols();

    expect(slotA.mcVol).toBeGreaterThan(1);
    expect(slotA.metricsVol).toBeGreaterThan(1);

    // The core OFF-side assertion: if a future refactor accidentally
    // dropped the look-through gate from one of Slot A's cards (e.g.
    // hard-coded `outputA.etfImplementation` on the MC side while
    // leaving the gate on the Risk Metrics side), only one card would
    // flip to region-only routing and the two σ values would diverge.
    expect(Math.abs(slotA.mcVol - slotA.metricsVol)).toBeLessThan(0.5);

    // Slot B is still ON — verify the wiring contract holds there too,
    // so we have one slot exercising each routing mode in this test.
    await selectSlotInToggle("deepdive-mc-toggle", "B");
    await selectSlotInToggle("deepdive-risk-toggle", "B");

    const slotB = readSlotVols();

    expect(slotB.mcVol).toBeGreaterThan(1);
    expect(slotB.metricsVol).toBeGreaterThan(1);
    expect(Math.abs(slotB.mcVol - slotB.metricsVol)).toBeLessThan(0.5);
  });
});
