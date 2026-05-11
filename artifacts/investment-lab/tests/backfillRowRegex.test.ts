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

// Indent-AGNOSTIC enumerator — matches an INSTRUMENTS row opener at
// ANY leading-whitespace level (`^ +`, not `^ {2}`). This is the
// crucial difference from the regex used inside ROW_RE itself: by
// counting expected rows without committing to a specific indent
// width, we can detect rows that have drifted away from the
// canonical 2-space layout. A drifted row (opener at 4 or 6 spaces,
// closer at 2) parses as TS just fine but is silently skipped by
// ROW_RE because of its `\2` opener/closer-symmetry backreference,
// so the previous version of this test (which itself anchored on
// 2 spaces) had the same blind spot as the production regex and
// missed the 8-row drift fixed in the 2026-05 follow-up to #275.
//
// `\s*I\(\{` keeps the match scoped to INSTRUMENTS rows — BUCKETS
// values are `BucketAssignment` object literals, not `I({...})`
// invocations, so they cannot collide with this enumerator.
const TOP_LEVEL_ROW_LINE_RE =
  /^ +"[A-Z]{2}[A-Z0-9]{9}\d":\s*I\(\{/gm;

const CANONICAL_INDENT = 2;

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

  it("rejects any INSTRUMENTS row whose opener has drifted away from the canonical 2-space indent", () => {
    // Targeted drift detector — the failing message names the offending
    // ISIN(s) and indent width so the operator can re-indent in seconds
    // instead of bisecting the file. This is the guardrail for Task
    // #275's follow-up: a row written with 4/6/8-space opener but
    // 2-space closer parses as TS and renders correctly in the app, so
    // none of the engine/UI tests catch it — but the nightly backfill
    // step silently skips it because ROW_RE's `\2` backreference
    // requires opener/closer indent symmetry, meaning its
    // comment/commentDe never refresh again. Surface it here at CI
    // time, before the merge, instead of in the next monthly snapshot.
    const drifted: Array<{ isin: string; indent: number }> = [];
    for (const m of src.matchAll(TOP_LEVEL_ROW_LINE_RE)) {
      const indent = m[0].match(/^ +/)![0].length;
      if (indent !== CANONICAL_INDENT) {
        const isin = m[0].match(/"([A-Z]{2}[A-Z0-9]{9}\d)"/)![1];
        drifted.push({ isin, indent });
      }
    }
    expect(
      drifted,
      `Found ${drifted.length} INSTRUMENTS row(s) with non-canonical indent in src/lib/etfs.ts:\n` +
        drifted.map((d) => `  - ${d.isin} (opener at ${d.indent} spaces, expected ${CANONICAL_INDENT})`).join("\n") +
        `\nFix: open src/lib/etfs.ts and dedent each listed row's "  \\"<ISIN>\\": I({" line ` +
        `to exactly ${CANONICAL_INDENT} leading spaces. The closing "}),"  must already be at ${CANONICAL_INDENT} spaces.`,
    ).toEqual([]);
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
