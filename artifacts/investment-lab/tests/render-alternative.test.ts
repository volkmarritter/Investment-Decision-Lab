// ----------------------------------------------------------------------------
// render-alternative.test.ts
// ----------------------------------------------------------------------------
// Verifies the bare-object-literal renderer produces output that:
//   1. Round-trips through parseCatalogFromSource when wrapped in a
//      synthetic catalog → guarantees admin-pane previews and the actual
//      injected diff stay in sync.
//   2. Matches the catalog's hand-written formatting conventions
//      (no `E({...})` wrapper, no `key:` field, listings inline).
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  renderAlternativeBlock,
  type NewAlternativeEntry,
} from "../../api-server/src/lib/render-alternative";
import { parseCatalogFromSource } from "../../api-server/src/lib/catalog-parser";

const SAMPLE: NewAlternativeEntry = {
  name: "Vanguard FTSE All-World UCITS",
  isin: "IE00BK5BQT80",
  terBps: 22,
  domicile: "Ireland",
  replication: "Physical (sampled)",
  distribution: "Accumulating",
  currency: "USD",
  comment: "Vanguard's flagship global equity fund.",
  listings: {
    LSE: { ticker: "VWRA" },
    XETRA: { ticker: "VWCE" },
  },
  defaultExchange: "LSE",
};

describe("renderAlternativeBlock", () => {
  it("emits a bare object literal (no key prefix, no E() wrapper)", () => {
    const out = renderAlternativeBlock(SAMPLE, "      ");
    expect(out.startsWith("      {")).toBe(true);
    expect(out).not.toContain("E(");
    expect(out).not.toMatch(/"[A-Za-z0-9_-]+":\s*E\(/);
    expect(out).toContain('isin: "IE00BK5BQT80"');
    expect(out).toContain("terBps: 22");
  });

  it("indents listings inline matching the hand-written catalog style", () => {
    const out = renderAlternativeBlock(SAMPLE, "      ");
    expect(out).toContain('listings: { "LSE": { ticker: "VWRA" }, "XETRA": { ticker: "VWCE" } }');
  });

  it("emits optional fields only when present", () => {
    const minimal = renderAlternativeBlock(SAMPLE, "      ");
    expect(minimal).not.toContain("aumMillionsEUR");
    expect(minimal).not.toContain("inceptionDate");

    const full = renderAlternativeBlock(
      { ...SAMPLE, aumMillionsEUR: 12345.6, inceptionDate: "2019-05-23" },
      "      ",
    );
    expect(full).toContain("aumMillionsEUR: 12345.6");
    expect(full).toContain('inceptionDate: "2019-05-23"');
  });

  it("round-trips through parseCatalogFromSource as a parent's first alt", () => {
    // Wrap the rendered block in a synthetic catalog with one parent that
    // has exactly one alternative (the rendered one). If the renderer
    // emits the right indentation/commas, the parser surfaces it.
    const block = renderAlternativeBlock(SAMPLE, "      ");
    const synthetic = [
      "const CATALOG: Record<string, ETFRecord> = {",
      '  "Equity-Global": E({',
      '    name: "Default ETF",',
      '    isin: "IE00B3YLTY66",',
      "    terBps: 17,",
      '    domicile: "Ireland",',
      '    replication: "Physical (sampled)",',
      '    distribution: "Accumulating",',
      '    currency: "USD",',
      '    comment: "Default.",',
      "    listings: { LSE: { ticker: \"SPYI\" } },",
      '    defaultExchange: "LSE",',
      "    alternatives: [",
      block,
      "    ],",
      "  }),",
      "};",
    ].join("\n");

    const parsed = parseCatalogFromSource(synthetic);
    expect(parsed["Equity-Global"]).toBeDefined();
    expect(parsed["Equity-Global"].alternatives).toBeDefined();
    expect(parsed["Equity-Global"].alternatives?.length).toBe(1);
    const alt = parsed["Equity-Global"].alternatives![0];
    expect(alt.name).toBe(SAMPLE.name);
    expect(alt.isin).toBe(SAMPLE.isin);
    expect(alt.terBps).toBe(SAMPLE.terBps);
    expect(alt.defaultExchange).toBe("LSE");
    expect(alt.listings).toEqual({
      LSE: { ticker: "VWRA" },
      XETRA: { ticker: "VWCE" },
    });
  });
});
