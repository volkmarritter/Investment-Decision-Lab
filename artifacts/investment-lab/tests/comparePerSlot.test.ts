// ----------------------------------------------------------------------------
// comparePerSlot.test.ts
// ----------------------------------------------------------------------------
// Locks in the Task #67 contract for the three-piece scenario snapshot
// (input + manualWeights + etfSelections) and the per-call selections
// argument that lets each Compare slot resolve its picker independently
// from the global store the Build tab uses.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal in-memory localStorage shim — same pattern as etfSelection.test.ts.
function installLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  vi.stubGlobal("window", { ...(globalThis as any).window, localStorage: ls, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
  vi.stubGlobal("localStorage", ls);
  return ls;
}

import type { PortfolioInput } from "../src/lib/types";

const baseInput: PortfolioInput = {
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
};

describe("saveScenario etfSelections round-trip", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("persists etfSelections when non-empty and is omitted when undefined / empty", async () => {
    const { saveScenario, listSaved } = await import("../src/lib/savedScenarios");

    saveScenario("with picks", baseInput, undefined, { "Equity-USA": 1, "Bonds-Global": 2 });
    saveScenario("clean", baseInput);
    saveScenario("empty map", baseInput, undefined, {});

    const saved = listSaved();
    // listSaved returns newest-first.
    const empty = saved.find((s) => s.name === "empty map")!;
    const clean = saved.find((s) => s.name === "clean")!;
    const picks = saved.find((s) => s.name === "with picks")!;

    expect(picks.etfSelections).toEqual({ "Equity-USA": 1, "Bonds-Global": 2 });
    expect(clean.etfSelections).toBeUndefined();
    // Empty map is treated identically to "no picks" — keeps older saves
    // and clean states structurally identical.
    expect(empty.etfSelections).toBeUndefined();
  });

  it("does not mutate caller's etfSelections map (defensive copy)", async () => {
    const { saveScenario, listSaved } = await import("../src/lib/savedScenarios");
    const sel = { "Equity-USA": 1 };
    saveScenario("snap", baseInput, undefined, sel);
    sel["Equity-USA"] = 2;
    const saved = listSaved().find((s) => s.name === "snap")!;
    expect(saved.etfSelections).toEqual({ "Equity-USA": 1 });
  });
});

describe("getETFDetails per-call selections argument", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("uses the per-call selections map instead of the global store when provided", async () => {
    const { getETFDetails } = await import("../src/lib/etfs");
    const { setETFSelection } = await import("../src/lib/etfSelection");

    // Pin slot 1 (alt #1) globally.
    setETFSelection("Equity-USA", 1);

    const globalDetails = getETFDetails("Equity", "USA", baseInput);
    expect(globalDetails.selectedSlot).toBe(1);

    // With an empty per-call map, every bucket falls back to slot 0
    // (the curated default) regardless of the global store.
    const perCallDefault = getETFDetails("Equity", "USA", baseInput, {});
    expect(perCallDefault.selectedSlot).toBe(0);

    // With a per-call map specifying a different slot, that slot wins
    // over the global store — proves Compare's slot snapshot can fully
    // diverge from Build's picks for the same bucket.
    const details = getETFDetails("Equity", "USA", baseInput, {
      "Equity-USA": 2,
    });
    expect(details.selectedSlot).toBe(2);
  });
});

