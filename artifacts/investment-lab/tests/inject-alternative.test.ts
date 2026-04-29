// ----------------------------------------------------------------------------
// inject-alternative.test.ts
// ----------------------------------------------------------------------------
// Verifies the string-level mutation of the new INSTRUMENTS+BUCKETS
// catalog model (Task #111). The four status outcomes the route handler
// maps to user-facing errors are:
//   - "ok"             → injection succeeds, parser sees the new alt
//   - "parent_missing" → caller passed a bucket key that doesn't exist
//   - "isin_present"   → ISIN already used by some default OR alt
//   - "cap_exceeded"   → parent already has MAX_ALTERNATIVES_PER_BUCKET alts
//
// Two structurally distinct injection paths:
//   - Append to an existing non-empty alternatives array
//   - Insert into an empty alternatives array (`[]` → `["NEW"]`)
//
// In the new model alternatives in BUCKETS are bare ISIN strings; the
// metadata (name, listings, terBps, …) lives once in INSTRUMENTS. The
// injector therefore ALSO appends a fresh INSTRUMENTS row when the ISIN
// isn't yet in the registry.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  injectAlternative,
  removeAlternative,
  setBucketDefault,
  type NewAlternativeEntry,
} from "../../api-server/src/lib/github";
import { parseCatalogFromSource } from "../../api-server/src/lib/catalog-parser";
import { MAX_ALTERNATIVES_PER_BUCKET } from "../../api-server/src/lib/limits";

