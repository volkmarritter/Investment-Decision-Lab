// ----------------------------------------------------------------------------
// exportEtfImplementationXlsx.test.ts
// ----------------------------------------------------------------------------
// Locks in the contract of the Build tab's ETF Implementation Excel export.
//
// Why this exists
// ---------------
// The export is a pure helper that turns the on-screen `etfImplementation`
// rows into a SheetJS workbook. The key acceptance criteria are:
//
//   * Column ORDER matches the on-screen table exactly (Asset Class →
//     Weight → Name → ISIN → Ticker (Exch) → TER → Domicile → Replication →
//     Distribution → Currency → Comment).
//   * Column HEADERS use the localised strings from the i18n bundle (we
//     pass a fake `t` here so the test does not depend on the React i18n
//     context — the production caller passes the real `t` from `useT()`).
//   * Weight and TER cells are written as REAL NUMBERS (cell type "n"),
//     not strings. Weight is stored as a 0–1 fraction with the "0.00%"
//     format so the user can sort / sum / aggregate it directly in Excel.
//   * Manual-weight overrides and alternative-ETF picks (which have
//     already been baked into `output.etfImplementation` by the engine
//     before reaching this helper) flow through the export verbatim.
//   * The Comment column resolves through the SAME helper the on-screen
//     cell uses (`resolveEtfImplementationComment`), so a curated comment
//     wins and a blank curated comment falls back to the auto-generated
//     description.
//
// Tests parse the workbook back via `XLSX.read` and assert against the
// resulting cell objects, which is the closest we can get to "what would
// Excel actually see when opening this file" without booting a real
// spreadsheet engine.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildEtfImplementationFilename,
  buildEtfImplementationWorkbook,
} from "../src/lib/exportEtfImplementationXlsx";
import type { ETFImplementation } from "../src/lib/types";

// A deliberately tiny fake `t`: returns the key wrapped in [[ ]] so we
// can assert on column-header text without depending on the EN/DE bundle
// or on the React i18n provider. The production caller passes the real
// `t` from `useT()`.
const fakeT = (key: string) => `[[${key}]]`;

// Two fixture rows that exercise the interesting branches:
//   1. A curated-comment row with an explicit manual-override flag and an
//      alt-ETF pick (selectedSlot=1) — both of which must flow through
//      verbatim because the engine has already baked them into the row.
//   2. A blank-comment row whose ISIN matches a real look-through-only
//      catalog entry (IE00BM67HT60 = Xtrackers MSCI World IT) so the
//      auto-description fallback fires through the shared resolver.
function curatedRow(): ETFImplementation {
  return {
    bucket: "Equity - USA",
    assetClass: "Equity",
    weight: 42.5,
    intent: "Core US equity exposure",
    exampleETF: "iShares Core S&P 500 UCITS ETF (Acc)",
    rationale: "Cheap broad US large-cap.",
    isin: "IE00B5BMR087",
    ticker: "CSPX",
    exchange: "LSE",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical (Full)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Hand-written editorial comment.",
    isManualOverride: true,
    catalogKey: "equity_us_core",
    selectedSlot: 1,
    selectableOptions: [
      { name: "iShares Core S&P 500 UCITS ETF (Acc)", isin: "IE00B5BMR087", terBps: 7 },
      { name: "Vanguard S&P 500 UCITS ETF (Acc)", isin: "IE00BFMXXD54", terBps: 7 },
    ],
  };
}

