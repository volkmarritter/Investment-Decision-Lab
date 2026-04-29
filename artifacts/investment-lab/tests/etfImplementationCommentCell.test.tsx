// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// etfImplementationCommentCell.test.tsx
// ----------------------------------------------------------------------------
// Locks in the auto-generated comment fallback rendered in the Build tab's
// ETF Implementation table.
//
// Why this exists
// ---------------
// Today only a couple of catalog rows have an empty `comment` and therefore
// trigger the auto-description fallback (e.g. the Xtrackers MSCI World IT
// ETF, IE00BM67HT60 — a look-through-only entry with no curated prose).
// If somebody fills in those comments later, or refactors the comment
// column, the fallback rendering would silently disappear and an operator
// wouldn't notice until they complained that look-through-only ETFs read
// as "(blank)" in the table.
//
// We pin the contract:
//   1. When `etf.comment` is empty AND a look-through profile exists for
//      the ISIN, the cell renders the auto-generated description (italic)
//      and the "auto-generated from look-through data" hint label.
//   2. When `etf.comment` carries curated text, the curated text wins and
//      the hint label does NOT appear.
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";
import { EtfImplementationCommentCell } from "../src/components/investment/EtfImplementationCommentCell";
import type { ETFImplementation } from "../src/lib/types";

afterEach(() => cleanup());

// Minimal subset of ETFImplementation that the cell actually reads. Other
// catalog fields (TER, ticker, exchange, ...) don't influence the comment
// column, so we keep the fixture lean to make intent obvious.
type CellEtf = Pick<
  ETFImplementation,
  | "comment"
  | "exampleETF"
  | "isin"
  | "bucket"
  | "domicile"
  | "distribution"
  | "currency"
>;

function makeEtf(overrides: Partial<CellEtf>): CellEtf {
  return {
    bucket: "Equity-Technology Alt 2",
    // IE00BM67HT60 = Xtrackers MSCI World Information Technology UCITS ETF.
    // It's a look-through-only catalog entry with no curated comment and a
    // real look-through profile — exactly the canonical case the fallback
    // exists for.
    isin: "IE00BM67HT60",
    exampleETF: "Xtrackers MSCI World Information Technology UCITS ETF",
    domicile: "Ireland",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    ...overrides,
  };
}

function renderCell(etf: CellEtf) {
  return render(
    <LanguageProvider>
      <EtfImplementationCommentCell etf={etf} />
    </LanguageProvider>,
  );
}

describe("EtfImplementationCommentCell", () => {
  it("renders the auto-generated description and hint label when comment is empty", () => {
    const etf = makeEtf({ comment: "" });
    renderCell(etf);

    const auto = screen.getByTestId(
      `etf-impl-auto-description-${etf.bucket}`,
    );
    // The deterministic template always lands "ETF" in the lead noun
    // phrase. We don't snapshot the full sentence so the test stays
    // resilient to template tweaks; we just guard that something useful
    // showed up.
    expect(auto.textContent).toMatch(/ETF/);
    // The acceptance criteria call for the auto description to render in
    // italic. Pin the italic wrapper explicitly so a future style refactor
    // that drops the class is caught here rather than discovered in the
    // operator's screenshot.
    const italicNode = auto.querySelector(".italic");
    expect(italicNode).not.toBeNull();
    expect(italicNode!.textContent).toMatch(/ETF/);
    // Hint label is rendered verbatim from the EN i18n bundle (the test
    // wrapper does not switch language, so EN is the default).
    expect(auto.textContent).toContain("auto-generated from look-through data");
  });

  it("renders the curated comment verbatim and does NOT render the hint label", () => {
    const etf = makeEtf({ comment: "Hand-written editorial comment." });
    renderCell(etf);

    expect(screen.getByText("Hand-written editorial comment.")).toBeTruthy();
    expect(
      screen.queryByTestId(`etf-impl-auto-description-${etf.bucket}`),
    ).toBeNull();
    // The hint label string must not appear anywhere in the cell when a
    // curated comment is present.
    expect(
      screen.queryByText("auto-generated from look-through data"),
    ).toBeNull();
  });

  it("treats a whitespace-only comment as empty and falls back to the auto description", () => {
    // Defensive guard: catalog entries occasionally land with a stray
    // space character. The cell trims before deciding which branch to
    // render, and we want that behaviour pinned so a future refactor
    // can't quietly drop the trim.
    const etf = makeEtf({ comment: "   " });
    renderCell(etf);

    expect(
      screen.getByTestId(`etf-impl-auto-description-${etf.bucket}`),
    ).toBeTruthy();
  });
});
