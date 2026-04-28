// ----------------------------------------------------------------------------
// etfSelection.test.ts
// ----------------------------------------------------------------------------
// Verifies the per-bucket ETF picker storage layer + its end-to-end
// integration with getETFDetails(). Selection state is consulted on
// every render of the ETF Implementation table, so we exercise both the
// raw module API and the resolution path through the engine.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";

// Lightweight in-memory localStorage shim — vitest's default jsdom env
// provides one, but spelling it out keeps the test deterministic and
// avoids cross-test bleed when multiple .test.ts files share a single
// jsdom worker.
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

beforeEach(() => {
  installLocalStorage();
  vi.resetModules();
});

describe("etfSelection storage", () => {
  it("returns slot 0 when nothing is stored", async () => {
    const mod = await import("../src/lib/etfSelection");
    expect(mod.getETFSelection("Equity-USA")).toBe(0);
    expect(mod.getAllETFSelections()).toEqual({});
  });

  it("persists slot 1 / slot 2 and re-reads them", async () => {
    const mod = await import("../src/lib/etfSelection");
    mod.setETFSelection("Equity-USA", 1);
    mod.setETFSelection("Equity-Global", 2);
    expect(mod.getETFSelection("Equity-USA")).toBe(1);
    expect(mod.getETFSelection("Equity-Global")).toBe(2);
    expect(mod.getETFSelection("Equity-Europe")).toBe(0);
  });

  it("setETFSelection(key, 0) clears the entry", async () => {
    const mod = await import("../src/lib/etfSelection");
    mod.setETFSelection("Equity-USA", 1);
    expect(mod.getETFSelection("Equity-USA")).toBe(1);
    mod.setETFSelection("Equity-USA", 0);
    expect(mod.getETFSelection("Equity-USA")).toBe(0);
    expect(mod.getAllETFSelections()).toEqual({});
  });

  it("clearAllETFSelections wipes every entry", async () => {
    const mod = await import("../src/lib/etfSelection");
    mod.setETFSelection("Equity-USA", 1);
    mod.setETFSelection("Equity-Global", 2);
    mod.clearAllETFSelections();
    expect(mod.getAllETFSelections()).toEqual({});
  });

  it("ignores corrupt values in storage on read", async () => {
    // Hand-write a corrupt blob containing valid + invalid slot values.
    (globalThis as any).window.localStorage.setItem(
      "il.etfSelection.v1",
      JSON.stringify({ "Equity-USA": 1, "Equity-Global": 99, "Equity-EM": "garbage" }),
    );
    const mod = await import("../src/lib/etfSelection");
    const all = mod.getAllETFSelections();
    expect(all).toEqual({ "Equity-USA": 1 });
  });
});