function fallbackRow(): ETFImplementation {
  return {
    bucket: "Equity - Technology",
    assetClass: "Equity",
    weight: 12.5,
    intent: "Tech tilt",
    exampleETF: "Xtrackers MSCI World Information Technology UCITS ETF",
    rationale: "Sector tilt.",
    isin: "IE00BM67HT60",
    ticker: "XDWT",
    exchange: "XETRA",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical (Sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "", // intentionally blank → triggers auto-description fallback
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
  };
}

/** Round-trip the workbook through serialise→parse so the assertions look
 *  at the same cell representation Excel would. We use `cellStyles: true`
 *  so the number-format string survives the round trip — without it
 *  SheetJS drops the `z` property on the parsed cells. */
function roundTrip(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  const parsed = XLSX.read(buf, { type: "buffer", cellStyles: true });
  const sheetName = parsed.SheetNames[0];
  return parsed.Sheets[sheetName];
}

/** Convenience: pull the cell at column letter `col` (A, B, …) of row
 *  `row` (1-indexed, matching Excel's coordinate system). Returns
 *  `undefined` when the cell is genuinely empty. */
function cellAt(sheet: XLSX.WorkSheet, col: string, row: number): XLSX.CellObject | undefined {
  return sheet[`${col}${row}`] as XLSX.CellObject | undefined;
}

describe("buildEtfImplementationWorkbook", () => {
  it("emits one sheet titled 'ETF Implementation' regardless of UI language", () => {
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    expect(wb.SheetNames).toEqual(["ETF Implementation"]);

    const wbDe = buildEtfImplementationWorkbook([curatedRow()], fakeT, "de");
    expect(wbDe.SheetNames).toEqual(["ETF Implementation"]);
  });

  it("writes column headers in the on-screen order using the i18n strings", () => {
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    const sheet = roundTrip(wb);

    // Header row is row 1 in Excel coordinates. Column letters A..K cover
    // the eleven on-screen columns. The order MUST match the on-screen
    // ETF Implementation table (BuildPortfolio.tsx lines ~1279–1302).
    const expected: Array<[string, string]> = [
      ["A", "build.impl.col.assetClass"],
      ["B", "build.impl.col.weight"],
      ["C", "build.impl.col.name"],
      ["D", "build.impl.col.isin"],
      ["E", "build.impl.col.ticker"],
      ["F", "build.impl.col.ter"],
      ["G", "build.impl.col.domicile"],
      ["H", "build.impl.col.replication"],
      ["I", "build.impl.col.distribution"],
      ["J", "build.impl.col.currency"],
      ["K", "build.impl.col.comment"],
    ];
    for (const [col, key] of expected) {
      const cell = cellAt(sheet, col, 1);
      expect(cell?.t, `header ${col}1 should be a string cell`).toBe("s");
      expect(cell?.v, `header ${col}1 should equal localised ${key}`).toBe(`[[${key}]]`);
    }
    // No 12th header column should exist; we'd notice an off-by-one
    // immediately if a refactor accidentally added a column.
    expect(cellAt(sheet, "L", 1)).toBeUndefined();
  });

  it("writes Weight as a numeric 0–1 fraction with a percentage format", () => {
    // Engine emits 42.5 (percent). The export must convert to 0.425 and
    // attach a "0.00%" format so Excel renders "42.50%" while the
    // underlying stored value stays a real number for SUM / AVG / etc.
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    const sheet = roundTrip(wb);
    const weight = cellAt(sheet, "B", 2);
    expect(weight?.t).toBe("n");
    expect(weight?.v).toBeCloseTo(0.425, 5);
    expect(weight?.z).toBe("0.00%");
  });

  it("writes TER as a numeric fraction with a percentage format", () => {
    // 7 bps == 0.07% == 0.0007 as a fraction.
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    const sheet = roundTrip(wb);
    const ter = cellAt(sheet, "F", 2);
    expect(ter?.t).toBe("n");
    expect(ter?.v).toBeCloseTo(0.0007, 8);
    expect(ter?.z).toBe("0.00%");
  });

  it("preserves manual-override and alt-ETF picks because they're already baked into the row", () => {
    // The engine bakes manual weight overrides and alt-ETF selections
    // into etfImplementation rows BEFORE this helper sees them; the
    // export's contract is to reflect the row exactly as given. This
    // test feeds a row whose `weight` already reflects an override and
    // whose `exampleETF`/`isin` reflect an alt-ETF pick, and asserts the
    // export passes them through verbatim — so a future refactor that
    // drops the override or accidentally falls back to the catalog
    // default would be caught here.
    const overridden = { ...curatedRow(), weight: 33.0, exampleETF: "Vanguard S&P 500 UCITS ETF (Acc)", isin: "IE00BFMXXD54" };
    const wb = buildEtfImplementationWorkbook([overridden], fakeT, "en");
    const sheet = roundTrip(wb);

    // Weight must reflect the override (33% → 0.33), not the original 42.5%.
    expect(cellAt(sheet, "B", 2)?.v).toBeCloseTo(0.33, 5);
    // Name + ISIN must reflect the alt-ETF pick the user chose.
    expect(cellAt(sheet, "C", 2)?.v).toBe("Vanguard S&P 500 UCITS ETF (Acc)");
    expect(cellAt(sheet, "D", 2)?.v).toBe("IE00BFMXXD54");
  });

  it("emits the curated comment verbatim when present", () => {
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    const sheet = roundTrip(wb);
    const cell = cellAt(sheet, "K", 2);
    expect(cell?.t).toBe("s");
    expect(cell?.v).toBe("Hand-written editorial comment.");
  });

  it("falls back to the auto-generated description when the curated comment is blank", () => {
    // The fallback row uses IE00BM67HT60 which has a real look-through
    // profile shipped with the catalog, so `describeEtf()` must produce
    // a non-empty sentence. We don't snapshot the full sentence (the
    // template is allowed to evolve) — we just guard that the cell is
    // populated and contains the canonical "ETF" lead noun the template
    // always lands on. This pins the cell↔export sync without coupling
    // the test to template wording.
    const wb = buildEtfImplementationWorkbook([fallbackRow()], fakeT, "en");
    const sheet = roundTrip(wb);
    const cell = cellAt(sheet, "K", 2);
    expect(cell?.t).toBe("s");
    expect(typeof cell?.v).toBe("string");
    expect((cell?.v as string).length).toBeGreaterThan(10);
    expect(cell?.v as string).toMatch(/ETF/);
  });

  it("picks the German auto-description when lang='de'", () => {
    // Same fallback row, German locale → the resolver should pick the
    // German sentence ("Aktien-ETF …" lead). We assert on a German-only
    // word ("ETF" appears in both languages, but the German template
    // always emits "Aktien-" or "Renten-" or "thesaurierender" — all of
    // which start with lowercase letters not present in the EN sentence).
    const wb = buildEtfImplementationWorkbook([fallbackRow()], fakeT, "de");
    const sheet = roundTrip(wb);
    const text = cellAt(sheet, "K", 2)?.v as string;
    expect(typeof text).toBe("string");
    // At least one of the German-only template fragments should appear.
    const isGerman =
      /thesaurierender|ausschüttender|Aktien-ETF|Renten-ETF|konzentriert|Portfolio ist/.test(
        text,
      );
    expect(isGerman, `expected German auto-description, got: ${text}`).toBe(true);
  });

  it("renders the Ticker column as 'TICKER (EXCHANGE)' when an exchange is set", () => {
    const wb = buildEtfImplementationWorkbook([curatedRow()], fakeT, "en");
    const sheet = roundTrip(wb);
    const ticker = cellAt(sheet, "E", 2);
    expect(ticker?.t).toBe("s");
    expect(ticker?.v).toBe("CSPX (LSE)");
  });

  it("emits one data row per input ETF, in the input order", () => {
    const wb = buildEtfImplementationWorkbook(
      [curatedRow(), fallbackRow()],
      fakeT,
      "en",
    );
    const sheet = roundTrip(wb);
    // Asset class column on rows 2 and 3 should match the two fixtures
    // in order; row 4 must not exist.
    expect(cellAt(sheet, "A", 2)?.v).toBe("Equity");
    expect(cellAt(sheet, "C", 2)?.v).toBe("iShares Core S&P 500 UCITS ETF (Acc)");
    expect(cellAt(sheet, "C", 3)?.v).toBe(
      "Xtrackers MSCI World Information Technology UCITS ETF",
    );
    expect(cellAt(sheet, "A", 4)).toBeUndefined();
  });

  it("uses the on-screen i18n label for the Distribution column (sync with cell)", () => {
    // Regression guard for a real bug found in code review: the export
    // initially hardcoded "Acc"/"Dist" / "Thes"/"Aussch" while the
    // on-screen table renders the full i18n labels
    // ("Accumulating"/"Distributing" in EN, "Thesaurierend"/"Ausschüttend"
    // in DE). The fix is to pass the same `t` translator down to the
    // Distribution column builder. This test pins both sides:
    //   - Acc row → translated value of build.impl.dist.acc
    //   - Dist row → translated value of build.impl.dist.dist
    // We use a stand-in `t` that returns identifiable tokens so we can
    // assert on the *key the export looked up*, decoupling the test
    // from any future copy change in the EN/DE bundle.
    const recording: string[] = [];
    const recT = (key: string) => {
      recording.push(key);
      // Echo back the key so the cell value is checkable from the test.
      return `<<${key}>>`;
    };
    const accRow = curatedRow(); // distribution: "Accumulating"
    const distRow: ETFImplementation = {
      ...curatedRow(),
      bucket: "Equity - Dist",
      distribution: "Distributing",
    };
    const wb = buildEtfImplementationWorkbook([accRow, distRow], recT, "en");
    const sheet = roundTrip(wb);

    expect(cellAt(sheet, "I", 2)?.v).toBe("<<build.impl.dist.acc>>");
    expect(cellAt(sheet, "I", 3)?.v).toBe("<<build.impl.dist.dist>>");
    // And the export must indeed have asked for these specific keys —
    // catches a future regression where someone reverts to a fixed map.
    expect(recording).toContain("build.impl.dist.acc");
    expect(recording).toContain("build.impl.dist.dist");
  });

  it("returns a workbook with no data rows when given an empty input", () => {
    // The button is disabled in this case, but the helper itself should
    // still degrade gracefully — if a future refactor flips the button's
    // disabled state without updating the helper, we don't want a
    // JS-level crash.
    const wb = buildEtfImplementationWorkbook([], fakeT, "en");
    const sheet = roundTrip(wb);
    // Header row is still emitted; no data rows after it.
    expect(cellAt(sheet, "A", 1)?.v).toBe("[[build.impl.col.assetClass]]");
    expect(cellAt(sheet, "A", 2)).toBeUndefined();
  });
});

describe("buildEtfImplementationFilename", () => {
  it("produces a YYYY-MM-DD-stamped .xlsx filename for the given date", () => {
    // 2026-04-29 → "etf-implementation-2026-04-29.xlsx". We pass an
    // explicit Date so the test is deterministic across days/timezones.
    const fname = buildEtfImplementationFilename(new Date(2026, 3, 29)); // April = 3
    expect(fname).toBe("etf-implementation-2026-04-29.xlsx");
  });

  it("zero-pads single-digit months and days", () => {
    const fname = buildEtfImplementationFilename(new Date(2026, 0, 5)); // Jan 5
    expect(fname).toBe("etf-implementation-2026-01-05.xlsx");
  });
});
