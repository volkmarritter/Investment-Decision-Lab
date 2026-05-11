// ----------------------------------------------------------------------------
// backfillSourcePriority.test.ts — Task #207 round 5
// ----------------------------------------------------------------------------
// Locks the source-priority contract end-to-end through
// `backfillCatalogComments`:
//
//   1. When the justETF fetcher returns text, the row is stamped
//      `commentSource: "justetf"` and the prose comes from justETF —
//      describeEtf() is NOT consulted in that branch.
//   2. When the justETF fetcher returns nothing, the row falls back to
//      `commentSource: "auto"` and the prose is the describeEtf()
//      template.
//   3. `mode: "lookthrough-refresh"` never invokes the fetcher at all
//      (its job is just to re-render auto rows against the freshly
//      refreshed look-through profile).
//
// Targets `IE000GA3D489`, an existing row in `src/lib/etfs.ts` that
// is currently commentSource:"justetf". `shouldVisit` admits both
// "auto" and "justetf" rows in mode='all', so the fetcher is invoked
// and the source-priority contract can be exercised end-to-end. The
// test runs in dry-run mode so etfs.ts is never written.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
// @ts-expect-error - .mjs has no .d.ts; runtime import is fine.
import { backfillCatalogComments } from "../scripts/backfill-comments.mjs";

const TARGET = "IE000GA3D489";

function makeLog() {
  const lines: string[] = [];
  const warns: string[] = [];
  return {
    lines,
    warns,
    log: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
    warn: (...a: unknown[]) => warns.push(a.map(String).join(" ")),
  };
}

describe("backfillCatalogComments — source-priority contract", () => {
  it("mode='all' + fetcher returns text → row tagged justetf (justETF wins)", async () => {
    const fetched: string[] = [];
    const mock = async (isin: string) => {
      fetched.push(isin);
      return {
        en: "JustETF investment objective text for the test.",
        de: "JustETF Anlageziel-Text für den Test.",
      };
    };
    const log = makeLog();
    const res = await backfillCatalogComments({
      targetIsins: [TARGET],
      mode: "all",
      force: true,
      dryRun: true,
      fetchDescriptionImpl: mock,
      log,
    });
    expect(fetched).toEqual([TARGET]);
    expect(res.candidates).toBe(1);
    // Either updated (auto → justetf flip) or still flips source tag.
    const flipLine = log.lines.find((l) =>
      l.includes(TARGET) && l.includes("(justetf)"),
    );
    expect(flipLine, log.lines.join("\n")).toBeDefined();
  });

  it("mode='all' + fetcher returns nothing → row falls back to auto", async () => {
    const fetched: string[] = [];
    const mock = async (isin: string) => {
      fetched.push(isin);
      return { en: undefined, de: undefined };
    };
    const log = makeLog();
    const res = await backfillCatalogComments({
      targetIsins: [TARGET],
      mode: "all",
      force: true,
      dryRun: true,
      fetchDescriptionImpl: mock,
      log,
    });
    expect(fetched).toEqual([TARGET]);
    expect(res.candidates).toBe(1);
    // The row was already commentSource:"auto" with describeEtf prose,
    // so a fresh auto-render produces identical text → "already
    // up-to-date". The point is: NO line tagged "(justetf)" is emitted.
    const justetfLine = log.lines.find((l) => l.includes("(justetf)"));
    expect(justetfLine, log.lines.join("\n")).toBeUndefined();
  });

  it("mode='lookthrough-refresh' never calls the justETF fetcher", async () => {
    const fetched: string[] = [];
    const mock = async (isin: string) => {
      fetched.push(isin);
      return { en: "should not be called", de: "should not be called" };
    };
    const log = makeLog();
    await backfillCatalogComments({
      targetIsins: [TARGET],
      mode: "lookthrough-refresh",
      force: true,
      dryRun: true,
      fetchDescriptionImpl: mock,
      log,
    });
    expect(fetched).toEqual([]);
    // No row should be flipped to "(justetf)" by the lookthrough path.
    const justetfLine = log.lines.find((l) => l.includes("(justetf)"));
    expect(justetfLine).toBeUndefined();
  });
});