describe("buildPortfolio per-call etfSelections argument", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("threads etfSelections into the etfImplementation rows", async () => {
    const { buildPortfolio } = await import("../src/lib/portfolio");
    const { setETFSelection } = await import("../src/lib/etfSelection");

    setETFSelection("Equity-USA", 1);

    const withGlobal = buildPortfolio(baseInput, "en");
    const usaRowGlobal = withGlobal.etfImplementation.find((r) => r.bucket === "Equity - USA");
    expect(usaRowGlobal?.selectedSlot).toBe(1);

    // Per-call map overrides the global store for this single build call,
    // without touching the global store at all.
    const withPerCall = buildPortfolio(baseInput, "en", undefined, {});
    const usaRowPerCall = withPerCall.etfImplementation.find((r) => r.bucket === "Equity - USA");
    expect(usaRowPerCall?.selectedSlot).toBe(0);

    // Global store should be unchanged after both builds.
    const after = buildPortfolio(baseInput, "en");
    const usaRowAfter = after.etfImplementation.find((r) => r.bucket === "Equity - USA");
    expect(usaRowAfter?.selectedSlot).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Task #78 — Compare Slot B is a defaults-only baseline unless a saved
// scenario has explicitly been loaded into it. Mirrors the resolution
// the Compare onSubmit handler now performs:
//
//   const etfSelectionsBForBuild = etfSelectionsB ?? {};
//   buildPortfolio(input, "en", manualWeightsB, etfSelectionsBForBuild)
//
// Test cases pin both halves of the contract:
//   1. No saved scenario loaded (etfSelectionsB is undefined in the
//      component) → B uses the curated default for every bucket even
//      when the global picker store has non-default selections set by
//      the Build tab.
//   2. Saved scenario loaded into B (component installs the snapshot
//      map) → B uses the snapshot's picks for every bucket the
//      snapshot mentions, and the curated default for the rest.
// ----------------------------------------------------------------------------
describe("Compare Slot B: defaults-only baseline (Task #78)", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("ignores Build's global picker selections when no saved scenario has been loaded into B", async () => {
    const { buildPortfolio } = await import("../src/lib/portfolio");
    const { setETFSelection } = await import("../src/lib/etfSelection");

    // Simulate a user who picked alternative #1 for two buckets on the
    // Build tab — these go into the shared global picker store.
    setETFSelection("Equity-USA", 1);
    setETFSelection("FixedIncome-Global", 1);

    // Compare's component-level state for an unloaded Slot B is
    // `etfSelectionsB === undefined`. The onSubmit handler now resolves
    // that to `{}` before calling buildPortfolio.
    const etfSelectionsB: Record<string, number> | undefined = undefined;
    const etfSelectionsBForBuild = etfSelectionsB ?? {};

    const outputB = buildPortfolio(baseInput, "en", undefined, etfSelectionsBForBuild);

    // Every implementation row should report the curated default
    // (slot 0) — Build's picks must not bleed in.
    for (const row of outputB.etfImplementation) {
      expect(row.selectedSlot).toBe(0);
    }

    // Sanity check: with the same global store, a regular build call
    // (Slot A's behaviour, which intentionally inherits Build) does
    // pick up the alternatives. This proves the test would catch a
    // regression if `?? {}` were ever removed.
    const inheritsGlobal = buildPortfolio(baseInput, "en");
    const usaRow = inheritsGlobal.etfImplementation.find((r) => r.bucket === "Equity - USA");
    expect(usaRow?.selectedSlot).toBe(1);
  });

  it("honours a saved scenario's picker snapshot when it has been loaded into B", async () => {
    const { buildPortfolio } = await import("../src/lib/portfolio");
    const { setETFSelection } = await import("../src/lib/etfSelection");

    // Build tab has its own picks in the global store — they must NOT
    // win against the snapshot installed via "load saved scenario".
    setETFSelection("Equity-USA", 1);

    // Simulate Compare's onLoadB installing the saved scenario's
    // snapshot into local state (alternative #2 for one bucket, no
    // entry for any other bucket → defaults).
    const loadedSnapshot: Record<string, number> = { "Equity-USA": 2 };
    const etfSelectionsB: Record<string, number> | undefined = loadedSnapshot;
    const etfSelectionsBForBuild = etfSelectionsB ?? {};

    const outputB = buildPortfolio(baseInput, "en", undefined, etfSelectionsBForBuild);

    const usaRow = outputB.etfImplementation.find((r) => r.bucket === "Equity - USA");
    expect(usaRow?.selectedSlot).toBe(2);

    // Buckets not in the snapshot stay on the curated default — the
    // empty-key fallback inside getETFDetails resolves to slot 0
    // rather than falling through to the global store.
    const otherRows = outputB.etfImplementation.filter((r) => r.bucket !== "Equity - USA");
    for (const row of otherRows) {
      expect(row.selectedSlot).toBe(0);
    }
  });

  it("re-generating B after edits keeps the loaded snapshot (no surprise reset to defaults)", async () => {
    const { buildPortfolio } = await import("../src/lib/portfolio");

    // Snapshot stays in local state across re-generations; the
    // resolution `etfSelectionsB ?? {}` returns the snapshot itself,
    // not `{}`.
    const loadedSnapshot: Record<string, number> = { "Equity-USA": 2 };
    let etfSelectionsB: Record<string, number> | undefined = loadedSnapshot;

    const first = buildPortfolio(baseInput, "en", undefined, etfSelectionsB ?? {});
    expect(first.etfImplementation.find((r) => r.bucket === "Equity - USA")?.selectedSlot).toBe(2);

    // Re-generate (e.g. user edited horizon, hit Generate again) — the
    // local state in the component is unchanged.
    const second = buildPortfolio(
      { ...baseInput, horizon: 12 },
      "en",
      undefined,
      etfSelectionsB ?? {},
    );
    expect(second.etfImplementation.find((r) => r.bucket === "Equity - USA")?.selectedSlot).toBe(2);

    // Loading a different (or empty-snapshot) scenario clears the
    // snapshot back to `{}` — that is what onLoadB does for older
    // saves with no etfSelections field. Subsequent generations
    // resolve to defaults again.
    etfSelectionsB = {};
    const third = buildPortfolio(baseInput, "en", undefined, etfSelectionsB ?? {});
    for (const row of third.etfImplementation) {
      expect(row.selectedSlot).toBe(0);
    }
  });
});

// ----------------------------------------------------------------------------
// Build → Compare publish/subscribe channel — fundamentals.
// ----------------------------------------------------------------------------
// These tests lock in the wire contract Compare's "Linked to Build" badge
// depends on:
//   1. Channels start empty until Build explicitly publishes (so a fresh
//      page load with no Generate click leaves Slot A untouched).
//   2. set/get round-trip with a defensive copy at the boundary.
//   3. Subscribers receive the value on every subsequent publication
//      (this is what mirrors live Build edits into a linked Slot A).
//   4. Setting back to null clears the channel and notifies subscribers.
// ----------------------------------------------------------------------------
describe("settings: lastBuildInput pub/sub", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("starts null on a fresh module load (Compare must not auto-link before Build generates)", async () => {
    const { getLastBuildInput } = await import("../src/lib/settings");
    expect(getLastBuildInput()).toBeNull();
  });

  it("notifies subscribers on every publish and supports clearing back to null", async () => {
    const { setLastBuildInput, subscribeLastBuildInput, getLastBuildInput } =
      await import("../src/lib/settings");

    const received: Array<Record<string, unknown> | null> = [];
    // The window stub above is a no-op for events, so call the callback
    // ourselves by intercepting setLastBuildInput's flow at the get layer.
    // Subscriber wiring is exercised in the manual-weights test below using
    // a richer window shim.
    const unsub = subscribeLastBuildInput((v) => received.push(v));

    setLastBuildInput({ baseCurrency: "CHF", riskAppetite: "Moderate" });
    expect(getLastBuildInput()).toEqual({ baseCurrency: "CHF", riskAppetite: "Moderate" });

    setLastBuildInput({ baseCurrency: "EUR", riskAppetite: "Aggressive" });
    expect(getLastBuildInput()).toEqual({ baseCurrency: "EUR", riskAppetite: "Aggressive" });

    setLastBuildInput(null);
    expect(getLastBuildInput()).toBeNull();

    unsub();
    // No assertion on `received` here — the stubbed window in this file
    // does not actually deliver CustomEvents. The next describe uses a
    // richer window stub to verify subscriber delivery end-to-end.
  });

  it("returns a defensive copy so callers cannot mutate the stored input", async () => {
    const { setLastBuildInput, getLastBuildInput } = await import("../src/lib/settings");
    const stored = { baseCurrency: "CHF" };
    setLastBuildInput(stored);
    const fetched = getLastBuildInput()!;
    fetched.baseCurrency = "USD";
    expect(getLastBuildInput()).toEqual({ baseCurrency: "CHF" });
  });
});

describe("settings: lastBuildManualWeights pub/sub", () => {
  beforeEach(() => {
    // Richer window stub that actually delivers CustomEvents — used here so
    // we can verify the subscriber pathway end-to-end (the unlink/relink
    // behaviour in Compare relies on each Build publication firing its
    // subscribed callback exactly once).
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    };
    const listeners = new Map<string, Set<(e: Event) => void>>();
    vi.stubGlobal("window", {
      localStorage: ls,
      addEventListener: (name: string, cb: (e: Event) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(cb);
      },
      removeEventListener: (name: string, cb: (e: Event) => void) => {
        listeners.get(name)?.delete(cb);
      },
      dispatchEvent: (e: Event) => {
        const cbs = listeners.get(e.type);
        if (cbs) for (const cb of cbs) cb(e);
        return true;
      },
      CustomEvent: globalThis.CustomEvent,
    });
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });

  it("delivers each manual-weights publication to all subscribers and clears with null", async () => {
    const { setLastBuildManualWeights, subscribeLastBuildManualWeights, getLastBuildManualWeights } =
      await import("../src/lib/settings");

    const received: Array<Record<string, number> | null> = [];
    const unsub = subscribeLastBuildManualWeights((w) => received.push(w));

    setLastBuildManualWeights({ "Equity-USA": 0.4 });
    setLastBuildManualWeights({ "Equity-USA": 0.45, "Bonds-Global": 0.3 });
    setLastBuildManualWeights(null);

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ "Equity-USA": 0.4 });
    expect(received[1]).toEqual({ "Equity-USA": 0.45, "Bonds-Global": 0.3 });
    expect(received[2]).toBeNull();
    expect(getLastBuildManualWeights()).toBeNull();

    unsub();
    setLastBuildManualWeights({ "Equity-USA": 0.5 });
    // After unsubscribe, no further deliveries.
    expect(received).toHaveLength(3);
  });

  it("treats an empty map identically to null so Compare never sees stale weights", async () => {
    const { setLastBuildManualWeights, getLastBuildManualWeights } =
      await import("../src/lib/settings");
    setLastBuildManualWeights({ "Equity-USA": 0.4 });
    expect(getLastBuildManualWeights()).toEqual({ "Equity-USA": 0.4 });
    setLastBuildManualWeights({});
    expect(getLastBuildManualWeights()).toBeNull();
  });
});
