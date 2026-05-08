// ----------------------------------------------------------------------------
// backfillManualProtection.test.ts — Task #207 round 4
// ----------------------------------------------------------------------------
// End-to-end safety net: regardless of mode (`all` / `justetf-refresh` /
// `lookthrough-refresh`) the backfill writer must NEVER overwrite a row
// whose stored commentSource === "manual". Also verify the legacy
// untagged-with-non-empty-comment row is left alone in the standalone
// modes (the operator may not have re-tagged a hand-curated entry yet).
// Uses the `__test.shouldVisit` channel because the script's full
// readFile/writeFile path requires a real on-disk fixture; the
// shouldVisit gate is the single source of truth for "do we touch this
// row" and is exhaustively asserted here from the contract side.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
// @ts-expect-error - .mjs has no .d.ts; runtime import is fine.
import { __test } from "../scripts/backfill-comments.mjs";

const { shouldVisit } = __test;

describe("backfill — manual-row protection (regression for Task #207)", () => {
  const MODES = ["all", "justetf-refresh", "lookthrough-refresh"] as const;

  for (const mode of MODES) {
    it(`mode='${mode}' never touches a manual non-empty row`, () => {
      expect(
        shouldVisit("manual", "Operator-curated prose.", mode, false),
      ).toBe(false);
    });
    it(`mode='${mode}' never touches a manual empty row either`, () => {
      // An operator may have intentionally cleared a comment to suppress
      // the cell. The "manual" tag is still the operator's veto.
      expect(shouldVisit("manual", "", mode, false)).toBe(false);
    });
    it(`mode='${mode}' with FORCE=1 still refuses manual rows`, () => {
      expect(
        shouldVisit("manual", "Operator-curated prose.", mode, true),
      ).toBe(false);
    });
  }

  it("legacy untagged rows with existing prose are NEVER overwritten in any mode", () => {
    for (const mode of MODES) {
      // The "force" lever IS allowed to re-evaluate untagged rows
      // (operator escape hatch), but the default sweep must respect
      // pre-source-tag operator work.
      expect(
        shouldVisit(undefined, "Pre-source-tag hand-written.", mode, false),
      ).toBe(false);
    }
  });
});
