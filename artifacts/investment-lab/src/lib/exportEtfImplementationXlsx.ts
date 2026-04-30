// ----------------------------------------------------------------------------
// exportEtfImplementationXlsx
// ----------------------------------------------------------------------------
// Pure (React-free) Excel export for the Build tab's ETF Implementation
// table. Produces a single-sheet `.xlsx` workbook with the same columns,
// in the same order, that the on-screen table renders. Numeric columns
// (Weight, TER) are written as real numbers with appropriate cell number
// formats so the user can sort and aggregate them in Excel directly.
//
// The Comment column is resolved through the same helper the on-screen
// cell uses (`resolveEtfImplementationComment`) so the export and the
// table stay in sync — including the auto-description fallback for
// look-through-only ETFs whose curated `comment` is blank.
//
// This module is deliberately split into:
//
//   * `buildEtfImplementationWorkbook(...)` — the pure builder, returned
//     as a SheetJS `WorkBook`. Tests parse this back with `XLSX.read`
//     and assert cell types, formats and values.
//   * `exportEtfImplementationXlsx(...)` — the thin browser-side trigger
//     that wraps `XLSX.writeFile(...)`. Not unit-tested; touching `window`
//     would force a jsdom / mocking dance that buys little for a one-line
//     wrapper.
//
// The filename is `etf-implementation-YYYY-MM-DD.xlsx`, intentionally
// untranslated (per the task spec). Sheet title is also untranslated and
// pinned at "ETF Implementation" so spreadsheets shared between operators
// are identifiable regardless of UI language.
// ----------------------------------------------------------------------------

import * as XLSX from "xlsx";
import type { Lang } from "./i18n";
import {
  resolveEtfImplementationComment,
  type EtfCommentInput,
} from "./etfImplementationCommentText";
import type { ETFImplementation } from "./types";

/** A `t` function compatible with the i18n-provided translator. We accept a
 *  bare `(key: string) => string` so the helper has zero React coupling. */
export type TranslateFn = (key: string) => string;

/** Frozen ordered list of the columns in the on-screen table. The Excel
 *  export must mirror this order one-for-one. Each entry pairs the i18n
 *  key for the header with the cell builder. The builder receives the
 *  same `t` translator used to render the on-screen table so the cell
 *  text is byte-aligned with what the user sees (this matters for the
 *  Distribution column in particular: on screen the user reads
 *  "Accumulating"/"Distributing", not "Acc"/"Dist"). */
type ExportColumn = {
  headerKey: string;
  build: (etf: ETFImplementation, lang: Lang, t: TranslateFn) => XLSX.CellObject;
};

/** Build a string cell. Empty / nullish inputs render as an empty string
 *  cell rather than a stub blank — older spreadsheet apps (Numbers,
 *  certain LibreOffice versions) handle real string cells more
 *  predictably than the SheetJS "z" (stub) cell type. */
function strCell(value: string | null | undefined): XLSX.CellObject {
  if (value == null) return { t: "s", v: "" };
  return { t: "s", v: String(value) };
}

/** Build a numeric cell with an optional Excel number format string.
 *  Non-finite inputs (NaN, Infinity) fall back to an empty string cell so
 *  Excel doesn't render "#NUM!" / "#VALUE!" for missing data. */
function numCell(value: number, format?: string): XLSX.CellObject {
  if (!Number.isFinite(value)) return { t: "s", v: "" };
  const cell: XLSX.CellObject = { t: "n", v: value };
  if (format) cell.z = format;
  return cell;
}

/** Resolve the "Ticker (Exchange)" cell, matching the on-screen rendering
 *  which appends `(EXCH)` after the ticker when the exchange is set and
 *  not the placeholder dash. Falls back to a bare ticker when no
 *  exchange is meaningful. */
function tickerWithExchange(etf: ETFImplementation): string {
  const t = (etf.ticker ?? "").trim();
  const exch = (etf.exchange ?? "").trim();
  if (!exch || exch === "—") return t;
  return t ? `${t} (${exch})` : exch;
}