// Compose a minimal but realistic INSTRUMENTS+BUCKETS source. Exposed as a
// helper so the cap-exceeded test can synthesise a wider INSTRUMENTS table
// without copy-pasting the catalog headers each time.
function buildSource(opts: {
  instruments: Array<{
    isin: string;
    name: string;
    terBps?: number;
    ticker?: string;
    comment?: string;
  }>;
  buckets: Array<{ key: string; default: string; alternatives: string[] }>;
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
    .map(
      (b) =>
        `  "${b.key}": B({
    default: "${b.default}",
    alternatives: [${b.alternatives.map((s) => `"${s}"`).join(", ")}],
  }),`,
    )
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

const FIXTURE_WITH_ALTS = buildSource({
  instruments: [
    {
      isin: "IE00B3YLTY66",
      name: "SPDR MSCI ACWI IMI UCITS",
      terBps: 17,
      ticker: "SPYI",
      comment: "Single-fund global equity.",
    },
    {
      isin: "IE00BK5BQT80",
      name: "Vanguard FTSE All-World UCITS",
      terBps: 22,
      ticker: "VWRA",
      comment: "Vanguard.",
    },
    {
      isin: "IE00B5BMR087",
      name: "iShares Core S&P 500 UCITS",
      terBps: 7,
      ticker: "CSPX",
      comment: "Largest S&P 500 UCITS.",
    },
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

const NEW_ALT: NewAlternativeEntry = {
  name: "iShares MSCI ACWI UCITS",
  isin: "IE00B6R52259",
  terBps: 20,
  domicile: "Ireland",
  replication: "Physical (sampled)",
  distribution: "Accumulating",
  currency: "USD",
  comment: "MSCI ACWI parent index.",
  listings: { LSE: { ticker: "SSAC" } },
  defaultExchange: "LSE",
};

describe("injectAlternative", () => {
  it("appends to an existing alternatives array (single → two alts)", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-Global", NEW_ALT);
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-Global"].alternatives?.length).toBe(2);
    expect(parsed["Equity-Global"].alternatives?.[1].isin).toBe(
      "IE00B6R52259",
    );
    // Existing alt must not be disturbed.
    expect(parsed["Equity-Global"].alternatives?.[0].isin).toBe(
      "IE00BK5BQT80",
    );
    // Parent's own ISIN/name must not be disturbed.
    expect(parsed["Equity-Global"].isin).toBe("IE00B3YLTY66");
    // Sibling bucket must not be disturbed.
    expect(parsed["Equity-USA"].isin).toBe("IE00B5BMR087");
    // The newly inserted alternative resolves to its INSTRUMENTS row, so
    // the joined view carries the full metadata (not just the bare ISIN).
    expect(parsed["Equity-Global"].alternatives?.[1].name).toBe(
      "iShares MSCI ACWI UCITS",
    );
  });

  it("inserts into an empty alternatives array (`[]` → `[\"NEW\"]`)", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-USA", {
      ...NEW_ALT,
      name: "Vanguard S&P 500 UCITS",
      isin: "IE00BFMXXD54",
      listings: { LSE: { ticker: "VUAA" } },
    });
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-USA"].alternatives?.length).toBe(1);
    expect(parsed["Equity-USA"].alternatives?.[0].isin).toBe("IE00BFMXXD54");
    // Parent's own fields stay intact.
    expect(parsed["Equity-USA"].isin).toBe("IE00B5BMR087");
    expect(parsed["Equity-USA"].name).toBe("iShares Core S&P 500 UCITS");
  });

  it("returns parent_missing when the bucket key doesn't exist", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-Mars", NEW_ALT);
    expect(r.status).toBe("parent_missing");
    expect(r.content).toBe(FIXTURE_WITH_ALTS);
  });

  it("returns isin_present when ISIN matches an existing default", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-Global", {
      ...NEW_ALT,
      isin: "IE00B5BMR087", // already the Equity-USA default
    });
    expect(r.status).toBe("isin_present");
    expect(r.conflict).toBe("Equity-USA");
  });

  it("returns isin_present when ISIN matches an existing alternative", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-USA", {
      ...NEW_ALT,
      isin: "IE00BK5BQT80", // already the Equity-Global alt 1
    });
    expect(r.status).toBe("isin_present");
    expect(r.conflict).toMatch(/^Equity-Global alt 1$/);
  });

  it(`returns cap_exceeded when parent already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives`, () => {
    // Synthesise a fixture where Equity-Global is filled to the cap. The
    // INSTRUMENTS table must carry rows for every referenced ISIN so the
    // global-uniqueness pre-flight (which parses INSTRUMENTS+BUCKETS) sees
    // them as legitimate prior assignments.
    const fillerIsins = Array.from(
      { length: MAX_ALTERNATIVES_PER_BUCKET },
      (_, i) => `IE00FFFFFF${String(i + 1).padStart(2, "0")}`,
    );
    const fixtureFull = buildSource({
      instruments: [
        {
          isin: "IE00B3YLTY66",
          name: "Default Global",
          ticker: "SPYI",
        },
        {
          isin: "IE00B5BMR087",
          name: "iShares Core S&P 500 UCITS",
          ticker: "CSPX",
        },
        ...fillerIsins.map((isin, i) => ({
          isin,
          name: `Filler Alt ${i + 1}`,
          ticker: `F${String(i + 1).padStart(2, "0")}`,
        })),
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: fillerIsins,
        },
        { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
      ],
    });
    const r = injectAlternative(fixtureFull, "Equity-Global", {
      ...NEW_ALT,
      isin: "IE00BNEW1234", // unique so we hit cap, not isin_present
    });
    expect(r.status).toBe("cap_exceeded");
    expect(r.content).toBe(fixtureFull);
  });

  it("normalises ISIN comparison case-insensitively", () => {
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-Global", {
      ...NEW_ALT,
      isin: "ie00b5bmr087", // lower-case version of Equity-USA's default
    });
    expect(r.status).toBe("isin_present");
    expect(r.conflict).toBe("Equity-USA");
  });

  it("produces output that round-trips through the parser cleanly", () => {
    // A successful inject must produce source the parser can fully re-read
    // — otherwise the next admin reload would show a corrupted catalog
    // and block further editing.
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-USA", {
      ...NEW_ALT,
      isin: "IE00BFMXXD54",
    });
    expect(r.status).toBe("ok");
    expect(() => parseCatalogFromSource(r.content)).not.toThrow();
  });

  it("appends a fresh INSTRUMENTS row when the ISIN isn't in the registry yet", () => {
    // Task #111 invariant: INSTRUMENTS owns the per-fund metadata and
    // every alternative ISIN string in BUCKETS must resolve to a row.
    // The injector creates that row from the entry's metadata when needed.
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-Global", NEW_ALT);
    expect(r.status).toBe("ok");
    expect(r.content).toContain(`"${NEW_ALT.isin}": I({`);
    expect(r.content).toContain(`name: ${JSON.stringify(NEW_ALT.name)}`);
  });
});

