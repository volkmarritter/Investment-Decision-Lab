// ----------------------------------------------------------------------------
// changesShimExpand.test.ts — Task #207 round 4
// ----------------------------------------------------------------------------
// Pin the back-compat contract for the /admin/changes adapter: the
// auto-description-refresh writer (scripts/backfill-comments.mjs) emits a
// single line per touched ISIN with `changes:[{field,before,after},…]`,
// but the admin client (DataUpdates.tsx + ChangeEntry type) still expects
// the legacy per-field flat shape. The shim must expand the new shape
// into the legacy one without dropping the timestamp/source/isin scope.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { expandChangeRecord } from "../../api-server/src/lib/changes-shim";

describe("expandChangeRecord — refresh-changes.log compat shim", () => {
  it("returns legacy per-field rows verbatim", () => {
    const legacy = {
      ts: "2026-05-08T07:00:00.000Z",
      source: "lookthrough",
      isin: "IE00B5BMR087",
      field: "topHoldings",
      before: null,
      after: ["X", "Y"],
    };
    expect(expandChangeRecord(legacy)).toEqual([legacy]);
  });

  it("expands {timestamp,source,isin,changes:[…]} into one row per field", () => {
    const out = expandChangeRecord({
      timestamp: "2026-05-08T07:00:00.000Z",
      source: "auto-description-refresh",
      mode: "lookthrough-refresh",
      isin: "IE00B5BMR087",
      changes: [
        { field: "comment", before: null, after: "EN prose." },
        { field: "commentDe", before: null, after: "DE-Prosa." },
        { field: "commentSource", before: null, after: "auto" },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      ts: "2026-05-08T07:00:00.000Z",
      source: "auto-description-refresh",
      isin: "IE00B5BMR087",
      field: "comment",
      before: null,
      after: "EN prose.",
    });
    expect((out[2] as { field: string }).field).toBe("commentSource");
  });

  it("falls back to ts when timestamp is absent (transitional records)", () => {
    const [row] = expandChangeRecord({
      ts: "2026-05-08T07:00:00.000Z",
      source: "auto-description-refresh",
      isin: "IE00B5BMR087",
      changes: [{ field: "comment", before: null, after: "x" }],
    }) as Array<{ ts: string }>;
    expect(row.ts).toBe("2026-05-08T07:00:00.000Z");
  });

  it("tolerates malformed entries (missing isin/source/field)", () => {
    const [row] = expandChangeRecord({
      changes: [{ before: null, after: 1 }],
    }) as Array<{ source: string; isin: string; field: string }>;
    expect(row.source).toBe("unknown");
    expect(row.isin).toBe("");
    expect(row.field).toBe("");
  });

  it("returns [] for non-object input", () => {
    expect(expandChangeRecord(null)).toEqual([]);
    expect(expandChangeRecord("not-json")).toEqual([]);
    expect(expandChangeRecord(42)).toEqual([]);
  });
});
