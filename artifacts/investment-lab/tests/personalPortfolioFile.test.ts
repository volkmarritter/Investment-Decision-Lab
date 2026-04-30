// ----------------------------------------------------------------------------
// personalPortfolioFile.test.ts
// ----------------------------------------------------------------------------
// Round-trip + rejection coverage for the personal-portfolio JSON file
// format. Mirrors the structure of `portfolioFile.test.ts` (Build's
// equivalent) so the two file formats stay in sync on validation and
// filename behaviour.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  PERSONAL_PORTFOLIO_FILE_APP,
  PERSONAL_PORTFOLIO_FILE_FORMAT,
  PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
  buildPersonalPortfolioFilename,
  buildPersonalPortfolioForExport,
  parsePersonalPortfolioFile,
  serializePersonalPortfolioFile,
} from "../src/lib/personalPortfolioFile";
import type { ExplainWorkspace } from "../src/lib/savedExplainPortfolios";

const baseWorkspace: ExplainWorkspace = {
  v: 1,
  baseCurrency: "CHF",
  riskAppetite: "Moderate",
  horizon: 12,
  hedged: false,
  lookThroughView: true,
  positions: [
    { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 60 },
    { isin: "IE00B4L5Y983", bucketKey: "Equity-Global", weight: 40 },
  ],
};

describe("personalPortfolioFile", () => {
  it("round-trips a simple workspace through serialize → parse", () => {
    const portfolio = buildPersonalPortfolioForExport("My Real Holdings", baseWorkspace);
    const wrapper = serializePersonalPortfolioFile(portfolio);
    expect(wrapper.format).toBe(PERSONAL_PORTFOLIO_FILE_FORMAT);
    expect(wrapper.app).toBe(PERSONAL_PORTFOLIO_FILE_APP);
    expect(wrapper.schemaVersion).toBe(PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION);

    const result = parsePersonalPortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portfolio.name).toBe("My Real Holdings");
    expect(result.portfolio.workspace.baseCurrency).toBe("CHF");
    expect(result.portfolio.workspace.horizon).toBe(12);
    expect(result.portfolio.workspace.positions).toHaveLength(2);
    expect(result.portfolio.workspace.positions[0].isin).toBe("IE00B5BMR087");
  });

  it("round-trips a manual-meta position carrying optional fields", () => {
    const ws: ExplainWorkspace = {
      ...baseWorkspace,
      positions: [
        {
          isin: "DE000A0H0744",
          bucketKey: "",
          weight: 100,
          manualMeta: {
            assetClass: "Real Estate",
            region: "Europe",
            name: "European REIT",
            currency: "EUR",
            terBps: 25,
          },
        },
      ],
    };
    const portfolio = buildPersonalPortfolioForExport("Manual", ws);
    const wrapper = serializePersonalPortfolioFile(portfolio);
    const result = parsePersonalPortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pos = result.portfolio.workspace.positions[0];
    expect(pos.manualMeta?.assetClass).toBe("Real Estate");
    expect(pos.manualMeta?.region).toBe("Europe");
    expect(pos.manualMeta?.name).toBe("European REIT");
    expect(pos.manualMeta?.currency).toBe("EUR");
    expect(pos.manualMeta?.terBps).toBe(25);
  });

  it("preserves id and createdAt from the source file", () => {
    const portfolio = buildPersonalPortfolioForExport("X", baseWorkspace);
    portfolio.id = "fixed-id-123";
    portfolio.createdAt = 1714500000000;
    const wrapper = serializePersonalPortfolioFile(portfolio);
    const result = parsePersonalPortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portfolio.id).toBe("fixed-id-123");
    expect(result.portfolio.createdAt).toBe(1714500000000);
  });

  it("clamps an out-of-range horizon into the supported window", () => {
    const wrapper = {
      format: PERSONAL_PORTFOLIO_FILE_FORMAT,
      app: PERSONAL_PORTFOLIO_FILE_APP,
      schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
      portfolio: {
        name: "Long horizon",
        workspace: { ...baseWorkspace, horizon: 200 },
      },
    };
    const result = parsePersonalPortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portfolio.workspace.horizon).toBe(40);
  });

  it("accepts a workspace with weights that don't sum to 100", () => {
    // Loaded files are treated like in-progress state — the user can
    // fine-tune after import, just like a localStorage-restored session.
    const ws: ExplainWorkspace = {
      ...baseWorkspace,
      positions: [
        { isin: "IE00B5BMR087", bucketKey: "Equity-USA", weight: 30 },
        { isin: "IE00B4L5Y983", bucketKey: "Equity-Global", weight: 20 },
      ],
    };
    const portfolio = buildPersonalPortfolioForExport("Draft", ws);
    const wrapper = serializePersonalPortfolioFile(portfolio);
    const result = parsePersonalPortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parsePersonalPortfolioFile("{not valid json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid-json");
  });

  it("rejects a file whose format identifier doesn't match", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({ format: "something-else", schemaVersion: 1 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a Build-scenario file by checking the format identifier", () => {
    // A Build scenario file uses `investment-decision-lab.portfolio` —
    // structurally different and must be rejected so the user gets a
    // clear "not a personal portfolio" toast instead of a half-loaded UI.
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: "investment-decision-lab.portfolio",
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: 1,
        scenario: { name: "x", input: {} },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a file from a different app even with matching format string", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: "Some Other App",
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: { name: "x", workspace: baseWorkspace },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a future schema version", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION + 1,
        portfolio: { name: "x", workspace: baseWorkspace },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("future-version");
  });

  it("rejects a missing portfolio.name", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: { workspace: baseWorkspace },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects a bogus base currency", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: {
          name: "x",
          workspace: { ...baseWorkspace, baseCurrency: "JPY" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects a bogus risk appetite", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: {
          name: "x",
          workspace: { ...baseWorkspace, riskAppetite: "Extreme" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects positions that aren't an array", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: {
          name: "x",
          workspace: { ...baseWorkspace, positions: "broken" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects a position with a non-numeric weight", () => {
    const result = parsePersonalPortfolioFile(
      JSON.stringify({
        format: PERSONAL_PORTFOLIO_FILE_FORMAT,
        app: PERSONAL_PORTFOLIO_FILE_APP,
        schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
        portfolio: {
          name: "x",
          workspace: {
            ...baseWorkspace,
            positions: [{ isin: "IE0", bucketKey: "Equity-USA", weight: "lots" }],
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("builds filenames safe for filesystems", () => {
    expect(buildPersonalPortfolioFilename("My Holdings")).toBe(
      "investment-lab-personal-portfolio-My Holdings.json",
    );
    expect(buildPersonalPortfolioFilename("a/b\\c:d*e?f\"g<h>i|j")).toBe(
      "investment-lab-personal-portfolio-a b c d e f g h i j.json",
    );
    const noName = buildPersonalPortfolioFilename();
    expect(noName.startsWith("investment-lab-personal-portfolio-")).toBe(true);
    expect(noName.endsWith(".json")).toBe(true);
  });
});
