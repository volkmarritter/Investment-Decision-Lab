// ----------------------------------------------------------------------------
// backfillRowRegex.test.ts — Task #253 pinning test
// ----------------------------------------------------------------------------
// Locks the contract that `ROW_RE` in scripts/backfill-comments.mjs matches
// EVERY canonical 2-space-indented INSTRUMENTS row in src/lib/etfs.ts.
//
// Background: Task #253 was triggered by the entire INSTRUMENTS table briefly
// regressing to 4-space indentation on a handful of rows (e.g.
// "IE000GA3D489", "IE00B53L3W79"). Because ROW_RE is anchored to the
// canonical 2-space layout, those rows silently dropped out of the
// candidate set — backfill became a no-op for them, and the
// backfillSourcePriority tests started failing in CI with
// `expected [] to deeply equal [ '<isin>' ]`.
//
// This test catches that class of drift before it reaches CI by:
//   1. Re-using the SAME `ROW_RE` exported from backfill-comments.mjs
//      (so tightening or loosening the regex flows here automatically).
//   2. Asserting it matches the expected number of top-level INSTRUMENTS
//      rows (the canonical 2-space `  "ISIN": I({ ... }),` shape) found
//      via a line-anchored counter.
//   3. Spot-checking the two ISINs that were victims of the original
//      regression so a future renaming or shape change can't silently
//      re-break them.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// @ts-expect-error - .mjs has no .d.ts; runtime import is fine.
import { __test } from "../scripts/backfill-comments.mjs";

const ROW_RE = __test.ROW_RE as RegExp;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ETFS_TS = resolve(__dirname, "../src/lib/etfs.ts");
const src = readFileSync(ETFS_TS, "utf8");

// Line-anchored counter — exactly the canonical top-level shape that
// admin mutators (`injectEntry`, `setBucketDefault`, etc.) and the
// backfill scripts target. NOT to be confused with `ROW_RE` itself,
// which is intentionally unanchored so it can be applied with `g`
// over the whole file.
const TOP_LEVEL_ROW_LINE_RE =
  /^ {2}"[A-Z]{2}[A-Z0-9]{9}\d":\s*I\(\{/gm;

describe("backfill-comments ROW_RE — pinning", () => {
  it("matches every canonical 2-space INSTRUMENTS row", () => {
    const expectedIsins = new Set(
      [...src.matchAll(TOP_LEVEL_ROW_LINE_RE)].map(
        (m) => m[0].match(/"([A-Z]{2}[A-Z0-9]{9}\d)"/)![1],
      ),
    );
    const matchedIsins = new Set(
      [...src.matchAll(ROW_RE)].map((m) => m[3]),
    );
    const missing = [...expectedIsins].filter((i) => !matchedIsins.has(i));
    expect(
      missing,
      `ROW_RE failed to match ${missing.length} canonical INSTRUMENTS row(s): ${missing.join(", ")}. ` +
        `Most common cause: an INSTRUMENTS row regressed to non-2-space indentation in src/lib/etfs.ts. ` +
        `Re-indent the offending row to the canonical "  \\"ISIN\\": I({ ... })," shape.`,
    ).toEqual([]);
    expect(expectedIsins.size).toBeGreaterThan(0);
  });

  it("matches the specific ISINs that triggered Task #253", () => {
    // Both rows have been victims of stray 4-space-indent regressions
    // in the past. Pin them by name so a future drift surfaces as a
    // targeted failure rather than a generic count mismatch.
    const matchedIsins = new Set(
      [...src.matchAll(ROW_RE)].map((m) => m[3]),
    );
    for (const isin of ["IE000GA3D489", "IE00B53L3W79"]) {
      expect(
        matchedIsins.has(isin),
        `ROW_RE must match the canonical "${isin}" row in src/lib/etfs.ts. ` +
          `If this fails, check the row's indentation — it should start with exactly 2 spaces.`,
      ).toBe(true);
    }
  });
});
