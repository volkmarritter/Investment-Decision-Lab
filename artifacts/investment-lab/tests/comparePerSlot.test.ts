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