describe("removeAlternative", () => {
  // Two-alt fixture so we can prove we cleanly remove the first vs the
  // last without disturbing siblings.
  const TWO_ALTS = buildSource({
    instruments: [
      {
        isin: "IE00B3YLTY66",
        name: "SPDR MSCI ACWI IMI UCITS",
        terBps: 17,
        ticker: "SPYI",
      },
      {
        isin: "IE00BK5BQT80",
        name: "Vanguard FTSE All-World UCITS",
        terBps: 22,
        ticker: "VWRA",
      },
      {
        isin: "IE00FFFFFFF1",
        name: "Filler Alt",
        terBps: 25,
        ticker: "FILL",
      },
      {
        isin: "IE00B5BMR087",
        name: "iShares Core S&P 500 UCITS",
        terBps: 7,
        ticker: "CSPX",
      },
    ],
    buckets: [
      {
        key: "Equity-Global",
        default: "IE00B3YLTY66",
        alternatives: ["IE00BK5BQT80", "IE00FFFFFFF1"],
      },
      { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
    ],
  });

  it("removes the only alternative from a single-alt bucket", () => {
    const r = removeAlternative(
      FIXTURE_WITH_ALTS,
      "Equity-Global",
      "IE00BK5BQT80",
    );
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    // Bucket itself stays intact.
    expect(parsed["Equity-Global"].isin).toBe("IE00B3YLTY66");
    expect(parsed["Equity-Global"].name).toContain("SPDR");
    // Alternatives are now empty (or undefined — both mean "no alts left").
    const alts = parsed["Equity-Global"].alternatives ?? [];
    expect(alts.length).toBe(0);
    // Sibling bucket untouched.
    expect(parsed["Equity-USA"].isin).toBe("IE00B5BMR087");
  });

  it("removes the first of two alternatives, keeping the second", () => {
    const r = removeAlternative(TWO_ALTS, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-Global"].alternatives?.length).toBe(1);
    expect(parsed["Equity-Global"].alternatives?.[0].isin).toBe(
      "IE00FFFFFFF1",
    );
  });

  it("removes the last of two alternatives, keeping the first", () => {
    const r = removeAlternative(TWO_ALTS, "Equity-Global", "IE00FFFFFFF1");
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-Global"].alternatives?.length).toBe(1);
    expect(parsed["Equity-Global"].alternatives?.[0].isin).toBe(
      "IE00BK5BQT80",
    );
  });

  it("normalises ISIN comparison case-insensitively", () => {
    const r = removeAlternative(
      FIXTURE_WITH_ALTS,
      "Equity-Global",
      "ie00bk5bqt80",
    );
    expect(r.status).toBe("ok");
  });

  it("returns parent_missing when the bucket key doesn't exist", () => {
    const r = removeAlternative(
      FIXTURE_WITH_ALTS,
      "Equity-Mars",
      "IE00BK5BQT80",
    );
    expect(r.status).toBe("parent_missing");
    expect(r.content).toBe(FIXTURE_WITH_ALTS);
  });

  it("returns isin_not_found when the bucket has no matching alternative", () => {
    // Equity-USA has alternatives: [] — the ISIN simply isn't there.
    const r = removeAlternative(
      FIXTURE_WITH_ALTS,
      "Equity-USA",
      "IE00BK5BQT80",
    );
    expect(r.status).toBe("isin_not_found");
    expect(r.content).toBe(FIXTURE_WITH_ALTS);
  });

  it("returns isin_not_found when the ISIN is not among the alternatives", () => {
    const r = removeAlternative(
      FIXTURE_WITH_ALTS,
      "Equity-Global",
      "IE00BNONE9999",
    );
    expect(r.status).toBe("isin_not_found");
    expect(r.content).toBe(FIXTURE_WITH_ALTS);
  });

  it("leaves the INSTRUMENTS row intact (deletion is a separate operation)", () => {
    // Removing an alternative slot must NOT touch the master INSTRUMENTS
    // table — an instrument may be referenced by another bucket, and
    // even when orphaned, its deletion is an explicit operator action.
    const r = removeAlternative(TWO_ALTS, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(r.content).toContain(`"IE00BK5BQT80": I({`);
  });

  it("produces output that round-trips through the parser cleanly", () => {
    const r = removeAlternative(TWO_ALTS, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(() => parseCatalogFromSource(r.content)).not.toThrow();
  });
});

describe("setBucketDefault", () => {
  // The mutator must enforce strict global ISIN uniqueness — the new
  // default cannot already live in another bucket as default OR alt,
  // AND it cannot already live inside the SAME bucket as an alternative
  // (that would create a within-bucket duplicate). The instrument must
  // also already exist in the INSTRUMENTS table.
  it("swaps the default to a registered, unassigned ISIN", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI IMI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
        { isin: "IE00B5BMR087", name: "CSPX" },
      ],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
        { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
      ],
    });
    const r = setBucketDefault(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-Global"].isin).toBe("IE00BK5BQT80");
  });

  it("returns parent_missing when the bucket key doesn't exist", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "X" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = setBucketDefault(src, "Does-Not-Exist", "IE00B3YLTY66");
    expect(r.status).toBe("parent_missing");
  });

  it("returns instrument_missing when the ISIN isn't in INSTRUMENTS", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "X" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = setBucketDefault(src, "Equity-Global", "IE00BUNKNOWN0");
    expect(r.status).toBe("instrument_missing");
  });

  it("returns default_unchanged when the ISIN already is the default", () => {
    const src = buildSource({
      instruments: [{ isin: "IE00B3YLTY66", name: "X" }],
      buckets: [
        { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
      ],
    });
    const r = setBucketDefault(src, "Equity-Global", "IE00B3YLTY66");
    expect(r.status).toBe("default_unchanged");
  });

  it("returns isin_in_use when the ISIN is the default of another bucket", () => {
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
    const r = setBucketDefault(src, "Equity-Global", "IE00B5BMR087");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-USA");
  });

  it("returns isin_in_use when the ISIN is an alternative of another bucket", () => {
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
    const r = setBucketDefault(src, "Equity-USA", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global alt 1");
  });

  // Regression — within-bucket duplicate. Before the fix, swapping the
  // default into an ISIN that already lived as an alternative of the
  // SAME bucket was allowed, producing { default: X, alternatives: [X] }.
  // The mutator must refuse this; operator must detach the alt first.
  it("returns isin_in_use when target ISIN is an alternative of the SAME bucket", () => {
    const src = buildSource({
      instruments: [
        { isin: "IE00B3YLTY66", name: "ACWI" },
        { isin: "IE00BK5BQT80", name: "VWRA" },
      ],
      buckets: [
        {
          key: "Equity-Global",
          default: "IE00B3YLTY66",
          alternatives: ["IE00BK5BQT80"],
        },
      ],
    });
    const r = setBucketDefault(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("isin_in_use");
    expect(r.conflict).toBe("Equity-Global alt 1");
    // Catalog source must be untouched on failure.
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
    const r = setBucketDefault(src, "Equity-Global", "ie00bk5bqt80");
    expect(r.status).toBe("ok");
    const parsed = parseCatalogFromSource(r.content);
    expect(parsed["Equity-Global"].isin.toUpperCase()).toBe("IE00BK5BQT80");
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
    const r = setBucketDefault(src, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(() => parseCatalogFromSource(r.content)).not.toThrow();
  });
});
