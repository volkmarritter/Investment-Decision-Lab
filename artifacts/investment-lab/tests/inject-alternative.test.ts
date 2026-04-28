// ----------------------------------------------------------------------------
// inject-alternative.test.ts
// ----------------------------------------------------------------------------
// Verifies the string-level catalog mutation that adds a curated
// alternative under an existing bucket. Covers all 4 status outcomes
// the route handler maps to user-facing errors:
//   - "ok"               → injection succeeds, parser sees the new alt
//   - "parent_missing"   → caller passed a bucket key that doesn't exist
//   - "isin_present"     → ISIN already used by some default OR alt
//   - "cap_exceeded"     → parent already has 2 alts (the catalog cap)
//
// Plus the two structurally distinct injection paths:
//   - Append to an existing `alternatives: [...]` array
//   - Create a new `alternatives: [...]` field on a bucket that has none
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  injectAlternative,
  removeAlternative,
  type NewAlternativeEntry,
} from "../../api-server/src/lib/github";
import { parseCatalogFromSource } from "../../api-server/src/lib/catalog-parser";

const FIXTURE_WITH_ALTS = `const CATALOG: Record<string, ETFRecord> = {
  "Equity-Global": E({
    name: "SPDR MSCI ACWI IMI UCITS",
    isin: "IE00B3YLTY66",
    terBps: 17,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Single-fund global equity.",
    listings: { LSE: { ticker: "SPYI" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "Vanguard FTSE All-World UCITS",
        isin: "IE00BK5BQT80",
        terBps: 22,
        domicile: "Ireland",
        replication: "Physical (sampled)",
        distribution: "Accumulating",
        currency: "USD",
        comment: "Vanguard.",
        listings: { LSE: { ticker: "VWRA" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-USA": E({
    name: "iShares Core S&P 500 UCITS",
    isin: "IE00B5BMR087",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Largest S&P 500 UCITS.",
    listings: { LSE: { ticker: "CSPX" } },
    defaultExchange: "LSE",
  }),
};
`;

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
    // The pre-existing alternative must not be disturbed.
    expect(parsed["Equity-Global"].alternatives?.[0].isin).toBe(
      "IE00BK5BQT80",
    );
    // The parent's own ISIN/name must not be disturbed.
    expect(parsed["Equity-Global"].isin).toBe("IE00B3YLTY66");
    // Sibling buckets must not be disturbed.
    expect(parsed["Equity-USA"].isin).toBe("IE00B5BMR087");
  });

  it("creates a new alternatives field on a bucket that has none", () => {
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
    // The parent's own fields stay intact.
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

  it("returns cap_exceeded when parent already has 2 alternatives", () => {
    // Synthetic fixture with 2 existing alts under Equity-Global.
    const fixture2 = FIXTURE_WITH_ALTS.replace(
      "    ],\n  }),\n  \"Equity-USA\":",
      `      {
        name: "Filler Alt",
        isin: "IE00FFFFFFF1",
        terBps: 25,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment: "Filler.",
        listings: { LSE: { ticker: "FILL" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-USA":`,
    );
    const r = injectAlternative(fixture2, "Equity-Global", {
      ...NEW_ALT,
      isin: "IE00BNEW1234", // unique so we hit cap, not isin_present
    });
    expect(r.status).toBe("cap_exceeded");
    expect(r.content).toBe(fixture2);
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
    // A successful inject must produce source that the parser can fully
    // re-read — otherwise the next admin reload would show a corrupted
    // catalog and block further editing.
    const r = injectAlternative(FIXTURE_WITH_ALTS, "Equity-USA", {
      ...NEW_ALT,
      isin: "IE00BFMXXD54",
    });
    expect(r.status).toBe("ok");
    expect(() => parseCatalogFromSource(r.content)).not.toThrow();
  });
});

describe("removeAlternative", () => {
  // Two-alt fixture so we can prove we cleanly remove the first vs the
  // last vs the middle without disturbing siblings.
  const TWO_ALTS = FIXTURE_WITH_ALTS.replace(
    "    ],\n  }),\n  \"Equity-USA\":",
    `      {
        name: "Filler Alt",
        isin: "IE00FFFFFFF1",
        terBps: 25,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment: "Filler.",
        listings: { LSE: { ticker: "FILL" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-USA":`,
  );

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

  it("returns isin_not_found when the bucket has no alternatives field", () => {
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

  it("does not match an ISIN that appears only inside a comment", () => {
    // A comment containing the target ISIN must not trick the walker
    // into picking the wrong block. Without the string/comment-aware
    // skipping in the array walker this test would silently delete the
    // first alt instead of refusing to find a match.
    const tricky = FIXTURE_WITH_ALTS.replace(
      `comment: "Vanguard.",`,
      `comment: "see also IE00BTRICKY01 in docs",`,
    );
    const r = removeAlternative(tricky, "Equity-Global", "IE00BTRICKY01");
    expect(r.status).toBe("isin_not_found");
    expect(r.content).toBe(tricky);
  });

  it("produces output that round-trips through the parser cleanly", () => {
    const r = removeAlternative(TWO_ALTS, "Equity-Global", "IE00BK5BQT80");
    expect(r.status).toBe("ok");
    expect(() => parseCatalogFromSource(r.content)).not.toThrow();
  });
});
