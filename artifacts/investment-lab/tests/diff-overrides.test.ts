// Unit tests for scripts/lib/diff-overrides.mjs.
//
// The diff helper is what makes the admin pane's "Recent ETF updates" panel
// honest: when justETF lowers a fund's TER from 8 bps to 7, exactly one
// JSON line lands in refresh-changes.log.jsonl. These tests pin that
// contract so a future "let's just diff the whole record" refactor doesn't
// silently start emitting noise (e.g. one entry per scrape for the
// `topHoldingsAsOf` stamp that updates every cron tick).
import { describe, it, expect } from "vitest";
// @ts-expect-error: scripts/lib/diff-overrides.mjs is plain JS without .d.ts.
import { computeFieldChanges } from "../scripts/lib/diff-overrides.mjs";

describe("computeFieldChanges", () => {
  it("returns no changes when the patch matches the previous entry exactly", () => {
    const prev = { terBps: 7, aumMillionsEUR: 73824 };
    const patch = { terBps: 7, aumMillionsEUR: 73824 };
    expect(computeFieldChanges(prev, patch)).toEqual([]);
  });

  it("emits one entry per changed primitive field", () => {
    const prev = { terBps: 8, aumMillionsEUR: 70000 };
    const patch = { terBps: 7, aumMillionsEUR: 73824 };
    const changes = computeFieldChanges(prev, patch);
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "terBps", before: 8, after: 7 },
        { field: "aumMillionsEUR", before: 70000, after: 73824 },
      ])
    );
  });

  it("ignores fields that are unchanged even when the patch contains them", () => {
    // The justetf core scraper writes every successfully-extracted field
    // into the patch on every run, even when nothing actually changed —
    // the diff has to filter those out so the change log only reflects
    // genuine shifts.
    const prev = { terBps: 7, aumMillionsEUR: 73824, distribution: "Accumulating" };
    const patch = { terBps: 7, aumMillionsEUR: 73900, distribution: "Accumulating" };
    const changes = computeFieldChanges(prev, patch);
    expect(changes).toEqual([
      { field: "aumMillionsEUR", before: 73824, after: 73900 },
    ]);
  });

  it("treats a missing previous entry as 'before: null'", () => {
    const patch = { terBps: 7, aumMillionsEUR: 1234 };
    const changes = computeFieldChanges(undefined, patch);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "terBps", before: null, after: 7 },
        { field: "aumMillionsEUR", before: null, after: 1234 },
      ])
    );
  });

  it("does not flag an object diff when only key-order changes", () => {
    // The listings extractor builds its output map by iterating exchanges
    // in a non-deterministic order. Pinning this prevents a flap where
    // every nightly run emits a "listings changed" row even though the
    // ticker map is identical.
    const prev = { listings: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" } } };
    const patch = { listings: { XETRA: { ticker: "SXR8" }, LSE: { ticker: "CSPX" } } };
    expect(computeFieldChanges(prev, patch)).toEqual([]);
  });

  it("flags a real listings change with the full object before/after", () => {
    const prev = { listings: { LSE: { ticker: "CSPX" } } };
    const patch = { listings: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" } } };
    const changes = computeFieldChanges(prev, patch);
    expect(changes).toEqual([
      {
        field: "listings",
        before: { LSE: { ticker: "CSPX" } },
        after: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" } },
      },
    ]);
  });

  it("flags topHoldings reordering as a change (it is a real shift)", () => {
    // Top-10 holdings are presented in descending weight order, so a
    // reorder means the underlying weights actually shifted — this IS a
    // change worth surfacing in the admin pane.
    const prev = { topHoldings: [{ name: "AAPL", pct: 7 }, { name: "MSFT", pct: 6 }] };
    const patch = { topHoldings: [{ name: "MSFT", pct: 7 }, { name: "AAPL", pct: 6 }] };
    const changes = computeFieldChanges(prev, patch);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("topHoldings");
  });
});
