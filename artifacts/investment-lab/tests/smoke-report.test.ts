// Contract tests for buildFailureReport in scripts/smoke-justetf.mjs.
//
// Why this exists
// ---------------
// buildFailureReport's output is dropped verbatim into a GitHub Issue body
// by the daily justETF smoke workflow (.github/workflows/justetf-smoke.yml).
// A silent regression in the report — missing field names, broken Markdown
// structure, wrong file paths in the "Where to fix" section — would degrade
// the alert without anything else catching it (the scraper unit tests cover
// the extractors, not the notifier glue).
//
// These tests pin the report's *user-visible contract*: the canary ISINs,
// the missing-field names, the error messages, the section headings GitHub
// Issues renders as headers, and the file paths the on-call engineer is
// supposed to follow to locate the broken extractor. The tests deliberately
// avoid line-by-line snapshots so cosmetic copy edits stay frictionless,
// but they fail loudly if anything that matters for triage disappears.

import { describe, it, expect } from "vitest";
import { CANARIES, buildFailureReport } from "../scripts/smoke-justetf.mjs";

// Canaries are picked from the real CANARIES array so the tests stay in sync
// with the live smoke job's choices — if someone swaps an ISIN, the assertions
// below still describe the actual report shape.
const equityCanary = CANARIES.find((c) => c.type === "equity")!;
const goldCanary = CANARIES.find((c) => c.type === "gold")!;
const cryptoCanary = CANARIES.find((c) => c.type === "crypto")!;

describe("buildFailureReport (smoke-justetf notifier glue)", () => {
  it("renders a missing-fields failure with the canary, missing field names, and Markdown headers", () => {
    const report = buildFailureReport(
      [
        {
          canary: equityCanary,
          missing: ["core.name", "listings.tickers", "lookthrough.topHoldings"],
        },
      ],
      CANARIES.length,
    );

    // Top-level headers GitHub Issues renders as section anchors.
    expect(report).toContain("## justETF smoke check failed");
    expect(report).toContain("### Failing canaries");
    expect(report).toContain("### Where to fix");

    // The summary line must surface the regressed/total ratio so the
    // on-call engineer immediately sees the blast radius.
    expect(report).toContain(`**1/${CANARIES.length} canary ISIN(s) regressed.**`);

    // The canary itself: type tag, ISIN, fund name, and a clickable
    // profile URL pointing at the *exact* ISIN that broke.
    expect(report).toContain(`[${equityCanary.type}] ${equityCanary.isin}`);
    expect(report).toContain(equityCanary.name);
    expect(report).toContain(
      `https://www.justetf.com/en/etf-profile.html?isin=${equityCanary.isin}`,
    );

    // Every missing field name must be present, each rendered as inline
    // code so it survives Markdown formatting unchanged.
    expect(report).toContain("`core.name`");
    expect(report).toContain("`listings.tickers`");
    expect(report).toContain("`lookthrough.topHoldings`");
    expect(report).toContain("missing fields:");
  });

  it("renders a fetch-error failure with the error string in inline code", () => {
    const report = buildFailureReport(
      [
        {
          canary: cryptoCanary,
          error: "HTTP 503 for DE000A27Z304",
        },
      ],
      CANARIES.length,
    );

    expect(report).toContain(`[${cryptoCanary.type}] ${cryptoCanary.isin}`);
    expect(report).toContain("fetch error:");
    expect(report).toContain("`HTTP 503 for DE000A27Z304`");

    // Fetch-error failures must NOT also print a "missing fields:" line —
    // there are no parser results to enumerate when the page never loaded.
    expect(report).not.toContain("missing fields:");
  });

  it("renders both kinds of failure side by side without losing either canary", () => {
    const report = buildFailureReport(
      [
        {
          canary: equityCanary,
          missing: ["core.name"],
        },
        {
          canary: goldCanary,
          error: "fetch failed: ENETUNREACH",
        },
      ],
      CANARIES.length,
    );

    expect(report).toContain(`**2/${CANARIES.length} canary ISIN(s) regressed.**`);

    // Both canaries must appear with their per-type tags so triage can
    // tell at a glance which extractor surface broke.
    expect(report).toContain(`[${equityCanary.type}] ${equityCanary.isin}`);
    expect(report).toContain(`[${goldCanary.type}] ${goldCanary.isin}`);

    // Both failure modes' detail lines must be present.
    expect(report).toContain("missing fields:");
    expect(report).toContain("`core.name`");
    expect(report).toContain("fetch error:");
    expect(report).toContain("`fetch failed: ENETUNREACH`");
  });

  it("renders a single-failure-out-of-three report with the correct ratio and only the regressed canary", () => {
    const report = buildFailureReport(
      [
        {
          canary: goldCanary,
          missing: ["listings.tickers"],
        },
      ],
      CANARIES.length,
    );

    expect(report).toContain(`**1/${CANARIES.length} canary ISIN(s) regressed.**`);

    // The regressed canary is named.
    expect(report).toContain(`[${goldCanary.type}] ${goldCanary.isin}`);
    expect(report).toContain(goldCanary.name);

    // The two healthy canaries are *not* listed under "Failing canaries".
    expect(report).not.toContain(`[${equityCanary.type}] ${equityCanary.isin}`);
    expect(report).not.toContain(`[${cryptoCanary.type}] ${cryptoCanary.isin}`);
  });

  it("includes the 'Where to fix' pointers to refresh-justetf.mjs and refresh-lookthrough.mjs", () => {
    // This is the test the task spec calls out explicitly: if someone
    // removes or renames the extractor-file pointers, this fails. The
    // pointers are the only navigation aid the on-call engineer has from
    // the GitHub Issue back into the codebase.
    const report = buildFailureReport(
      [{ canary: equityCanary, missing: ["core.name"] }],
      CANARIES.length,
    );

    expect(report).toContain("`core.*` and `listings.*`");
    expect(report).toContain("artifacts/investment-lab/scripts/refresh-justetf.mjs");
    expect(report).toContain("`lookthrough.*`");
    expect(report).toContain("artifacts/investment-lab/scripts/refresh-lookthrough.mjs");

    // The closing instruction must keep telling the engineer where the
    // fixtures live, so they remember to refresh them after patching.
    expect(report).toContain("artifacts/investment-lab/tests/fixtures/justetf/");
  });

  it("ends with a trailing newline so GitHub Issues / step-summary appends render cleanly", () => {
    const report = buildFailureReport(
      [{ canary: equityCanary, missing: ["core.name"] }],
      CANARIES.length,
    );
    expect(report.endsWith("\n")).toBe(true);
  });
});
