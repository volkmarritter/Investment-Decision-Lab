// ----------------------------------------------------------------------------
// refreshLookthroughOrphans.test.ts
// ----------------------------------------------------------------------------
// Task #122 (T005) — INSTRUMENTS-as-allowlist guards in
// scripts/refresh-lookthrough.mjs. Two pure helpers are exercised:
//
//   • validateExplicitTargets(targets, instrumentSet)
//       Used by main() to refuse a CLI run that names an ISIN with no
//       INSTRUMENTS row. Returns the offending ISINs; main() exits 1.
//
//   • pruneNonInstrumentsKeys(map, instrumentSet)
//       Used by main() on every full refresh to drop pre-existing
//       pool/override entries whose ISIN no longer matches INSTRUMENTS.
//       Returns { kept, orphans } so main() can both rewrite the JSON
//       and log the dropped names.
//
// Both helpers are pure; no network, no file I/O.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs sibling has no .d.ts; we only need the runtime
// shape here, and the TS strict checker accepts the import for tsc-noEmit
// purposes via Node ESM resolution.
import {
  validateExplicitTargets,
  pruneNonInstrumentsKeys,
} from "../scripts/refresh-lookthrough.mjs";

const REGISTERED = new Set(["IE00B4L5YX21", "IE00B5BMR087", "CH0237935652"]);

describe("validateExplicitTargets", () => {
  it("returns no offending ISINs when every target is registered", () => {
    expect(
      validateExplicitTargets(["IE00B4L5YX21", "IE00B5BMR087"], REGISTERED),
    ).toEqual([]);
  });

  it("returns the offending ISIN(s) when one or more are not registered", () => {
    const offending = validateExplicitTargets(
      ["IE00B4L5YX21", "IE0000000ZOMB", "IE0000000DEAD"],
      REGISTERED,
    );
    expect(offending).toEqual(["IE0000000ZOMB", "IE0000000DEAD"]);
  });

  it("treats an empty target list as no-op", () => {
    expect(validateExplicitTargets([], REGISTERED)).toEqual([]);
  });
});

describe("pruneNonInstrumentsKeys", () => {
  it("keeps every entry whose ISIN is registered", () => {
    const input = {
      IE00B4L5YX21: { topHoldings: [] },
      IE00B5BMR087: { geo: { US: 0.5 } },
    };
    const { kept, orphans } = pruneNonInstrumentsKeys(input, REGISTERED);
    expect(orphans).toEqual([]);
    expect(Object.keys(kept).sort()).toEqual([
      "IE00B4L5YX21",
      "IE00B5BMR087",
    ]);
    // Values are passed through untouched so the rest of main()'s
    // shallow-merge sees the same object identity it had before.
    expect(kept.IE00B5BMR087).toBe(input.IE00B5BMR087);
  });

  it("drops orphan entries and reports their ISINs in the orphans list", () => {
    const input = {
      IE00B4L5YX21: { topHoldings: [] },
      IE0000000ZOMB: { geo: { XX: 1 } },
      LU0000000DEAD: { topHoldings: [] },
    };
    const { kept, orphans } = pruneNonInstrumentsKeys(input, REGISTERED);
    expect(Object.keys(kept)).toEqual(["IE00B4L5YX21"]);
    expect(orphans.sort()).toEqual(["IE0000000ZOMB", "LU0000000DEAD"]);
  });

  it("handles empty / undefined maps gracefully", () => {
    expect(pruneNonInstrumentsKeys({}, REGISTERED)).toEqual({
      kept: {},
      orphans: [],
    });
    expect(pruneNonInstrumentsKeys(undefined as unknown as Record<string, unknown>, REGISTERED)).toEqual({
      kept: {},
      orphans: [],
    });
  });
});
