// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// etfImplementationReadOnlyComment.test.tsx
// ----------------------------------------------------------------------------
// Locks in the auto-generated comment fallback rendered in the Compare tab's
// read-only ETF Implementation table.
//
// Why this exists
// ---------------
// The Compare tab renders each slot's ETF implementation via
// EtfImplementationReadOnly. It used to show the curated `comment` column
// verbatim, leaving the cell blank for look-through-only ETFs (no curated
// description). The Build tab's table, the look-through dialog, the ETF
// details popup and the detailed PDF report all fall back to the
// auto-generated description with a discreet "auto" hint in this case.
// This test pins that Compare now does the same so a future refactor that
// drops the EtfImplementationCommentCell delegation can't quietly bring
// back the empty-cell regression.
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";
import { EtfImplementationReadOnly } from "../src/components/investment/EtfImplementationReadOnly";
import type { ETFImplementation } from "../src/lib/types";

afterEach(() => cleanup());

function makeEtf(overrides: Partial<ETFImplementation>): ETFImplementation {
  return {
    bucket: "Equity-Technology Alt 2",
    assetClass: "Equity",
    weight: 5,
    intent: "",
    // IE00BM67HT60 = Xtrackers MSCI World Information Technology UCITS ETF.
    // It's a look-through-only catalog entry with no curated comment and a
    // real look-through profile — exactly the canonical case the fallback
    // exists for.
    isin: "IE00BM67HT60",
    exampleETF: "Xtrackers MSCI World Information Technology UCITS ETF",
    rationale: "",
    ticker: "XDWT",
    exchange: "XETRA",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
    ...overrides,
  };
}

function renderTable(etf: ETFImplementation) {
  return render(
    <LanguageProvider>
      <EtfImplementationReadOnly etfs={[etf]} />
    </LanguageProvider>,
  );
}

describe("EtfImplementationReadOnly comment cell", () => {
  it("renders the auto-generated description when the curated comment is empty", () => {
    const etf = makeEtf({ comment: "" });
    renderTable(etf);

    const auto = screen.getByTestId(
      `etf-impl-auto-description-${etf.bucket}`,
    );
    expect(auto.textContent).toMatch(/ETF/);
    const italicNode = auto.querySelector(".italic");
    expect(italicNode).not.toBeNull();
    expect(italicNode!.textContent).toMatch(/ETF/);
    expect(auto.textContent).toContain("auto-generated from look-through data");
  });

  it("renders the curated comment verbatim and does NOT render the hint label", () => {
    const etf = makeEtf({ comment: "Hand-written editorial comment." });
    renderTable(etf);

    expect(screen.getByText("Hand-written editorial comment.")).toBeTruthy();
    expect(
      screen.queryByTestId(`etf-impl-auto-description-${etf.bucket}`),
    ).toBeNull();
    expect(
      screen.queryByText("auto-generated from look-through data"),
    ).toBeNull();
  });
});
