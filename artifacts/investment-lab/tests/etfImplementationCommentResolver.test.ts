// ----------------------------------------------------------------------------
// etfImplementationCommentResolver.test.ts
// ----------------------------------------------------------------------------
// Task #207 — pin the source-aware resolution rules in
// `resolveEtfImplementationComment`. Three users depend on this resolver
// agreeing on a single string for any given (etf, lang) pair:
//   1. EtfImplementationCommentCell (Build / Compare table)
//   2. EtfImplementationReadOnly (Compare read-only table)
//   3. ETFDetailsDialog (Build/Compare detail popup)
//   4. exportEtfImplementationXlsx (Excel export)
//
// If any of those drift apart users see a different description for the
// same fund depending on which surface they're looking at — exactly the
// bug Task #207 fixed. Lock it down.
// ----------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";

// IE00BM67HT60 is a real catalog ISIN with a curated look-through
// profile (Xtrackers MSCI World IT — heavily US-tech). The resolver's
// `auto` branch derives its prose from that profile via describeEtf,
// so we lean on the real profile rather than mocking it; that way the
// "live re-render wins over stale stored" assertion exercises the same
// code path the UI does at runtime.
import { resolveEtfImplementationComment } from "../src/lib/etfImplementationCommentText";

afterEach(() => vi.restoreAllMocks());

const baseEtf = {
  exampleETF: "Xtrackers MSCI World Information Technology UCITS",
  isin: "IE00BM67HT60",
  domicile: "Ireland",
  distribution: "Accumulating" as const,
  currency: "USD",
};

describe("resolveEtfImplementationComment — source priority", () => {
  it("renders the stored manual comment verbatim (operator-curated)", () => {
    const r = resolveEtfImplementationComment(
      { ...baseEtf, comment: "Manual operator note.", commentSource: "manual" },
      "en",
    );
    expect(r).toEqual({ text: "Manual operator note.", source: "curated" });
  });

  it("renders stored justETF prose verbatim — does NOT recompute describeEtf", () => {
    // Even though baseEtf has a live look-through profile that would
    // produce a non-empty describeEtf result, justetf-tagged rows are
    // treated as authoritative — recomputing would discard real
    // editorial prose from justETF in favour of our template.
    const r = resolveEtfImplementationComment(
      {
        ...baseEtf,
        comment: "Stored justETF investment objective.",
        commentSource: "justetf",
      },
      "en",
    );
    expect(r).toEqual({
      text: "Stored justETF investment objective.",
      source: "curated",
    });
  });

  it("prefers commentDe over comment when lang === 'de'", () => {
    const r = resolveEtfImplementationComment(
      {
        ...baseEtf,
        comment: "EN text.",
        commentDe: "DE-Text.",
        commentSource: "manual",
      },
      "de",
    );
    expect(r).toEqual({ text: "DE-Text.", source: "curated" });
  });

  it("falls back to comment in DE when commentDe is empty", () => {
    const r = resolveEtfImplementationComment(
      {
        ...baseEtf,
        comment: "EN-only fallback.",
        commentDe: "",
        commentSource: "manual",
      },
      "de",
    );
    expect(r).toEqual({ text: "EN-only fallback.", source: "curated" });
  });

  it("legacy curated rows with no commentSource tag still render verbatim", () => {
    const r = resolveEtfImplementationComment(
      { ...baseEtf, comment: "Legacy hand-written line." },
      "en",
    );
    expect(r).toEqual({
      text: "Legacy hand-written line.",
      source: "curated",
    });
  });

  it("falls through to the live describeEtf template when nothing is stored", () => {
    const r = resolveEtfImplementationComment(
      { ...baseEtf, comment: "" },
      "en",
    );
    expect(r.source).toBe("auto");
    expect(r.text).toMatch(/ETF/);
  });
});

describe("resolveEtfImplementationComment — stale-auto override (Task #207)", () => {
  it("commentSource === 'auto' triggers live describeEtf re-render — stored stale text is dropped", () => {
    // Simulate a row whose stored auto prose was generated against an
    // older look-through snapshot that's no longer accurate (e.g. a
    // long-since-stale top-holdings line). The resolver MUST prefer the
    // live re-render so the UI tracks the freshly-refreshed profile
    // without waiting for the monthly backfill.
    const stale = "Stale auto-generated line from a previous snapshot.";
    const r = resolveEtfImplementationComment(
      {
        ...baseEtf,
        comment: stale,
        commentSource: "auto",
      },
      "en",
    );
    expect(r.source).toBe("auto");
    expect(r.text).not.toBe(stale);
    // Live describeEtf for IE00BM67HT60 (a Technology-tilted World
    // sleeve) reliably mentions Technology; assert presence as a
    // weak-but-stable signal that the live branch ran.
    expect(r.text.toLowerCase()).toContain("technology");
  });

  it("commentSource === 'auto' with DE locale renders the live DE template", () => {
    const r = resolveEtfImplementationComment(
      {
        ...baseEtf,
        comment: "stale en",
        commentDe: "stale de",
        commentSource: "auto",
      },
      "de",
    );
    expect(r.source).toBe("auto");
    expect(r.text).not.toBe("stale de");
    // German describeEtf output uses "Aktien-ETF" or "ETF" as lead noun.
    expect(r.text).toMatch(/(Aktien-)?ETF/);
  });
});
