// Tests for the api-server's catalog-parser. Lives here (under
// investment-lab/tests) because vitest is already wired up here and the
// parser is dep-free, so cross-artifact import is harmless.
//
// Goal: lock in the field-extraction shape of the new INSTRUMENTS+BUCKETS
// data model (Task #111) so a future edit of etfs.ts can't silently
// break the admin pane's replace-vs-add diff. A parser regression would
// manifest as "every key looks NEW" — the worst kind of silent bug
// because the operator would happily open PRs that silently overwrite
// existing entries.

import { describe, it, expect } from "vitest";
import {
  findDuplicateIsinKey,
  findMatchingClose,
  parseCatalogFromSource,
} from "../../api-server/src/lib/catalog-parser";

// Compose a minimal but realistic INSTRUMENTS+BUCKETS source. Tests
// override the per-instrument or per-bucket details they care about.
function buildSource(opts: {
  instruments: Array<{
    isin: string;
    name: string;
    terBps?: number;
    domicile?: string;
    replication?: string;
    distribution?: string;
    currency?: string;
    comment?: string;
    listings?: string; // raw inline literal, e.g. `{ LSE: { ticker: "X" } }`
    defaultExchange?: string;
    extraLines?: string[]; // optional fields like aumMillionsEUR
  }>;
  buckets: Array<{ key: string; default: string; alternatives: string[] }>;
}): string {
  const instrumentRows = opts.instruments
    .map((i) => {
      const extras = (i.extraLines ?? [])
        .map((l) => `    ${l}`)
        .join("\n");
      return `  ${JSON.stringify(i.isin)}: I({
    name: ${JSON.stringify(i.name)},
    isin: ${JSON.stringify(i.isin)},
    terBps: ${i.terBps ?? 10},
    domicile: ${JSON.stringify(i.domicile ?? "Ireland")},
    replication: ${JSON.stringify(i.replication ?? "Physical")},
    distribution: ${JSON.stringify(i.distribution ?? "Accumulating")},
    currency: ${JSON.stringify(i.currency ?? "USD")},
    comment: ${JSON.stringify(i.comment ?? "Test instrument.")},
    listings: ${i.listings ?? `{ LSE: { ticker: "TST" } }`},
    defaultExchange: ${JSON.stringify(i.defaultExchange ?? "LSE")},${
      extras ? `\n${extras}` : ""
    }
  }),`;
    })
    .join("\n");
  const bucketRows = opts.buckets
    .map(
      (b) => `  ${JSON.stringify(b.key)}: B({
    default: ${JSON.stringify(b.default)},
    alternatives: [${b.alternatives.map((s) => JSON.stringify(s)).join(", ")}],
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

const SAMPLE = buildSource({
  instruments: [
    {
      isin: "IE00B3YLTY66",
      name: "SPDR MSCI ACWI IMI UCITS",
      terBps: 17,
      replication: "Physical (sampled)",
      comment: "Single-fund global equity.",
      listings: `{ LSE: { ticker: "SPYI" }, XETRA: { ticker: "SPYI" } }`,
    },
    {
      isin: "IE00B5BMR087",
      name: "iShares Core S&P 500 UCITS",
      terBps: 7,
      comment: "Largest, most liquid S&P 500 UCITS.",
      listings: `{ LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" } }`,
      extraLines: [`aumMillionsEUR: 80000,`, `inceptionDate: "2010-05-19",`],
    },
  ],
  buckets: [
    { key: "Equity-Global", default: "IE00B3YLTY66", alternatives: [] },
    { key: "Equity-USA", default: "IE00B5BMR087", alternatives: [] },
  ],
});

