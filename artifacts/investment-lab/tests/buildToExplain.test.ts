import { describe, expect, it } from "vitest";
import { buildToExplainWorkspace } from "@/lib/explainCompare";
import type { ETFImplementation, PortfolioInput, PortfolioOutput } from "@/lib/types";

function makeRow(over: Partial<ETFImplementation>): ETFImplementation {
  return {
    bucket: "",
    assetClass: "",
    weight: 0,
    intent: "",
    exampleETF: "",
    rationale: "",
    isin: "",
    ticker: "",
    exchange: "",
    terBps: 0,
    domicile: "",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
    ...over,
  };
}

const baseInput: PortfolioInput = {
  baseCurrency: "EUR",
  riskAppetite: "Moderate",
  horizon: 12,
  targetEquityPct: 60,
  numETFs: 6,
  numETFsMin: 4,
  preferredExchange: "XETRA",
  thematicPreference: "None",
  includeCurrencyHedging: true,
  includeSyntheticETFs: false,
  lookThroughView: false,
  includeCrypto: false,
  includeListedRealEstate: false,
  includeCommodities: false,
};

describe("buildToExplainWorkspace", () => {
  it("copies settings and renames includeCurrencyHedging → hedged", () => {
    const out: PortfolioOutput = {
      allocation: [],
      etfImplementation: [
        makeRow({ isin: "IE00B5BMR087", catalogKey: "Equity-USA", weight: 40 }),
      ],
      rationale: [],
      risks: [],
      learning: [],
    };
    const ws = buildToExplainWorkspace(baseInput, out);
    expect(ws.v).toBe(1);
    expect(ws.baseCurrency).toBe("EUR");
    expect(ws.riskAppetite).toBe("Moderate");
    expect(ws.horizon).toBe(12);
    expect(ws.hedged).toBe(true);
    expect(ws.lookThroughView).toBe(false);
  });

  it("maps each implementation row to a position with bucketKey from catalogKey", () => {
    const out: PortfolioOutput = {
      allocation: [],
      etfImplementation: [
        makeRow({ isin: "IE00B5BMR087", catalogKey: "Equity-USA", weight: 40 }),
        makeRow({ isin: "IE00B4K48X80", catalogKey: "Equity-Europe", weight: 25 }),
        makeRow({ isin: "IE00B3F81409", catalogKey: "FixedIncome-Global", weight: 35 }),
      ],
      rationale: [],
      risks: [],
      learning: [],
    };
    const ws = buildToExplainWorkspace(baseInput, out);
    expect(ws.positions).toEqual([
      { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 40 },
      { isin: "IE00B4K48X80", bucketKey: "Equity-Europe", weight: 25 },
      { isin: "IE00B3F81409", bucketKey: "FixedIncome-Global", weight: 35 },
    ]);
  });

  it("drops empty-isin and zero-weight rows; falls back to '' bucketKey when catalogKey is null", () => {
    const out: PortfolioOutput = {
      allocation: [],
      etfImplementation: [
        makeRow({ isin: "IE00B5BMR087", catalogKey: null, weight: 100 }),
        makeRow({ isin: "", catalogKey: "Equity-USA", weight: 10 }),
        makeRow({ isin: "IE00B4K48X80", catalogKey: "Equity-Europe", weight: 0 }),
      ],
      rationale: [],
      risks: [],
      learning: [],
    };
    const ws = buildToExplainWorkspace(baseInput, out);
    expect(ws.positions).toEqual([
      { isin: "IE00B5BMR087", bucketKey: "", weight: 100 },
    ]);
  });
});
