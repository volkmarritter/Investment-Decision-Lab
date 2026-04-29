// ----------------------------------------------------------------------------
// catalog-validate-lookthrough-orphans.test.ts
// ----------------------------------------------------------------------------
// Task #122 (T003) — strict referential integrity between INSTRUMENTS
// (the ETF master list in etfs.ts) and the look-through JSON sidecar
// (src/data/lookthrough.overrides.json). The invariant:
//
//   ∀ ISIN ∈ pool ∪ overrides:  ISIN ∈ INSTRUMENTS
//
// Phase 2 of the task flips the validator from "warning" to "error", so
// any future zombie pool/override entry must trip the build. This test
// fakes an orphan via vi.mock of the lookthrough getters and asserts
// that validateCatalog() emits the expected error issue. The companion
// test in catalog-validate.test.ts already proves the curated catalog
// returns []; this file proves the negative case.
// ----------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";

// vi.mock is hoisted above the import of etfs.ts so the mocked getters
// are in place before validateCatalog() captures them. Returning
// fixed-shape arrays simulates a JSON that has been edited to add an
// ISIN nobody registered in INSTRUMENTS.
vi.mock("../src/lib/lookthrough", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/lookthrough")>(
      "../src/lib/lookthrough",
    );
  return {
    ...actual,
    getLookthroughPoolIsins: () => ["IE0000000POOL", "IE00B4L5YX21"],
    getLookthroughOverrideIsins: () => ["IE0000000OVRD"],
  };
});

import { validateCatalog } from "../src/lib/etfs";

describe("validateCatalog() — look-through ⊆ INSTRUMENTS invariant", () => {
  it("emits an error for a pool ISIN that is not in INSTRUMENTS", () => {
    const issues = validateCatalog();
    const poolErr = issues.find(
      (i) => i.bucket === "lookthrough.pool" && i.message.includes("IE0000000POOL"),
    );
    expect(poolErr, JSON.stringify(issues, null, 2)).toBeDefined();
    expect(poolErr?.severity).toBe("error");
    expect(poolErr?.message).toContain("known to look-through but not registered");
  });

  it("emits an error for an override ISIN that is not in INSTRUMENTS", () => {
    const issues = validateCatalog();
    const ovErr = issues.find(
      (i) =>
        i.bucket === "lookthrough.overrides" && i.message.includes("IE0000000OVRD"),
    );
    expect(ovErr, JSON.stringify(issues, null, 2)).toBeDefined();
    expect(ovErr?.severity).toBe("error");
  });

  it("does NOT flag a pool ISIN that is registered in INSTRUMENTS", () => {
    // IE00B4L5Y983 is the iShares Core MSCI World UCITS ETF — included
    // in the mocked pool list above and known to be a registered
    // INSTRUMENTS row, so it must NOT show up as an orphan.
    const issues = validateCatalog();
    const falsePositive = issues.find(
      (i) =>
        i.bucket.startsWith("lookthrough.") && i.message.includes("IE00B4L5Y983"),
    );
    expect(falsePositive, JSON.stringify(issues, null, 2)).toBeUndefined();
  });
});