describe("getETFDetails resolution with selection", () => {
  // Mirrors the engine's PortfolioInput shape — we only need the fields
  // that lookupKey() consults for Equity buckets.
  const baseInput = {
    baseCurrency: "CHF" as const,
    riskAppetite: "High" as const,
    horizon: 10,
    targetEquityPct: 80,
    numETFs: 6,
    numETFsMin: 4,
    includeCrypto: false,
    includeCommodities: true,
    includeRealEstate: false,
    includePrivateMarkets: false,
    includeSyntheticETFs: false,
    includeCurrencyHedging: false,
    preferredExchange: "LSE" as const,
    homeBias: 0,
    valueTilt: 0,
    qualityTilt: 0,
    sizeTilt: 0,
    momentumTilt: 0,
    investmentAmount: 100_000,
  };

  it("default slot returns the curated default ETF", async () => {
    const { getETFDetails } = await import("../src/lib/etfs");
    const d = getETFDetails("Equity", "USA", baseInput as any);
    expect(d.catalogKey).toBe("Equity-USA");
    expect(d.selectedSlot).toBe(0);
    expect(d.isin).toBe("IE00B5BMR087"); // iShares CSPX
    expect(d.selectableOptions.length).toBeGreaterThanOrEqual(2);
    expect(d.selectableOptions[0].isin).toBe("IE00B5BMR087");
  });

  it("slot 1 returns the first alternative", async () => {
    const { setETFSelection } = await import("../src/lib/etfSelection");
    setETFSelection("Equity-USA", 1);
    const { getETFDetails } = await import("../src/lib/etfs");
    const d = getETFDetails("Equity", "USA", baseInput as any);
    expect(d.selectedSlot).toBe(1);
    expect(d.isin).toBe("IE00BFMXXD54"); // Vanguard VUAA
  });

  it("slot 2 returns the second alternative", async () => {
    const { setETFSelection } = await import("../src/lib/etfSelection");
    setETFSelection("Equity-USA", 2);
    const { getETFDetails } = await import("../src/lib/etfs");
    const d = getETFDetails("Equity", "USA", baseInput as any);
    expect(d.selectedSlot).toBe(2);
    expect(d.isin).toBe("IE00B6YX5C33"); // SPDR SPY5
  });

  it("slot pointing past the end clamps to highest available alternative", async () => {
    // Equity-Europe has only 1 alternative — slot 2 must clamp to 1
    // rather than silently falling back to the default.
    const { setETFSelection } = await import("../src/lib/etfSelection");
    setETFSelection("Equity-Europe", 2);
    const { getETFDetails } = await import("../src/lib/etfs");
    const d = getETFDetails("Equity", "Europe", baseInput as any);
    expect(d.selectedSlot).toBe(1);
    expect(d.isin).toBe("IE00B945VV12"); // Vanguard VEUA
  });

  it("buckets without alternatives expose empty selectableOptions", async () => {
    const { getETFDetails } = await import("../src/lib/etfs");
    // Equity-Switzerland (CH0237935652) is curated as a single-default
    // bucket with no alternatives — picker UI must stay hidden.
    const d = getETFDetails("Equity", "Switzerland", baseInput as any);
    expect(d.selectableOptions).toEqual([]);
    expect(d.selectedSlot).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Override precedence — the Methodology "swap ETF" pane is a stronger
  // signal than the per-bucket picker. When an override is active for a
  // bucket, getETFDetails() must:
  //   • return the overridden ETF (not the curated default OR a selected
  //     alternative — even if a selection was previously stored)
  //   • surface selectableOptions = [] (so the picker hides; otherwise
  //     the user wouldn't see their pinned override among the choices)
  //   • report selectedSlot = 0 (the picker is conceptually inactive)
  // --------------------------------------------------------------------------
  it("override beats stored selection for the same bucket", async () => {
    const { setETFSelection } = await import("../src/lib/etfSelection");
    const { setETFOverride } = await import("../src/lib/etfOverrides");
    setETFSelection("Equity-USA", 1); // pick Vanguard VUAA via picker
    // Now hand-override the same bucket to a fictional ISIN to prove
    // the override layer is the one that gets returned, NOT the stored
    // alternative slot.
    setETFOverride("Equity-USA", {
      name: "Custom Override S&P 500 UCITS",
      isin: "IE00OVERRIDE99",
      terBps: 4,
      domicile: "Ireland",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "Operator-pinned override for testing precedence semantics.",
      listings: { LSE: { ticker: "OVRD" } },
      defaultExchange: "LSE",
    });
    const { getETFDetails } = await import("../src/lib/etfs");
    const d = getETFDetails("Equity", "USA", baseInput as any);
    expect(d.isin).toBe("IE00OVERRIDE99");
    expect(d.selectableOptions).toEqual([]);
    expect(d.selectedSlot).toBe(0);
    // catalogKey is still surfaced so the UI can fall back to picker
    // mode the moment the override gets cleared.
    expect(d.catalogKey).toBe("Equity-USA");
  });

  it("clearing the override restores the picker and the stored slot selection", async () => {
    const { setETFSelection } = await import("../src/lib/etfSelection");
    const { setETFOverride, clearETFOverride } = await import(
      "../src/lib/etfOverrides"
    );
    setETFSelection("Equity-USA", 2); // stored: SPDR SPY5 alt
    setETFOverride("Equity-USA", {
      name: "Override",
      isin: "IE00OVERRIDE99",
      terBps: 4,
      domicile: "Ireland",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "x",
      listings: { LSE: { ticker: "OVRD" } },
      defaultExchange: "LSE",
    });
    const { getETFDetails } = await import("../src/lib/etfs");
    expect(getETFDetails("Equity", "USA", baseInput as any).isin).toBe(
      "IE00OVERRIDE99",
    );
    // Clearing the override must hand control back to the picker; the
    // previously-stored slot 2 (SPDR SPY5) becomes active again rather
    // than silently snapping back to the curated default.
    clearETFOverride("Equity-USA");
    const after = getETFDetails("Equity", "USA", baseInput as any);
    expect(after.isin).toBe("IE00B6YX5C33"); // SPDR SPY5 (slot 2)
    expect(after.selectedSlot).toBe(2);
    expect(after.selectableOptions.length).toBeGreaterThanOrEqual(2);
  });
});
