// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// etfImplementationCommentCell.test.tsx
// ----------------------------------------------------------------------------
// Locks in the auto-generated comment fallback rendered in the Build tab's
// ETF Implementation table.
//
// Why this exists
// ---------------
// Most catalog rows now carry a `comment` (Task #207's auto-backfill
// stamps justETF "Investment objective" / `describeEtf()` text into
// `comment` + `commentDe` for every row that previously lacked one). A
// small handful of ISINs may still slip through — e.g. when the backfill
// hasn't run yet, or when a justETF profile is unreachable — so the
// runtime fallback in the cell stays as a safety net. We pin the
// contract:
//
//   1. When `etf.comment` is empty (and `etf.commentDe` is missing for
//      the active locale), the cell renders the deterministic
//      auto-generated description in italic.
//   2. The "auto-generated from look-through data" hint label is NOT
//      rendered any more — Task #207 made the persisted text
//      indistinguishable from a curated comment, so the disclaimer
//      would be misleading for backfilled rows. The runtime-fallback
//      branch is now flagged only by the italic styling.
//   3. When `etf.comment` carries text, the curated text wins.
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
  | "commentDe"
  | "commentSource"
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
    // real look-through profile — exactly the canonical case the runtime
    // fallback exists for when the backfill hasn't filled the row yet.
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
  it("renders the auto-generated description in italic when comment is empty", () => {
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
    // Italic styling on the wrapper is the ONLY visual flag that the
    // runtime fallback ran (Task #207 dropped the "auto-generated" hint
    // label). Pin the class directly so a future style refactor that
    // drops it is caught here.
    expect(auto.classList.contains("italic")).toBe(true);
    // Belt-and-braces: the legacy hint label string must not reappear.
    expect(auto.textContent).not.toContain(
      "auto-generated from look-through data",
    );
  });

  it("renders the curated comment verbatim when present", () => {
    const etf = makeEtf({ comment: "Hand-written editorial comment." });
    renderCell(etf);

    expect(screen.getByText("Hand-written editorial comment.")).toBeTruthy();
    expect(
      screen.queryByTestId(`etf-impl-auto-description-${etf.bucket}`),
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

  it("treats a backfilled comment (commentSource=justetf) as curated text — no italic, no fallback", () => {
    // Task #207 — once the backfill stamps justETF prose into `comment`,
    // the cell must render it verbatim like any operator-curated text.
    // The provenance tag is bookkeeping for the next refresh job, not a
    // visual flag.
    const etf = makeEtf({
      comment: "Backfilled justETF investment objective.",
      commentSource: "justetf",
    });
    renderCell(etf);

    expect(
      screen.getByText("Backfilled justETF investment objective."),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`etf-impl-auto-description-${etf.bucket}`),
    ).toBeNull();
  });
});
