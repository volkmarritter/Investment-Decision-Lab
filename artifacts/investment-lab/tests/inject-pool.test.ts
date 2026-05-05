// ----------------------------------------------------------------------------
// inject-pool.test.ts
// ----------------------------------------------------------------------------
// Verifies the string-level mutation of the new BUCKETS[key].pool slot
// (Task #126 / Phase 2). Pool is the third per-bucket slot — separate
// from default and alternatives — and obeys strict global ISIN
// uniqueness across {default, alternative, pool} of every bucket.
//
// Status outcomes mapped to user-facing route errors:
//   - "ok"                  → pool gets the new ISIN
//   - "parent_missing"      → bucket key doesn't exist
//   - "instrument_missing"  → ISIN not yet in INSTRUMENTS (pool is
//                              attach-existing-only, no row creation)
//   - "isin_in_use"         → ISIN already lives somewhere — default,
//                              alt, or pool of any bucket
//   - "cap_exceeded"        → bucket already has MAX_POOL_PER_BUCKET
//                              entries
//
// Two structurally distinct injection paths the mutator must handle:
//   - The bucket already declares `pool: [...]` (append into array)
//   - The bucket has no `pool:` field yet (insert a new line just
//     before the closing `})`)
//
// removePool tests mirror removeAlternative — first/last/case-insensitive
// removal plus a not-found path. INSTRUMENTS row must remain intact.
//
// Cross-mutator regression: injectAlternative + setBucketDefault must
// also reject an ISIN that lives in some bucket's pool (Phase 2 of the
// global-uniqueness invariant).
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  injectPool,
  removePool,
  injectAlternative,
  setBucketDefault,
  type NewAlternativeEntry,
} from "../../api-server/src/lib/github";
import { parseBucketsFromSource } from "../../api-server/src/lib/catalog-parser";
import { MAX_POOL_PER_BUCKET } from "../../api-server/src/lib/limits";

// Compose a minimal but realistic INSTRUMENTS+BUCKETS source. Same
// shape as inject-alternative.test.ts's helper, with an optional
// `pool` per bucket so tests can exercise both the "insert new field"
// and "append into existing array" paths of injectPool.
function buildSource(opts: {
  instruments: Array<{
    isin: string;
    name: string;
    terBps?: number;
    ticker?: string;
    comment?: string;
  }>;
  buckets: Array<{
    key: string;
    default: string;
    alternatives: string[];
    pool?: string[];
  }>;
}): string {
  const instrumentRows = opts.instruments
    .map(
      (i) => `  "${i.isin}": I({
    name: ${JSON.stringify(i.name)},
    isin: "${i.isin}",
    terBps: ${i.terBps ?? 10},
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: ${JSON.stringify(i.comment ?? "Test instrument.")},
    listings: { LSE: { ticker: ${JSON.stringify(i.ticker ?? "TST")} } },
    defaultExchange: "LSE",
  }),`,
    )
    .join("\n");
  const bucketRows = opts.buckets
    .map((b) => {
      const lines = [
        `    default: "${b.default}",`,
        `    alternatives: [${b.alternatives.map((s) => `"${s}"`).join(", ")}],`,
      ];
      if (b.pool !== undefined) {
        lines.push(
          `    pool: [${b.pool.map((s) => `"${s}"`).join(", ")}],`,
        );
      }
      return `  "${b.key}": B({
${lines.join("\n")}
  }),`;
    })
    .join("\n");
  return `import { foo } from "./bar";
const I = (x: any) => x;
const B = (x: any) => x;

const INSTRUMENTS: Record<string, InstrumentRecord> = {
${instrumentRows}
};

const BUCKETS: Record<string, BucketAssignment> = {
${bucketRows}
};
`;
}

const NEW_ALT: NewAlternativeEntry = {
  name: "iShares MSCI ACWI UCITS",
  isin: "IE00B6R52259",
  terBps: 20,
  domicile: "Ireland",
  replication: "Physical (sampled)",
  distribution: "Accumulating",
  currency: "USD",
  comment: "Test.",
  listings: { LSE: { ticker: "SSAC" } },
  defaultExchange: "LSE",
};