/** Localised distribution label, mirroring the on-screen translation:
 *  Accumulating → "build.impl.dist.acc", Distributing → "build.impl.dist.dist".
 *  Uses the translator passed in (the same one the on-screen cell uses)
 *  so the export and the on-screen table never drift apart when the i18n
 *  bundle changes. */
function distributionLabel(
  etf: ETFImplementation,
  t: TranslateFn,
): string {
  return etf.distribution === "Accumulating"
    ? t("build.impl.dist.acc")
    : t("build.impl.dist.dist");
}

/** Column definitions in the canonical on-screen order. Note that the task
 *  spec calls out "Asset Class, Weight (%), Name, ISIN, Ticker, Exchange,
 *  TER (%), Domicile, Replication, Distribution, Currency, Comment" as
 *  separate Ticker and Exchange entries, but the on-screen table renders
 *  Ticker and Exchange together as a single "Ticker (Exchange)" column
 *  (i18n key `build.impl.col.ticker`). We follow the on-screen ordering
 *  because the spec also requires "the same columns shown in the on-screen
 *  table, in the same order"; if the on-screen layout ever splits them we
 *  will mirror that here. */
const COLUMNS: ExportColumn[] = [
  {
    headerKey: "build.impl.col.assetClass",
    build: (etf) => strCell(etf.assetClass),
  },
  {
    // Engine writes weight in 0–100 percent units. We convert to a 0–1
    // fraction and apply the "0.00%" format so Excel displays it as a
    // percentage but the underlying value is a real fraction users can
    // sort, sum and run formulas against.
    headerKey: "build.impl.col.weight",
    build: (etf) => numCell(etf.weight / 100, "0.00%"),
  },
  {
    headerKey: "build.impl.col.name",
    build: (etf) => strCell(etf.exampleETF),
  },
  {
    headerKey: "build.impl.col.isin",
    build: (etf) => strCell(etf.isin),
  },
  {
    headerKey: "build.impl.col.ticker",
    build: (etf) => strCell(tickerWithExchange(etf)),
  },
  {
    // TER is stored in basis points (terBps). 1bp = 0.01%, so dividing by
    // 10_000 turns it into a fraction; the "0.00%" format then displays
    // it correctly in Excel while keeping the underlying value sortable.
    headerKey: "build.impl.col.ter",
    build: (etf) => numCell(etf.terBps / 10_000, "0.00%"),
  },
  {
    headerKey: "build.impl.col.domicile",
    build: (etf) => strCell(etf.domicile),
  },
  {
    headerKey: "build.impl.col.replication",
    build: (etf) => strCell(etf.replication),
  },
  {
    headerKey: "build.impl.col.distribution",
    build: (etf, _lang, t) => strCell(distributionLabel(etf, t)),
  },
  {
    headerKey: "build.impl.col.currency",
    build: (etf) => strCell(etf.currency),
  },
  {
    headerKey: "build.impl.col.comment",
    build: (etf, lang) =>
      strCell(
        resolveEtfImplementationComment(etf as EtfCommentInput, lang).text,
      ),
  },
];

/** Sheet title is intentionally untranslated per the task spec. */
const SHEET_NAME = "ETF Implementation";

/** Build the workbook in-memory. Pure: no DOM, no `window`, safe to call
 *  from vitest. Returns a SheetJS `WorkBook` that callers can either
 *  `XLSX.writeFile` (production trigger) or `XLSX.write` (tests, to get a
 *  buffer they can re-parse and assert against). */
