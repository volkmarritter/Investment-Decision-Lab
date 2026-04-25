// Pure unit tests for the NEW / REPLACE / DUPLICATE_ISIN decision the
// admin pane uses to gate its Open PR button. Logic lives in
// src/lib/catalog-classify.ts (extracted from Admin.tsx so it can be
// tested in isolation without React).

import { describe, it, expect } from "vitest";
import { classifyDraft } from "../src/lib/catalog-classify";
import type { CatalogSummary } from "../src/lib/admin-api";

const CATALOG: CatalogSummary = {
  "Equity-Global": {
    key: "Equity-Global",
    name: "SPDR MSCI ACWI IMI UCITS",
    isin: "IE00B3YLTY66",
    terBps: 17,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    listings: { LSE: { ticker: "SPYI" } },
    defaultExchange: "LSE",
  },
  "Equity-USA": {
    key: "Equity-USA",
    name: "iShares Core S&P 500 UCITS",
    isin: "IE00B5BMR087",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    listings: { LSE: { ticker: "CSPX" } },
    defaultExchange: "LSE",
  },
};

describe("classifyDraft", () => {
  it("returns NEW when the key and ISIN are both unseen", () => {
    const r = classifyDraft(CATALOG, "Equity-Korea", "IE00B0KOREA01");
    expect(r.state).toBe("NEW");
  });

  it("returns REPLACE when the chosen key already exists", () => {
    const r = classifyDraft(CATALOG, "Equity-USA", "IE00B5BMR087");
    expect(r.state).toBe("REPLACE");
    if (r.state === "REPLACE") {
      expect(r.existing.isin).toBe("IE00B5BMR087");
      expect(r.existing.name).toBe("iShares Core S&P 500 UCITS");
    }
  });

  it("returns REPLACE when the chosen key exists and the ISIN is being changed", () => {
    // Operator wants to swap the underlying fund for the same bucket key.
    // That's a legitimate replace, not a duplicate.
    const r = classifyDraft(CATALOG, "Equity-USA", "IE00BNEWUSA01");
    expect(r.state).toBe("REPLACE");
  });

  it("returns DUPLICATE_ISIN when a different key already uses this ISIN", () => {
    const r = classifyDraft(CATALOG, "Equity-USA-Variant", "IE00B5BMR087");
    expect(r.state).toBe("DUPLICATE_ISIN");
    if (r.state === "DUPLICATE_ISIN") {
      expect(r.conflictKey).toBe("Equity-USA");
      expect(r.conflict.name).toBe("iShares Core S&P 500 UCITS");
    }
  });

  it("treats DUPLICATE_ISIN as higher priority than REPLACE", () => {
    // Pathological: operator picked a key that exists AND an ISIN that's
    // taken under another key. The duplicate is the more dangerous bug,
    // so it wins.
    const r = classifyDraft(CATALOG, "Equity-Global", "IE00B5BMR087");
    expect(r.state).toBe("DUPLICATE_ISIN");
  });

  it("normalises ISIN case so 'ie00...' matches 'IE00...'", () => {
    const r = classifyDraft(CATALOG, "Equity-USA-Variant", "ie00b5bmr087");
    expect(r.state).toBe("DUPLICATE_ISIN");
  });

  it("treats whitespace-only key as NEW (operator hasn't picked one yet)", () => {
    const r = classifyDraft(CATALOG, "   ", "IE00B0NEW00001");
    expect(r.state).toBe("NEW");
  });
});
