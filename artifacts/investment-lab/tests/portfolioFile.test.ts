// ----------------------------------------------------------------------------
// portfolioFile.test.ts
// ----------------------------------------------------------------------------
// Round-trip + rejection coverage for the JSON portfolio file format.
// We intentionally exercise the wrapper validation paths (wrong format,
// future schema version, missing fields, engine-rejected input) as well as
// the happy-path round trip through a saved-scenario object.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  PORTFOLIO_FILE_APP,
  PORTFOLIO_FILE_FORMAT,
  PORTFOLIO_FILE_SCHEMA_VERSION,
  buildPortfolioFilename,
  buildScenarioForExport,
  parsePortfolioFile,
  serializePortfolioFile,
} from "../src/lib/portfolioFile";
import type { PortfolioInput } from "../src/lib/types";
import type { ETFRecord } from "../src/lib/etfs";

const baseInput: PortfolioInput = {
  baseCurrency: "CHF",
  riskAppetite: "High",
  horizon: 10,
  targetEquityPct: 60,
  numETFs: 8,
  numETFsMin: 6,
  preferredExchange: "SIX",
  thematicPreference: "None",
  includeCurrencyHedging: false,
  includeSyntheticETFs: false,
  lookThroughView: true,
  includeCrypto: false,
  includeListedRealEstate: false,
  includeCommodities: true,
};

describe("portfolioFile", () => {
  it("round-trips a simple scenario through serialize → parse", () => {
    const scenario = buildScenarioForExport("My Portfolio", baseInput, undefined, undefined);
    const wrapper = serializePortfolioFile(scenario);
    expect(wrapper.format).toBe(PORTFOLIO_FILE_FORMAT);
    expect(wrapper.schemaVersion).toBe(PORTFOLIO_FILE_SCHEMA_VERSION);

    const result = parsePortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.name).toBe("My Portfolio");
    expect(result.scenario.input.baseCurrency).toBe("CHF");
    expect(result.scenario.input.targetEquityPct).toBe(60);
    expect(result.scenario.manualWeights).toBeUndefined();
    expect(result.scenario.etfSelections).toBeUndefined();
  });

  it("round-trips manual weights and ETF selections", () => {
    const manualWeights = { "Equity - Global": 25, "FixedIncome - Global": 30 };
    const etfSelections = { "Equity-Global": 2, "Commodities-Gold": 1 };
    const scenario = buildScenarioForExport("Weighted", baseInput, manualWeights, etfSelections);
    const wrapper = serializePortfolioFile(scenario);
    const result = parsePortfolioFile(JSON.stringify(wrapper));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.manualWeights).toEqual(manualWeights);
    expect(result.scenario.etfSelections).toEqual(etfSelections);
  });

  describe("etfOverrides", () => {
    const validOverride: ETFRecord = {
      name: "Test World ETF",
      isin: "IE00TEST0001",
      terBps: 12,
      domicile: "Ireland",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      comment: "Test entry for portfolio file round-trip",
      listings: { LSE: { ticker: "TEST" } },
      defaultExchange: "LSE",
    };

    it("omits the etfOverrides field when none are passed", () => {
      const scenario = buildScenarioForExport("Plain", baseInput);
      const wrapper = serializePortfolioFile(scenario);
      expect(wrapper.etfOverrides).toBeUndefined();
      // Round-trip must still succeed and yield an empty overrides map
      // (always-present in the success branch).
      const result = parsePortfolioFile(JSON.stringify(wrapper));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.etfOverrides).toEqual({});
    });

    it("round-trips a non-empty etfOverrides map at the top level", () => {
      const scenario = buildScenarioForExport("WithOverride", baseInput);
      const wrapper = serializePortfolioFile(scenario, {
        "Equity-Global": validOverride,
      });
      expect(wrapper.etfOverrides).toBeDefined();
      expect(wrapper.etfOverrides!["Equity-Global"]).toEqual(validOverride);

      const result = parsePortfolioFile(JSON.stringify(wrapper));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.etfOverrides)).toEqual(["Equity-Global"]);
      expect(result.etfOverrides["Equity-Global"].isin).toBe("IE00TEST0001");
    });

    it("drops malformed override entries silently while keeping the rest", () => {
      // Hand-crafted wrapper: one valid entry, one missing required fields.
      const result = parsePortfolioFile(
        JSON.stringify({
          format: PORTFOLIO_FILE_FORMAT,
          app: PORTFOLIO_FILE_APP,
          schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
          scenario: { name: "x", input: baseInput },
          etfOverrides: {
            "Equity-Global": validOverride,
            "Equity-USA": { name: "broken", isin: "IE00BAD" }, // missing fields
            "": validOverride, // empty key dropped
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.etfOverrides)).toEqual(["Equity-Global"]);
    });

    it("ignores a non-object etfOverrides field rather than failing the import", () => {
      const result = parsePortfolioFile(
        JSON.stringify({
          format: PORTFOLIO_FILE_FORMAT,
          app: PORTFOLIO_FILE_APP,
          schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
          scenario: { name: "x", input: baseInput },
          etfOverrides: "not an object",
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.etfOverrides).toEqual({});
    });
  });

  it("rejects malformed JSON", () => {
    const result = parsePortfolioFile("{not valid json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid-json");
  });

  it("rejects a JSON file whose format identifier doesn't match", () => {
    const result = parsePortfolioFile(JSON.stringify({ format: "something-else", schemaVersion: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a JSON file from a different app even with matching format string", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: "Some Other App",
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: { name: "x", input: baseInput },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a JSON file with no app field at all", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: { name: "x", input: baseInput },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("wrong-format");
  });

  it("rejects a future schema version", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: PORTFOLIO_FILE_APP,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION + 1,
        scenario: { name: "x", input: baseInput },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("future-version");
  });

  it("rejects missing scenario fields", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: PORTFOLIO_FILE_APP,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: { input: baseInput }, // no name
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects bogus base currency in input", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: PORTFOLIO_FILE_APP,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: { name: "x", input: { ...baseInput, baseCurrency: "JPY" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("missing-fields");
  });

  it("rejects an input that the engine validation rejects", () => {
    const badInput = { ...baseInput, numETFs: 1 }; // engine min is 3
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: PORTFOLIO_FILE_APP,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: { name: "x", input: badInput },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("invalid-input");
    expect(result.error.detail).toBeTruthy();
  });

  it("rejects ETF selection slots outside the allowed range", () => {
    const result = parsePortfolioFile(
      JSON.stringify({
        format: PORTFOLIO_FILE_FORMAT,
        app: PORTFOLIO_FILE_APP,
        schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
        scenario: {
          name: "x",
          input: baseInput,
          etfSelections: { "Equity-Global": 0 }, // slot 0 is reserved
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("builds filenames safe for filesystems", () => {
    expect(buildPortfolioFilename("My Portfolio")).toBe("investment-lab-portfolio-My Portfolio.json");
    expect(buildPortfolioFilename("a/b\\c:d*e?f\"g<h>i|j")).toBe(
      "investment-lab-portfolio-a b c d e f g h i j.json",
    );
    const noName = buildPortfolioFilename();
    expect(noName.startsWith("investment-lab-portfolio-")).toBe(true);
    expect(noName.endsWith(".json")).toBe(true);
  });
});
