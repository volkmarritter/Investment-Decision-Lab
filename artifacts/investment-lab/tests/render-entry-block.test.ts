// Snapshot test for renderEntryBlock so a future tweak to field order,
// indentation, or escaping is loud (the rendered string is what gets
// inserted into etfs.ts AND what the operator sees in the admin pane's
// "Show generated code" disclosure AND what reviewers see in the PR body
// — three places that must stay in lockstep).

import { describe, it, expect } from "vitest";
import {
  renderEntryBlock,
  type NewEtfEntry,
} from "../../api-server/src/lib/render-entry";

const SAMPLE_ENTRY: NewEtfEntry = {
  key: "Equity-Test",
  name: "iShares Test Equity UCITS",
  isin: "IE00B0TEST01",
  terBps: 12,
  domicile: "Ireland",
  replication: "Physical",
  distribution: "Accumulating",
  currency: "USD",
  comment: "Test fund used by snapshot test.",
  defaultExchange: "LSE",
  listings: {
    LSE: { ticker: "TEST" },
    XETRA: { ticker: "TST" },
  },
  aumMillionsEUR: 1234,
  inceptionDate: "2020-01-15",
};

describe("renderEntryBlock", () => {
  it("emits a stable, JSON-quoted TS literal", () => {
    expect(renderEntryBlock(SAMPLE_ENTRY)).toMatchInlineSnapshot(`
      "  "Equity-Test": E({
          name: "iShares Test Equity UCITS",
          isin: "IE00B0TEST01",
          terBps: 12,
          domicile: "Ireland",
          replication: "Physical",
          distribution: "Accumulating",
          currency: "USD",
          comment: "Test fund used by snapshot test.",
          listings: { "LSE": { ticker: "TEST" }, "XETRA": { ticker: "TST" } },
          defaultExchange: "LSE",
          aumMillionsEUR: 1234,
          inceptionDate: "2020-01-15",
        }),"
    `);
  });

  it("omits aumMillionsEUR and inceptionDate when undefined", () => {
    const minimal: NewEtfEntry = { ...SAMPLE_ENTRY };
    delete minimal.aumMillionsEUR;
    delete minimal.inceptionDate;
    const out = renderEntryBlock(minimal);
    expect(out).not.toContain("aumMillionsEUR");
    expect(out).not.toContain("inceptionDate");
  });

  it("JSON-escapes exchange keys to defend against bad listings input", () => {
    const out = renderEntryBlock(SAMPLE_ENTRY);
    // Exchange keys are emitted as quoted strings (e.g. "LSE", not LSE) so
    // a future regression that lets a malicious key through validation
    // can't inject raw TS tokens.
    expect(out).toContain('"LSE": { ticker: "TEST" }');
    expect(out).toContain('"XETRA": { ticker: "TST" }');
  });
});
