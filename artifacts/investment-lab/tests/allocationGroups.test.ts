import { describe, it, expect } from "vitest";
import {
  classifyGroup,
  summarizeAllocationByGroup,
} from "../src/lib/allocationGroups";
import type { AssetAllocation } from "../src/lib/types";

describe("classifyGroup", () => {
  it("classifies cash variants", () => {
    expect(classifyGroup("Cash", "CHF")).toBe("Cash");
    expect(classifyGroup("Cash", "USD")).toBe("Cash");
    expect(classifyGroup("Money Market", "EUR")).toBe("Cash");
  });

  it("classifies bond / fixed-income variants", () => {
    expect(classifyGroup("Fixed Income", "Global")).toBe("Bonds");
    expect(classifyGroup("Bonds", "Global")).toBe("Bonds");
    expect(classifyGroup("Government Bonds", "USA")).toBe("Bonds");
  });

  it("classifies regional equities as Equities", () => {
    expect(classifyGroup("Equity", "USA")).toBe("Equities");
    expect(classifyGroup("Equity", "Europe ex-CH")).toBe("Equities");
    expect(classifyGroup("Equity", "Switzerland")).toBe("Equities");
    expect(classifyGroup("Equity", "Japan")).toBe("Equities");
    expect(classifyGroup("Equity", "Emerging Markets")).toBe("Equities");
    expect(classifyGroup("Equity", "EM")).toBe("Equities");
    expect(classifyGroup("Equities", "World")).toBe("Equities");
    expect(classifyGroup("Equities", "Global")).toBe("Equities");
  });

  it("does NOT misclassify country names that contain short region codes", () => {
    // "China" must not match "ch"; "Bermuda" must not match short codes.
    expect(classifyGroup("Equity", "China")).toBe("Satellites");
    expect(classifyGroup("Equity", "Bermuda")).toBe("Satellites");
  });

  it("classifies thematic equity sleeves as Equities (tilt within the equity sleeve, not a satellite)", () => {
    expect(classifyGroup("Equity", "Sustainability")).toBe("Equities");
    expect(classifyGroup("Equity", "Technology")).toBe("Equities");
    expect(classifyGroup("Equity", "Healthcare")).toBe("Equities");
    expect(classifyGroup("Equity", "Cybersecurity")).toBe("Equities");
  });

  it("classifies non-equity satellite sleeves", () => {
    expect(classifyGroup("Commodities", "Gold")).toBe("Satellites");
    expect(classifyGroup("Real Estate", "Global REITs")).toBe("Satellites");
    expect(classifyGroup("Listed Real Estate", "Global")).toBe("Satellites");
    expect(classifyGroup("Digital Assets", "Broad Crypto")).toBe("Satellites");
    expect(classifyGroup("Crypto", "BTC")).toBe("Satellites");
  });

  it("falls back to Satellites for unknown labels", () => {
    expect(classifyGroup("Unknown", "Mars")).toBe("Satellites");
    expect(classifyGroup("", "")).toBe("Satellites");
  });
});

describe("summarizeAllocationByGroup", () => {
  it("aggregates a typical portfolio and sums to 100%", () => {
    const allocation: AssetAllocation[] = [
      { assetClass: "Cash", region: "CHF", weight: 5 },
      { assetClass: "Fixed Income", region: "Global", weight: 30 },
      { assetClass: "Equity", region: "USA", weight: 35 },
      { assetClass: "Equity", region: "Europe ex-CH", weight: 15 },
      { assetClass: "Equity", region: "Emerging Markets", weight: 5 },
      { assetClass: "Commodities", region: "Gold", weight: 4 },
      { assetClass: "Real Estate", region: "Global REITs", weight: 3 },
      { assetClass: "Equity", region: "Sustainability", weight: 3 },
    ];
    const summary = summarizeAllocationByGroup(allocation);
    const byGroup = Object.fromEntries(
      summary.map((s) => [s.group, s.weight]),
    );
    expect(byGroup.Cash).toBeCloseTo(5, 1);
    expect(byGroup.Bonds).toBeCloseTo(30, 1);
    // Thematic Sustainability (3%) is a tilt within the equity sleeve, so
    // Equities = 35 + 15 + 5 + 3 = 58 and Satellites = 4 + 3 = 7.
    expect(byGroup.Equities).toBeCloseTo(58, 1);
    expect(byGroup.Satellites).toBeCloseTo(7, 1);
    const total =
      byGroup.Cash + byGroup.Bonds + byGroup.Equities + byGroup.Satellites;
    expect(total).toBeCloseTo(100, 1);
  });

  it("preserves a 100% total when individual values round in opposing directions", () => {
    const allocation: AssetAllocation[] = [
      { assetClass: "Cash", region: "CHF", weight: 33.33 },
      { assetClass: "Fixed Income", region: "Global", weight: 33.33 },
      { assetClass: "Equity", region: "USA", weight: 33.34 },
    ];
    const summary = summarizeAllocationByGroup(allocation);
    const total = summary.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it("returns all four groups in a stable order even when some are zero", () => {
    const summary = summarizeAllocationByGroup([
      { assetClass: "Equity", region: "USA", weight: 100 },
    ]);
    expect(summary.map((s) => s.group)).toEqual([
      "Cash",
      "Bonds",
      "Equities",
      "Satellites",
    ]);
    expect(summary.find((s) => s.group === "Equities")?.weight).toBeCloseTo(
      100,
      1,
    );
    expect(summary.find((s) => s.group === "Cash")?.weight).toBe(0);
  });

  it("returns zero totals when given an empty allocation", () => {
    const summary = summarizeAllocationByGroup([]);
    expect(summary.every((s) => s.weight === 0)).toBe(true);
  });
});