describe("parseCatalogFromSource", () => {
  it("extracts every bucket by key", () => {
    const out = parseCatalogFromSource(SAMPLE);
    expect(Object.keys(out).sort()).toEqual(["Equity-Global", "Equity-USA"]);
  });

  it("populates required string + number fields from INSTRUMENTS", () => {
    const out = parseCatalogFromSource(SAMPLE);
    const usa = out["Equity-USA"];
    expect(usa.key).toBe("Equity-USA");
    expect(usa.name).toBe("iShares Core S&P 500 UCITS");
    expect(usa.isin).toBe("IE00B5BMR087");
    expect(usa.terBps).toBe(7);
    expect(usa.domicile).toBe("Ireland");
    expect(usa.replication).toBe("Physical");
    expect(usa.distribution).toBe("Accumulating");
    expect(usa.currency).toBe("USD");
    expect(usa.comment).toBe("Largest, most liquid S&P 500 UCITS.");
    expect(usa.defaultExchange).toBe("LSE");
  });

  it("parses listings as a per-exchange ticker map", () => {
    const out = parseCatalogFromSource(SAMPLE);
    expect(out["Equity-Global"].listings).toEqual({
      LSE: { ticker: "SPYI" },
      XETRA: { ticker: "SPYI" },
    });
  });

  it("captures optional aumMillionsEUR / inceptionDate when present", () => {
    const out = parseCatalogFromSource(SAMPLE);
    expect(out["Equity-USA"].aumMillionsEUR).toBe(80000);
    expect(out["Equity-USA"].inceptionDate).toBe("2010-05-19");
  });

  it("leaves optional fields undefined when omitted", () => {
    const out = parseCatalogFromSource(SAMPLE);
    expect(out["Equity-Global"].aumMillionsEUR).toBeUndefined();
    expect(out["Equity-Global"].inceptionDate).toBeUndefined();
  });

  it("throws if the INSTRUMENTS marker is missing", () => {
    expect(() => parseCatalogFromSource("// nothing here\n")).toThrow();
  });

  it("parses listings written with QUOTED keys (the renderer's output style)", () => {
    // renderInstrumentRow emits `"LSE": { ticker: "..." }` via JSON.stringify.
    // The parser must accept that round-trip — otherwise REPLACE diffs of
    // PR-generated entries would always show "current listings: —".
    const src = buildSource({
      instruments: [
        {
          isin: "IE00BBBBBBB1",
          name: "Bot ETF",
          terBps: 8,
          comment: "Generated by the renderer.",
          listings: `{ "LSE": { ticker: "BOT" }, "XETRA": { ticker: "BTX" } }`,
        },
      ],
      buckets: [{ key: "Equity-Bot", default: "IE00BBBBBBB1", alternatives: [] }],
    });
    const out = parseCatalogFromSource(src);
    expect(out["Equity-Bot"].listings).toEqual({
      LSE: { ticker: "BOT" },
      XETRA: { ticker: "BTX" },
    });
  });

  it("does not get confused by literal braces inside string fields", () => {
    // JSON.stringify does NOT escape `{` or `}`, so a future comment
    // containing braces must NOT corrupt brace-counting. Without
    // string-aware walking the parser would either truncate the entry
    // or skip the entry that follows.
    const src = buildSource({
      instruments: [
        {
          isin: "IE00TRICKY001",
          name: "Tricky { Equity }",
          terBps: 9,
          comment: "Has } and { in it",
          listings: `{ LSE: { ticker: "TRK" } }`,
        },
        {
          isin: "IE00AFTER0001",
          name: "After Tricky",
          terBps: 10,
          comment: "I should still parse.",
          listings: `{ LSE: { ticker: "AFT" } }`,
        },
      ],
      buckets: [
        { key: "Equity-Tricky", default: "IE00TRICKY001", alternatives: [] },
        { key: "Equity-After", default: "IE00AFTER0001", alternatives: [] },
      ],
    });
    const out = parseCatalogFromSource(src);
    expect(Object.keys(out).sort()).toEqual(["Equity-After", "Equity-Tricky"]);
    expect(out["Equity-Tricky"].name).toBe("Tricky { Equity }");
    expect(out["Equity-After"].isin).toBe("IE00AFTER0001");
  });

  it("findMatchingClose treats string contents as opaque", () => {
    const src = '{ a: "} extra {", b: { c: 1 } }';
    const close = findMatchingClose(src, 0);
    expect(close).toBe(src.length - 1);
  });

  it("findMatchingClose skips line and block comments", () => {
    const src = "{ a: 1, // }\n /* } */ b: 2 }";
    const close = findMatchingClose(src, 0);
    expect(close).toBe(src.length - 1);
  });

  it('findMatchingClose handles "//" inside a string literal (URL case)', () => {
    // Belt-and-braces: strings are processed BEFORE the comment token,
    // so `https://...` inside a quoted value must not start a line
    // comment that would swallow the closing brace on the same line.
    const src = '{ url: "https://example.com/path//x" }';
    const close = findMatchingClose(src, 0);
    expect(close).toBe(src.length - 1);
  });

  describe("findDuplicateIsinKey", () => {
    const catalog = {
      "Equity-USA": {
        key: "Equity-USA",
        name: "S&P 500",
        isin: "IE00B5BMR087",
        terBps: 7,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment: "",
        listings: { LSE: { ticker: "CSPX" } },
        defaultExchange: "LSE",
      },
    };

    it("returns the conflicting key when ISIN is taken under a different key", () => {
      expect(findDuplicateIsinKey(catalog, "Equity-Other", "IE00B5BMR087")).toBe(
        "Equity-USA",
      );
    });

    it("returns null when the operator is editing the same-key entry", () => {
      expect(findDuplicateIsinKey(catalog, "Equity-USA", "IE00B5BMR087")).toBe(
        null,
      );
    });

    it("normalises case + whitespace on the input ISIN", () => {
      expect(findDuplicateIsinKey(catalog, "Equity-Other", " ie00b5bmr087 ")).toBe(
        "Equity-USA",
      );
    });

    it("returns null for an unseen ISIN", () => {
      expect(findDuplicateIsinKey(catalog, "Equity-New", "IE00BFRESH001")).toBe(
        null,
      );
    });
  });

  it("resolves bucket alternatives (ISIN strings) to their INSTRUMENTS rows", () => {
    // Task #111 contract: BUCKETS carries plain ISIN strings; the joined
    // CatalogSummary view fills in name/listings/etc. by looking the ISIN
    // up in INSTRUMENTS. Without that join the admin pane's REPLACE diff
    // and the global ISIN-uniqueness pre-flight in injectAlternative
    // would both lose every alternative's metadata.
    const src = buildSource({
      instruments: [
        {
          isin: "IE00BTRK1111",
          name: "Trick ETF",
          terBps: 10,
          comment: "Parent.",
          listings: `{ LSE: { ticker: "TRCK" } }`,
        },
        {
          isin: "IE00BREAL222",
          name: "Real Alt",
          terBps: 12,
          comment: "the real alternative",
          listings: `{ LSE: { ticker: "REAL" } }`,
        },
      ],
      buckets: [
        {
          key: "Equity-Tricky",
          default: "IE00BTRK1111",
          alternatives: ["IE00BREAL222"],
        },
      ],
    });
    const out = parseCatalogFromSource(src);
    expect(out["Equity-Tricky"]).toBeDefined();
    expect(out["Equity-Tricky"].alternatives?.length).toBe(1);
    expect(out["Equity-Tricky"].alternatives?.[0].isin).toBe("IE00BREAL222");
    expect(out["Equity-Tricky"].alternatives?.[0].name).toBe("Real Alt");
    // The parent's own scalar fields remain intact.
    expect(out["Equity-Tricky"].isin).toBe("IE00BTRK1111");
  });

  it("parses the real etfs.ts and finds well-known buckets", async () => {
    // Sanity check against the live source — if this fails, an etfs.ts
    // refactor has broken the parser shape and the admin pane's diff
    // will silently mis-classify entries.
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const real = await readFile(
      path.resolve(__dirname, "../src/lib/etfs.ts"),
      "utf8",
    );
    const out = parseCatalogFromSource(real);
    expect(out["Equity-Global"]).toBeDefined();
    expect(out["Equity-USA"]).toBeDefined();
    expect(out["Equity-USA"].isin).toBe("IE00B5BMR087");
    expect(out["Equity-USA"].terBps).toBeGreaterThan(0);
    expect(Object.keys(out["Equity-USA"].listings).length).toBeGreaterThan(0);
  });
});
