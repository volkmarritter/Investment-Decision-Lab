import { describe, it, expect, vi } from "vitest";

import {
  triggerCompareSlotPreviewWarmups,
  type CompareSlotWarmupDeps,
} from "@/lib/explainCompare";
import type { ExplainWorkspace } from "@/lib/savedExplainPortfolios";
import type { WarmEtfPreviewResult } from "@/lib/useEtfInfo";

// IE00B3YLTY66 is in the catalog (SPDR MSCI ACWI IMI). Off-catalog ISINs
// below are syntactically valid (ISO 6166 checksum-correct length/shape)
// but not present in INSTRUMENTS, which is what the helper needs.
const CATALOG_ISIN = "IE00B3YLTY66";
const OFF_CATALOG_A = "LU0000000001";
const OFF_CATALOG_B = "LU0000000002";

function ws(positions: ExplainWorkspace["positions"]): ExplainWorkspace {
  return {
    v: 1,
    baseCurrency: "CHF",
    riskAppetite: 50,
    horizon: 10,
    hedged: false,
    lookThroughView: false,
    positions,
  };
}

function fakeWarm(): {
  warm: NonNullable<CompareSlotWarmupDeps["warm"]>;
  calls: string[];
} {
  const calls: string[] = [];
  const warm = vi.fn(async (isin: string): Promise<WarmEtfPreviewResult> => {
    calls.push(isin);
    return { ok: false, reason: "skipped", message: "stub" };
  });
  return { warm, calls };
}

describe("triggerCompareSlotPreviewWarmups", () => {
  it("fans out only off-catalog ISINs (catalog rows skipped)", () => {
    const { warm, calls } = fakeWarm();
    const triggered = triggerCompareSlotPreviewWarmups(
      ws([
        { isin: CATALOG_ISIN, bucketKey: "Equity-World", weight: 50 },
        { isin: OFF_CATALOG_A, bucketKey: "Equity-USA", weight: 30 },
        { isin: OFF_CATALOG_B, bucketKey: "Equity-Europe", weight: 20 },
      ]),
      { warm },
    );
    expect(triggered.sort()).toEqual([OFF_CATALOG_A, OFF_CATALOG_B].sort());
    expect(calls.sort()).toEqual([OFF_CATALOG_A, OFF_CATALOG_B].sort());
  });

  it("dedupes repeated ISINs across positions", () => {
    const { warm, calls } = fakeWarm();
    const triggered = triggerCompareSlotPreviewWarmups(
      ws([
        { isin: OFF_CATALOG_A, bucketKey: "Equity-USA", weight: 30 },
        { isin: OFF_CATALOG_A, bucketKey: "Equity-USA", weight: 20 },
      ]),
      { warm },
    );
    expect(triggered).toEqual([OFF_CATALOG_A]);
    expect(calls).toEqual([OFF_CATALOG_A]);
  });

  it("skips positions with operator-confirmed manualMeta.terBps", () => {
    const { warm, calls } = fakeWarm();
    const triggered = triggerCompareSlotPreviewWarmups(
      ws([
        {
          isin: OFF_CATALOG_A,
          bucketKey: "Equity-USA",
          weight: 30,
          manualMeta: { name: "x", terBps: 12 },
        },
        { isin: OFF_CATALOG_B, bucketKey: "Equity-Europe", weight: 20 },
      ]),
      { warm },
    );
    expect(triggered).toEqual([OFF_CATALOG_B]);
    expect(calls).toEqual([OFF_CATALOG_B]);
  });

  it("skips cash sentinels and malformed ISINs", () => {
    const { warm, calls } = fakeWarm();
    const triggered = triggerCompareSlotPreviewWarmups(
      ws([
        { isin: "", bucketKey: "Cash", weight: 25, cashCurrency: "CHF" },
        { isin: "NOTANISIN", bucketKey: "Equity-USA", weight: 10 },
        { isin: OFF_CATALOG_A, bucketKey: "Equity-USA", weight: 65 },
      ]),
      { warm },
    );
    expect(triggered).toEqual([OFF_CATALOG_A]);
    expect(calls).toEqual([OFF_CATALOG_A]);
  });

  it("invokes onResult for each warmed ISIN", async () => {
    const { warm } = fakeWarm();
    const seen: string[] = [];
    triggerCompareSlotPreviewWarmups(
      ws([
        { isin: OFF_CATALOG_A, bucketKey: "Equity-USA", weight: 60 },
        { isin: OFF_CATALOG_B, bucketKey: "Equity-Europe", weight: 40 },
      ]),
      {
        warm,
        onResult: (isin) => {
          seen.push(isin);
        },
      },
    );
    // Microtasks flush so the .then() handlers fire.
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.sort()).toEqual([OFF_CATALOG_A, OFF_CATALOG_B].sort());
  });
});
