// ----------------------------------------------------------------------------
// render-alternative.test.ts
// ----------------------------------------------------------------------------
// renderAlternativeBlock survives Task #111 as a *display-only* renderer:
// it still produces the bare-object literal the admin pane shows in
// "Show generated code" and the GitHub PR body uses for human reading.
// It is NO LONGER inserted verbatim into etfs.ts (BUCKETS now stores
// plain ISIN strings; metadata lives in INSTRUMENTS), so the round-trip
// test against the catalog parser was retired with the old data model.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  renderAlternativeBlock,
  type NewAlternativeEntry,
} from "../../api-server/src/lib/render-alternative";

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
    expect(out).toContain(
      'listings: { "LSE": { ticker: "VWRA" }, "XETRA": { ticker: "VWCE" } }',
    );
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

  it("emits commentDe + commentSource only when defined (Task #207)", () => {
    const minimal = renderAlternativeBlock(SAMPLE, "      ");
    expect(minimal).not.toContain("commentDe");
    expect(minimal).not.toContain("commentSource");

    const tagged = renderAlternativeBlock(
      {
        ...SAMPLE,
        commentDe: "Vanguards globaler Aktien-Flaggschiff-Fonds.",
        commentSource: "justetf",
      },
      "      ",
    );
    expect(tagged).toContain(
      'commentDe: "Vanguards globaler Aktien-Flaggschiff-Fonds."',
    );
    expect(tagged).toContain('commentSource: "justetf"');
  });
});
