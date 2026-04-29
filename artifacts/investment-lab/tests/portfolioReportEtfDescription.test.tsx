// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// portfolioReportEtfDescription.test.tsx
// ----------------------------------------------------------------------------
// Locks in the per-ETF description fallback inside the *detailed* PDF
// report rendered by <PortfolioReport variant="detailed" />.
//
// Why this exists
// ---------------
// Operators export the detailed PDF via Build → "Detailed PDF" — the
// off-screen <PortfolioReport variant="detailed" /> mount is photographed
// by html2canvas. For each ETF row in the implementation table, the report
// must surface a human-readable description so the printed/shared report
// doesn't read as "description missing" for look-through-only ETFs:
//
//   1. Curated catalog `comment` always wins (no auto hint).
//   2. When `comment` is blank but the ISIN has a look-through profile,
//      fall back to describeEtf() with a discreet " · auto" hint so the
//      reader can tell at a glance the prose was machine-assembled.
//   3. When neither is available, the cell stays empty (no placeholder
//      copy, no broken layout).
//
// The basic (one-page) variant must NOT carry the description column —
// that report is intentionally a tight summary, and the previous behaviour
// (no description) is preserved.
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";
import { PortfolioReport } from "../src/components/investment/PortfolioReport";
import type { PortfolioInput, PortfolioOutput, ETFImplementation } from "../src/lib/types";

afterEach(() => cleanup());

const baseInput: PortfolioInput = {
  riskAppetite: "balanced",
  horizon: 10,
  baseCurrency: "USD",
  targetEquityPct: 60,
  numETFs: 6,
  numETFsMin: 4,
  includeCurrencyHedging: false,
  includeSyntheticETFs: false,
  lookThroughView: false,
  thematicPreference: "None",
  topHoldings: [],
} as unknown as PortfolioInput;

function makeEtfRow(overrides: Partial<ETFImplementation>): ETFImplementation {
  return {
    bucket: "Test Bucket",
    assetClass: "Equity",
    weight: 60,
    intent: "Core equity exposure",
    exampleETF: "Test ETF",
    rationale: "Diversified core",
    isin: "US0000000000",
    ticker: "TST",
    exchange: "XETRA",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    ...overrides,
  } as ETFImplementation;
}

function makeOutput(rows: ETFImplementation[]): PortfolioOutput {
  return {
    allocation: [
      {
        assetClass: "Equity",
        region: "World",
        weight: 60,
      } as any,
      {
        assetClass: "Fixed Income",
        region: "World",
        weight: 40,
      } as any,
    ],
    etfImplementation: rows,
    notes: [],
  } as unknown as PortfolioOutput;
}

function renderReport(props: { rows: ETFImplementation[]; variant: "basic" | "detailed" }) {
  return render(
    <LanguageProvider>
      <PortfolioReport
        output={makeOutput(props.rows)}
        input={baseInput}
        generatedAt={new Date("2026-04-29T12:00:00Z")}
        variant={props.variant}
      />
    </LanguageProvider>,
  );
}

describe("PortfolioReport — per-ETF description (detailed variant)", () => {
  it("renders the curated comment verbatim and adds NO 'auto' hint", () => {
    const row = makeEtfRow({
      bucket: "Curated Bucket",
      // Use a curated catalog ISIN so describeEtf would otherwise also
      // return non-null — this proves the curated comment wins over auto.
      isin: "IE00B5BMR087",
      comment: "Hand-written editorial comment for this ETF.",
    });
    renderReport({ rows: [row], variant: "detailed" });

    const desc = screen.getByTestId("report-etf-description-Curated Bucket");
    expect(desc.textContent).toContain("Hand-written editorial comment for this ETF.");
    expect(
      screen.queryByTestId("report-etf-description-auto-hint-Curated Bucket"),
    ).toBeNull();
  });

  it("falls back to the auto description with a discreet ' · auto' hint when comment is blank", () => {
    // IE00B5BMR087 is a curated catalog ISIN with a known LookthroughProfile,
    // so describeEtf() will return a non-null { de, en } pair. We pass an
    // empty comment to force the fallback path.
    const row = makeEtfRow({
      bucket: "Auto Bucket",
      isin: "IE00B5BMR087",
      comment: "",
    });
    renderReport({ rows: [row], variant: "detailed" });

    const desc = screen.getByTestId("report-etf-description-Auto Bucket");
    // The auto-generated prose always starts with the lead noun phrase
    // (capitalised). We don't snapshot the full sentence to keep the test
    // resilient to template tweaks — we just guard that something useful
    // landed in the cell.
    expect(desc.textContent).toMatch(/ETF/);
    const hint = screen.getByTestId(
      "report-etf-description-auto-hint-Auto Bucket",
    );
    expect(hint.textContent).toContain("auto");
  });

  it("renders neither description nor hint when comment is blank AND no profile exists", () => {
    const row = makeEtfRow({
      bucket: "Empty Bucket",
      // ISIN with no curated comment AND no look-through profile.
      isin: "XX0000000000",
      comment: "",
    });
    renderReport({ rows: [row], variant: "detailed" });

    expect(screen.queryByTestId("report-etf-description-Empty Bucket")).toBeNull();
    expect(
      screen.queryByTestId("report-etf-description-auto-hint-Empty Bucket"),
    ).toBeNull();
  });
});

describe("PortfolioReport — per-ETF description (basic variant)", () => {
  it("never renders the description sub-row, even when a curated comment exists", () => {
    const row = makeEtfRow({
      bucket: "Basic Bucket",
      isin: "IE00B5BMR087",
      comment: "Hand-written editorial comment for this ETF.",
    });
    renderReport({ rows: [row], variant: "basic" });

    expect(screen.queryByTestId("report-etf-description-Basic Bucket")).toBeNull();
    expect(
      screen.queryByTestId("report-etf-description-auto-hint-Basic Bucket"),
    ).toBeNull();
  });
});