export function buildEtfImplementationWorkbook(
  rows: ETFImplementation[],
  t: TranslateFn,
  lang: Lang,
): XLSX.WorkBook {
  // Header row first, then one row per ETF. We assemble an
  // array-of-arrays-of-CellObject and hand-build the sheet so we can
  // attach number formats via the `z` property on individual cells —
  // `XLSX.utils.aoa_to_sheet` accepts CellObject inputs directly and
  // preserves them.
  const headerRow: XLSX.CellObject[] = COLUMNS.map((col) => ({
    t: "s",
    v: t(col.headerKey),
  }));
  const dataRows: XLSX.CellObject[][] = rows.map((etf) =>
    COLUMNS.map((col) => col.build(etf, lang, t)),
  );
  // Spacer row and disclaimer row appended after the data so the warning
  // travels with the file. The disclaimer text is pulled from the same
  // i18n key the on-screen table uses (`build.impl.disclaimer`), so EN
  // and DE exports always match what the user just saw above the table.
  const spacerRow: XLSX.CellObject[] = [];
  const disclaimerRow: XLSX.CellObject[] = [
    { t: "s", v: t("build.impl.disclaimer") },
  ];

  // Full 7-section legal disclaimer (same copy the PDF report carries),
  // appended after the ETF-table disclaimer with a blank spacer row in
  // between. Pulls verbatim text from the shared `disclaimer.sN.title`
  // / `disclaimer.sN.body` i18n keys so EN / DE exports stay in sync
  // with the PDF wording byte-for-byte.
  const SECTION_COUNT = 7;
  const legalSectionRows: XLSX.CellObject[][] = [];
  for (let i = 1; i <= SECTION_COUNT; i++) {
    legalSectionRows.push([{ t: "s", v: t(`disclaimer.s${i}.title`) }]);
    legalSectionRows.push([{ t: "s", v: t(`disclaimer.s${i}.body`) }]);
  }
  const legalSpacerRow: XLSX.CellObject[] = [];

  const sheet = XLSX.utils.aoa_to_sheet([
    headerRow,
    ...dataRows,
    spacerRow,
    disclaimerRow,
    legalSpacerRow,
    ...legalSectionRows,
  ]);

  // Merge the disclaimer cell across all data columns so the long warning
  // text wraps cleanly when the file is opened in Excel / Numbers /
  // LibreOffice instead of appearing to belong only to the Asset Class
  // column. Row index is 0-based for SheetJS ranges; the disclaimer row
  // sits at `1 + rows.length + 1` (header + data rows + spacer).
  const disclaimerRowIdx = 1 + rows.length + 1;
  const lastColIdx = COLUMNS.length - 1;
  const merges: XLSX.Range[] = [
    {
      s: { r: disclaimerRowIdx, c: 0 },
      e: { r: disclaimerRowIdx, c: lastColIdx },
    },
  ];

  // Merge every legal-section row across all data columns too. The
  // first title row sits at `disclaimerRowIdx + 2` (the +2 skips the
  // blank spacer between the ETF disclaimer and section 1).
  for (let n = 0; n < legalSectionRows.length; n++) {
    const r = disclaimerRowIdx + 2 + n;
    merges.push({ s: { r, c: 0 }, e: { r, c: lastColIdx } });
  }
  sheet["!merges"] = merges;

  // Mild column widths so the file opens with sensible column sizing
  // instead of every column collapsed to its header width. Values are
  // approximate Excel character widths (10 chars ≈ 70px in default font).
  // Order matches COLUMNS one-for-one.
  sheet["!cols"] = [
    { wch: 24 }, // Asset Class
    { wch: 10 }, // Weight
    { wch: 48 }, // ETF Name
    { wch: 16 }, // ISIN
    { wch: 18 }, // Ticker (Exchange)
    { wch: 8 },  // TER
    { wch: 14 }, // Domicile
    { wch: 16 }, // Replication
    { wch: 10 }, // Distribution
    { wch: 6 },  // Currency
    { wch: 60 }, // Comment
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, SHEET_NAME);
  return wb;
}

/** Filename helper, exposed for tests so they can pin the YYYY-MM-DD
 *  format without depending on the system clock. */
export function buildEtfImplementationFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `etf-implementation-${yyyy}-${mm}-${dd}.xlsx`;
}

/** Public export trigger. Builds the workbook and uses SheetJS's
 *  `writeFile` to download it via the browser. Safe to call in any
 *  browser context; `XLSX.writeFile` synthesises an `<a download>` click
 *  internally and cleans up after itself. */
export function exportEtfImplementationXlsx(
  rows: ETFImplementation[],
  t: TranslateFn,
  lang: Lang,
  filename: string = buildEtfImplementationFilename(),
): void {
  const wb = buildEtfImplementationWorkbook(rows, t, lang);
  XLSX.writeFile(wb, filename);
}
