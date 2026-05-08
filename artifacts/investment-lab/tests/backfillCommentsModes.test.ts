// ----------------------------------------------------------------------------
// backfillCommentsModes.test.ts
// ----------------------------------------------------------------------------
// Task #207 — pin the source-scoped row selection rules of
// `backfill-comments.mjs`. The three modes have very different write
// scopes and getting them wrong would either trample operator-curated
// rows ("manual" overwritten) or leave fresh look-through changes
// invisible (auto rows skipped). The pure `shouldVisit` helper is
// exported via the script's `__test` channel for this exact purpose.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
// @ts-expect-error - .mjs has no .d.ts; runtime import is fine.
import { __test } from "../scripts/backfill-comments.mjs";

const { shouldVisit } = __test;

describe("backfill-comments — shouldVisit row-selection contract", () => {
  describe("mode='all' (default standalone CLI)", () => {
    it("touches a legacy untagged row only when its comment is empty", () => {
      expect(shouldVisit(undefined, "", "all", false)).toBe(true);
      expect(shouldVisit(undefined, "Hand-written.", "all", false)).toBe(false);
    });
    it("touches auto and justetf rows for re-refresh", () => {
      expect(shouldVisit("auto", "stored", "all", false)).toBe(true);
      expect(shouldVisit("justetf", "stored", "all", false)).toBe(true);
    });
    it("never touches manual rows", () => {
      expect(shouldVisit("manual", "stored", "all", false)).toBe(false);
      expect(shouldVisit("manual", "", "all", false)).toBe(false);
    });
  });

  describe("mode='justetf-refresh' (weekly justETF tail)", () => {
    it("touches non-manual rows", () => {
      expect(shouldVisit(undefined, "", "justetf-refresh", false)).toBe(true);
      expect(shouldVisit("auto", "x", "justetf-refresh", false)).toBe(true);
      expect(shouldVisit("justetf", "x", "justetf-refresh", false)).toBe(true);
    });
    it("never touches manual rows", () => {
      expect(shouldVisit("manual", "x", "justetf-refresh", false)).toBe(false);
    });
    it("respects untagged-with-curated-text — does not overwrite legacy hand-written rows", () => {
      // Legacy rows have no source tag. We only re-fill them when the
      // comment is genuinely empty — overwriting tag-less curated rows
      // would silently destroy an operator's editorial work from
      // before the source-tag was introduced.
      expect(
        shouldVisit(undefined, "Hand-written.", "justetf-refresh", false),
      ).toBe(false);
    });
  });

  describe("mode='lookthrough-refresh' (monthly look-through tail)", () => {
    it("only touches rows already tagged commentSource:'auto'", () => {
      expect(shouldVisit("auto", "x", "lookthrough-refresh", false)).toBe(true);
    });
    it("does NOT touch justetf rows — those belong to the weekly justETF run", () => {
      expect(shouldVisit("justetf", "x", "lookthrough-refresh", false)).toBe(
        false,
      );
    });
    it("does NOT touch manual rows", () => {
      expect(shouldVisit("manual", "x", "lookthrough-refresh", false)).toBe(
        false,
      );
    });
    it("does NOT touch untagged rows — first-fill is delegated to the justETF run so the source-priority contract (justETF wins, auto fallback) lives in one place", () => {
      expect(
        shouldVisit(undefined, "", "lookthrough-refresh", false),
      ).toBe(false);
      expect(
        shouldVisit(undefined, "Legacy.", "lookthrough-refresh", false),
      ).toBe(false);
    });
  });

  describe("force=true bypasses every gate except 'manual'", () => {
    // Tested implicitly: force is the operator's "yes really, re-scrape
    // everything" lever — but it must NEVER overwrite a manual row,
    // because manual is the operator's own promise that the row is
    // hand-curated.
    it("forces auto + justetf + untagged rows in any mode", () => {
      for (const mode of [
        "all",
        "justetf-refresh",
        "lookthrough-refresh",
      ] as const) {
        expect(shouldVisit("auto", "x", mode, true)).toBe(true);
        expect(shouldVisit("justetf", "x", mode, true)).toBe(true);
        expect(shouldVisit(undefined, "x", mode, true)).toBe(true);
      }
    });
    it("never forces a manual row", () => {
      for (const mode of [
        "all",
        "justetf-refresh",
        "lookthrough-refresh",
      ] as const) {
        expect(shouldVisit("manual", "x", mode, true)).toBe(false);
      }
    });
  });
});