describe("injectPool", () => {
  it("inserts a `pool: [...]` field into a bucket that has none", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI IMI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
        },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool).toEqual(["IE00BK5BQT80"]);
    // Default + alternatives must be left intact.
    expect(parsed["Equity-Global"].default).toBe("IE00B3YLTY66");
    expect(parsed["Equity-Global"].alternatives).toEqual([]);
  });

  it("appends to an existing `pool: [...]` array (single → two)", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI IMI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
        { isin: "IE00B5BMR087", name: "CSPX" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
          pool: ["IE00BK5BQT80"],
        },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00B5BMR087");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool).toEqual([
      "IE00BK5BQT80",
      "IE00B5BMR087",
    ]);
  });

  it("returns parent_missing when the bucket key doesn't exist", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "ACWI" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-Mars", "IE00B3YLTY66");
    expect(r.status).toBe("parent_missing");
    expect(r.content).toBe(src);
  });

  it("returns instrument_missing when ISIN is not in INSTRUMENTS", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "ACWI" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00BUNKNOWN0");
    expect(r.status).toBe("instrument_missing");
    expect(r.content).toBe(src);
  });

  it("returns isin_in_use when ISIN is the default of any bucket", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00B5BMR087", name: "CSPX" },
      ],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
        { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00B5BMR087");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-USA");
  });

  it("returns isin_in_use when ISIN is an alternative of any bucket", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
        { isin: "IE00B5BMR087", name: "CSPX" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: ["IE00BK5BQT80"],
        },
        { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-USA", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global alt 1");
  });

  it("returns isin_in_use when ISIN is already in some bucket's pool", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00B5BMR087", name: "CSPX" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
          pool: ["IE00BK5BQT80"],
        },
        { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-USA", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global pool 1");
  });

  it("returns isin_in_use when ISIN is already in the SAME bucket's pool", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
          pool: ["IE00BK5BQT80"],
        },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global pool 1");
  });

  it(`returns cap_exceeded when the bucket already has ${MAX_POOL_PER_BUCKET} pool entries`, () => {
    const fillerIsins = Array.from(
      { length: MAX_POOL_PER_BUCKET },
      (_, i) => `IE00POOL${String(i + 1).padStart(4, "0")}`,
    );
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
        ...fillerIsins.map((isin, i) => ({
          isin,
          name: `Pool Filler ${i + 1}`,
          ticker: `P${String(i + 1).padStart(2, "0")}`,
        })),
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
          pool: fillerIsins,
        },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("cap_exceeded");
    expect(r.content).toBe(src);
  });

  it("normalises ISIN comparison case-insensitively", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-Global", "ie00bk5bqt80");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool[0].toUpperCase()).toBe(
      "IE00BK5BQT80",
    );
  });

  it("produces output that round-trips through the parser cleanly", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = injectPool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(() => parseBucketsFromSource(r.content)).not.toThrow();
  });
});

describe("removePool", () => {
  const TWO_POOL = buildSource({
    instruments: [
      { isin: "IE00B3YLTY66", name: "ACWI" },
      { isin: "IE00BK5BQT80", name: "VWRA" },
      { isin: "IE00FFFFFFF1", name: "Filler" },
    ],
    buckets: [
      {
        key: "Equity-Global",
        default: "IE00B3YLTY66",
        alternatives: [],
        pool: ["IE00BK5BQT80", "IE00FFFFFFF1"],
      },
    ],
  });

  it("removes the only pool entry leaving an empty array", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: [],
          pool: ["IE00BK5BQT80"],
        },
      ],
    });
    const r = removePool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool).toEqual([]);
    expect(parsed["Equity-Global"].default).toBe("IE00B3YLTY66");
  });

  it("removes the first of two pool entries, keeping the second", () => {
    const r = removePool(TWO_POOL, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool).toEqual(["IE00FFFFFFF1"]);
  });

  it("removes the last of two pool entries, keeping the first", () => {
    const r = removePool(TWO_POOL, "Equity-Global", "IE00FFFFFFF1");
    expect(r.status).toBe("ok");
    const parsed = parseBucketsFromSource(r.content);
    expect(parsed["Equity-Global"].pool).toEqual(["IE00BK5BQT80"]);
  });

  it("normalises ISIN comparison case-insensitively", () => {
    const r = removePool(TWO_POOL, "Equity-Global", "ie00bk5bqt80");
    expect(r.status).toBe("ok");
  });

  it("returns parent_missing when the bucket doesn't exist", () => {
    const r = removePool(TWO_POOL, "Equity-Mars", "IE00BK5BQT80");
    expect(r.status).toBe("parent_missing");
    expect(r.content).toBe(TWO_POOL);
  });

  it("returns isin_not_found when the bucket has no pool field at all", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "ACWI" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = removePool(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("isin_not_found");
    expect(r.content).toBe(src);
  });

  it("returns isin_not_found when the ISIN isn't in the pool", () => {
    const r = removePool(TWO_POOL, "Equity-Global", "IE00BNONE9999");
    expect(r.status).toBe("isin_not_found");
    expect(r.content).toBe(TWO_POOL);
  });

  it("leaves the INSTRUMENTS row intact (deletion is a separate op)", () => {
    const r = removePool(TWO_POOL, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(r.content).toContain(`"IE00BK5BQT80": I({`);
  });
});

describe("cross-mutator pool uniqueness (Phase 2 invariant)", () => {
  // The strict-uniqueness rule "every ISIN lives in at most one bucket
  // slot of one bucket" must hold from EVERY mutator's direction. Phase
  // 1 (etfs.ts validateCatalog) catches it at runtime; Phase 2 catches
  // it pre-PR so the operator never opens a doomed PR.
  const SRC_WITH_POOL = buildSource({
    instruments: [
      { isin: "IE00B3YLTY66", name: "ACWI" },
      { isin: "IE00B5BMR087", name: "CSPX" },
      { isin: "IE00BK5BQT80", name: "VWRA" },
    ],
    buckets: [
      {
        key: "Equity-Global",
        default: "IE00B3YLTY66",
        alternatives: [],
        pool: ["IE00BK5BQT80"],
      },
      { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
    ],
  });

  it("injectAlternative refuses an ISIN that lives in some bucket's pool", () => {
    const r = injectAlternative(SRC_WITH_POOL, "Equity-USA", {
      ...NEW_ALT,
      isin: "IE00BK5BQT80", // already Equity-Global pool 1
    });
    expect(r.status).toBe("isin_present");
    expect(r.conflict).toBe("Equity-Global pool 1");
  });

  it("setBucketDefault refuses an ISIN that lives in some bucket's pool", () => {
    const r = setBucketDefault(SRC_WITH_POOL, "Equity-USA", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global pool 1");
  });
});
