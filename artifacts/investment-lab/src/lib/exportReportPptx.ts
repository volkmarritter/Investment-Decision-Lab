/**
 * Builds a .pptx file from a ReportSnapshot and triggers a browser download.
 * Mirrors the visual language of the Portfolio Report Deck artifact
 * (navy/gold/cream, serif display + clean sans body, section markers and
 * accent rules), but uses native PPTX shapes/tables/charts so every
 * element stays fully editable in PowerPoint / Keynote / LibreOffice.
 */

import PptxGenJS from "pptxgenjs";
import type { buildReportSnapshot } from "./reportSnapshot";

type Snapshot = ReturnType<typeof buildReportSnapshot>;

// ---- Design tokens (mirroring portfolio-report-deck/src/index.css) -----
const NAVY = "0B2545";
const ACCENT = "C9A14A"; // gold
const ACCENT_SOFT = "E2D4A6"; // light gold tint
const ACCENT_PALE = "F1E6C2"; // paler gold tint
const PAPER = "FBF7EF"; // warm off-white slide bg
const CREAM = "F3ECDC"; // card bg
const INK = "14202E";
const INK_MUTED = "6B7280";
const RULE = "D6CFC1";

const BUCKET_EQUITY = "1A3A5C";
const BUCKET_BONDS = "3D7A5C";
const BUCKET_REALESTATE = "A86F3D";
const BUCKET_COMMODITIES = "8C5A30";
const BUCKET_CRYPTO = "6B4F8A";
const BUCKET_CASH = "8A8A8A";

const FONT_DISPLAY = "Georgia"; // serif (Fraunces stand-in)
const FONT_BODY = "Calibri"; // body sans (IBM Plex Sans stand-in)
const FONT_MONO = "Consolas"; // mono (IBM Plex Mono stand-in)

// LAYOUT_WIDE = 13.333" × 7.5"
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

type TableCell = {
  text: string;
  options?: PptxGenJS.TableCellProps;
};

// ---- Cell helpers -------------------------------------------------------
function headerCell(text: string, opts: PptxGenJS.TableCellProps = {}): TableCell {
  return {
    text,
    options: {
      bold: false,
      color: ACCENT,
      fill: { color: PAPER },
      align: "left",
      valign: "middle",
      fontFace: FONT_MONO,
      fontSize: 9,
      border: [
        { type: "none", color: PAPER },
        { type: "none", color: PAPER },
        { type: "solid", pt: 1, color: ACCENT },
        { type: "none", color: PAPER },
      ],
      ...opts,
    },
  };
}

function bodyCell(text: string, opts: PptxGenJS.TableCellProps = {}): TableCell {
  return {
    text,
    options: {
      color: INK,
      fill: { color: PAPER },
      align: "left",
      valign: "middle",
      fontFace: FONT_BODY,
      fontSize: 10,
      border: [
        { type: "none", color: PAPER },
        { type: "none", color: PAPER },
        { type: "solid", pt: 0.5, color: RULE },
        { type: "none", color: PAPER },
      ],
      ...opts,
    },
  };
}

// ---- Slide chrome -------------------------------------------------------
function paperSlide(pptx: PptxGenJS): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: PAPER };
  return slide;
}

function sectionHeader(
  slide: PptxGenJS.Slide,
  numberLabel: string, // e.g. "02 · Key metrics"
  pageLabel: string, // e.g. "p. 04"
  headline: string,
  subhead?: string,
) {
  slide.addText(numberLabel.toUpperCase(), {
    x: 0.9,
    y: 0.45,
    w: 9.0,
    h: 0.3,
    fontSize: 10,
    color: ACCENT,
    fontFace: FONT_MONO,
    charSpacing: 6,
  });
  slide.addText(pageLabel, {
    x: 11.2,
    y: 0.45,
    w: 1.3,
    h: 0.3,
    fontSize: 10,
    color: INK_MUTED,
    fontFace: FONT_MONO,
    align: "right",
  });
  slide.addText(headline, {
    x: 0.9,
    y: 0.9,
    w: 11.5,
    h: 0.9,
    fontSize: 38,
    color: NAVY,
    fontFace: FONT_DISPLAY,
    italic: false,
  });
  if (subhead) {
    slide.addText(subhead, {
      x: 0.9,
      y: 1.85,
      w: 8.6,
      h: 0.6,
      fontSize: 11,
      color: INK_MUTED,
      fontFace: FONT_BODY,
    });
  }
}

function accentRule(slide: PptxGenJS.Slide) {
  slide.addShape("rect", {
    x: 0,
    y: SLIDE_H - 0.08,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: ACCENT },
    line: { color: ACCENT, width: 0 },
  });
}

function metricCard(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  sub?: string,
  accent?: boolean,
) {
  slide.addShape("rect", {
    x,
    y,
    w,
    h,
    fill: { color: accent ? "FAEFD3" : CREAM },
    line: { color: accent ? ACCENT : RULE, width: 0.5 },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.18,
    y: y + 0.12,
    w: w - 0.36,
    h: 0.28,
    fontSize: 8,
    color: INK_MUTED,
    fontFace: FONT_MONO,
    charSpacing: 4,
  });
  slide.addText(value, {
    x: x + 0.18,
    y: y + 0.4,
    w: w - 0.36,
    h: 0.6,
    fontSize: 22,
    color: accent ? ACCENT : NAVY,
    fontFace: FONT_DISPLAY,
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.18,
      y: y + h - 0.35,
      w: w - 0.36,
      h: 0.28,
      fontSize: 9,
      color: INK_MUTED,
      fontFace: FONT_BODY,
    });
  }
}

function chip(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  accent?: boolean,
) {
  slide.addShape("rect", {
    x,
    y,
    w,
    h,
    fill: { color: accent ? "FAEFD3" : PAPER },
    line: { color: accent ? ACCENT : RULE, width: 0.5 },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.18,
    y: y + 0.18,
    w: w - 0.36,
    h: 0.24,
    fontSize: 8,
    color: INK_MUTED,
    fontFace: FONT_MONO,
    charSpacing: 4,
  });
  slide.addText(value, {
    x: x + 0.18,
    y: y + 0.42,
    w: w - 0.36,
    h: h - 0.5,
    fontSize: 18,
    color: accent ? ACCENT : NAVY,
    fontFace: FONT_DISPLAY,
  });
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function isoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// =========================================================================
export async function exportReportPptx(snapshot: Snapshot): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = snapshot.meta.reportTitle;
  pptx.author = "Investment Decision Lab";

  // ----------------------------------------------------------------- Cover
  {
    const slide = pptx.addSlide();
    slide.background = { color: NAVY };

    // Thin subtle grid pattern (decorative diagonals) — keep light to avoid
    // taking attention from the headline.
    for (let i = 0; i < 14; i++) {
      slide.addShape("line", {
        x: -1 + i * 1.1,
        y: 0,
        w: 0,
        h: SLIDE_H,
        line: { color: "FFFFFF", width: 0.5, transparency: 92 },
      });
    }

    // Top-left brand mark
    slide.addShape("rect", {
      x: 0.95,
      y: 0.75,
      w: 0.22,
      h: 0.22,
      fill: { color: ACCENT },
      line: { color: ACCENT, width: 0 },
      rotate: 45,
    });
    slide.addText("INVESTMENT DECISION LAB", {
      x: 1.35,
      y: 0.65,
      w: 6,
      h: 0.3,
      fontSize: 11,
      color: ACCENT,
      fontFace: FONT_MONO,
      charSpacing: 8,
    });
    slide.addText("A portfolio briefing", {
      x: 1.35,
      y: 0.97,
      w: 6,
      h: 0.25,
      fontSize: 9,
      color: "FFFFFF",
      transparency: 30,
      fontFace: FONT_MONO,
      charSpacing: 6,
    });

    // Top-right meta
    slide.addText(
      [
        { text: `Report ${snapshot.meta.reportId}\n`, options: { color: "FFFFFF", fontSize: 10, fontFace: FONT_MONO } },
        { text: `Issued ${snapshot.meta.generatedOn}`, options: { color: "FFFFFF", fontSize: 10, fontFace: FONT_MONO } },
      ],
      {
        x: 7.5,
        y: 0.65,
        w: 5,
        h: 0.6,
        align: "right",
      },
    );

    // Headline
    slide.addText("Portfolio", {
      x: 0.95,
      y: 2.4,
      w: 11.5,
      h: 1.5,
      fontSize: 96,
      color: "FFFFFF",
      fontFace: FONT_DISPLAY,
      bold: false,
    });
    slide.addText("Report.", {
      x: 0.95,
      y: 3.6,
      w: 11.5,
      h: 1.5,
      fontSize: 96,
      color: ACCENT,
      fontFace: FONT_DISPLAY,
      bold: false,
    });

    slide.addText(snapshot.meta.profileOneLiner, {
      x: 0.95,
      y: 5.15,
      w: 9.5,
      h: 0.6,
      fontSize: 18,
      color: "FFFFFF",
      fontFace: FONT_DISPLAY,
      italic: true,
    });

    // Bottom strip: 4 meta chips
    const stripY = 6.25;
    const items: Array<[string, string]> = [
      ["Base currency", snapshot.profile.baseCurrency],
      ["Correlation regime", snapshot.meta.correlationRegime],
      ["Generated on", snapshot.meta.generatedOn],
      ["Prepared for", snapshot.meta.preparedFor],
    ];
    items.forEach(([label, value], i) => {
      const colW = 2.7;
      const x = 0.95 + i * (colW + 0.2);
      slide.addText(label.toUpperCase(), {
        x,
        y: stripY,
        w: colW,
        h: 0.25,
        fontSize: 8,
        color: "FFFFFF",
        transparency: 50,
        fontFace: FONT_MONO,
        charSpacing: 5,
      });
      slide.addText(value, {
        x,
        y: stripY + 0.28,
        w: colW,
        h: 0.45,
        fontSize: 16,
        color: "FFFFFF",
        fontFace: FONT_DISPLAY,
      });
    });

    // Bottom accent strip
    slide.addShape("rect", {
      x: 0,
      y: SLIDE_H - 0.12,
      w: SLIDE_W,
      h: 0.12,
      fill: { color: ACCENT },
      line: { color: ACCENT, width: 0 },
    });
  }

  // ------------------------------------------------------ Table of Contents
  {
    const slide = paperSlide(pptx);
    sectionHeader(
      slide,
      "00 · Contents",
      "p. 02",
      "Inside this briefing.",
      "Eight sections cover the investor profile, headline numbers, target allocation, the ETF implementation, look-through holdings, the Monte Carlo projection, the fee picture, and the methodology / disclaimer.",
    );

    const startY = 2.7;
    const rowH = 0.42;
    snapshot.tocSections.forEach((s, i) => {
      const y = startY + i * rowH;
      slide.addText(String(s.n).padStart(2, "0"), {
        x: 0.9,
        y,
        w: 0.6,
        h: rowH - 0.05,
        fontSize: 13,
        color: ACCENT,
        fontFace: FONT_MONO,
      });
      slide.addText(s.title, {
        x: 1.6,
        y,
        w: 8.5,
        h: rowH - 0.05,
        fontSize: 16,
        color: NAVY,
        fontFace: FONT_DISPLAY,
      });
      slide.addText(s.page, {
        x: 10.5,
        y,
        w: 2,
        h: rowH - 0.05,
        fontSize: 11,
        color: INK_MUTED,
        fontFace: FONT_MONO,
        align: "right",
      });
      // Hairline separator
      slide.addShape("line", {
        x: 0.9,
        y: y + rowH - 0.04,
        w: 11.5,
        h: 0,
        line: { color: RULE, width: 0.5 },
      });
    });

    accentRule(slide);
  }

  // ----------------------------------------------------------------- Profile
  {
    const slide = paperSlide(pptx);
    const p = snapshot.profile;
    sectionHeader(
      slide,
      "01 · Profile summary",
      "p. 03",
      "Investor profile.",
      `${snapshot.meta.profileOneLiner} Jurisdiction: ${snapshot.meta.jurisdiction}. Correlation regime: ${snapshot.meta.correlationRegime}.`,
    );

    // 5 chips across
    const chipsY = 2.6;
    const chipW = 2.3;
    const chipH = 1.0;
    const chipGap = 0.18;
    const chipStartX = 0.9;
    const chipData: Array<[string, string, boolean]> = [
      ["Base currency", p.baseCurrency, true],
      ["Risk profile", p.riskProfile, false],
      ["Horizon", `${p.horizonYears} years`, false],
      ["Target equity", `${p.targetEquityPct}%`, true],
      ["# of ETFs", String(p.numEtfs), false],
    ];
    chipData.forEach(([label, value, accent], i) => {
      chip(slide, chipStartX + i * (chipW + chipGap), chipsY, chipW, chipH, label, value, accent);
    });

    // Engine toggles (left column)
    slide.addText("ENGINE TOGGLES", {
      x: 0.9,
      y: 4.1,
      w: 5.5,
      h: 0.3,
      fontSize: 9,
      color: ACCENT,
      fontFace: FONT_MONO,
      charSpacing: 5,
    });
    const toggles: Array<[string, string]> = [
      ["FX hedging on developed equity", p.toggles.hedging],
      ["Bond hedging", p.toggles.bondHedging],
      ["Synthetic ETFs", p.toggles.syntheticEtfs],
      ["Look-through holdings", p.toggles.lookThrough],
      ["Thematic tilts", p.toggles.thematic],
    ];
    toggles.forEach(([label, value], i) => {
      const y = 4.5 + i * 0.45;
      slide.addText(label, {
        x: 0.9,
        y,
        w: 4.2,
        h: 0.35,
        fontSize: 11,
        color: INK,
        fontFace: FONT_BODY,
      });
      const on = value !== "Off" && value !== "Aus" && value !== "N/A" && value !== "Nicht zutreffend";
      slide.addShape("roundRect", {
        x: 5.1,
        y: y + 0.04,
        w: 1.3,
        h: 0.28,
        fill: { color: on ? "FAEFD3" : "EAEAEA" },
        line: { color: on ? ACCENT : "EAEAEA", width: 0.5 },
        rectRadius: 0.14,
      });
      slide.addText(value.toUpperCase(), {
        x: 5.1,
        y: y + 0.04,
        w: 1.3,
        h: 0.28,
        fontSize: 8,
        color: on ? ACCENT : INK_MUTED,
        fontFace: FONT_MONO,
        align: "center",
        charSpacing: 4,
      });
    });

    // Mandate notes (right column)
    slide.addText("PROFILE NOTES", {
      x: 7.0,
      y: 4.1,
      w: 5.5,
      h: 0.3,
      fontSize: 9,
      color: ACCENT,
      fontFace: FONT_MONO,
      charSpacing: 5,
    });
    slide.addText(
      `A ${p.riskProfile.toLowerCase()} mandate built for a ${p.horizonYears}-year holding period at a ${p.targetEquityPct}% target equity weight. The equity sleeve is geographically broad; the defensive sleeve anchors risk. Hedging, look-through and thematic toggles are reflected verbatim in the engine output that drives every downstream slide.`,
      {
        x: 7.0,
        y: 4.5,
        w: 5.4,
        h: 2.4,
        fontSize: 12,
        color: INK,
        fontFace: FONT_BODY,
        paraSpaceBefore: 4,
      },
    );

    accentRule(slide);
  }

  // ------------------------------------------------------------- Key Metrics
  {
    const slide = paperSlide(pptx);
    const k = snapshot.keyMetrics;
    sectionHeader(
      slide,
      "02 · Key metrics",
      "p. 04",
      "The headline numbers.",
      "Forward-looking estimates from the engine's capital-market assumptions, blended at the portfolio's policy weights. Past performance is not a guide.",
    );

    // Five headline metrics across the top
    const metrics: Array<[string, string, string | undefined, boolean]> = [
      ["Expected return p.a.", k.expectedReturnPa, "Arithmetic, gross of tax", true],
      ["Volatility p.a.", k.volatilityPa, "Std. dev. of annual return", false],
      ["Sharpe ratio", k.sharpe, `Rf = ${k.riskFreeRate}`, false],
      ["Max drawdown", k.maxDrawdownP5, "5th percentile path", false],
      ["Alpha vs ACWI", k.alphaVsAcwi, "After hedging & costs", true],
    ];
    const mY = 2.7;
    const mH = 1.7;
    const mW = (SLIDE_W - 1.8 - 0.16 * 4) / 5;
    metrics.forEach(([label, value, sub, accent], i) => {
      metricCard(slide, 0.9 + i * (mW + 0.16), mY, mW, mH, label, value, sub, accent);
    });

    // Three insight cards across the bottom
    const cards: Array<[string, string]> = [
      ["Sharpe interpretation", k.sharpeInterpretation],
      ["Equity / defensive split", k.equityDefensiveSplit],
      ["Weighted TER", k.weightedTER],
    ];
    const cY = 4.8;
    const cH = 1.6;
    const cW = (SLIDE_W - 1.8 - 0.3 * 2) / 3;
    cards.forEach(([label, value], i) => {
      const x = 0.9 + i * (cW + 0.3);
      slide.addShape("rect", {
        x,
        y: cY,
        w: cW,
        h: cH,
        fill: { color: CREAM },
        line: { color: RULE, width: 0.5 },
      });
      slide.addText(label.toUpperCase(), {
        x: x + 0.2,
        y: cY + 0.18,
        w: cW - 0.4,
        h: 0.3,
        fontSize: 9,
        color: ACCENT,
        fontFace: FONT_MONO,
        charSpacing: 5,
      });
      slide.addText(value, {
        x: x + 0.2,
        y: cY + 0.55,
        w: cW - 0.4,
        h: cH - 0.7,
        fontSize: i === 0 ? 14 : 24,
        color: NAVY,
        fontFace: i === 0 ? FONT_BODY : FONT_DISPLAY,
      });
    });

    accentRule(slide);
  }

  // ------------------------------------------------------------- Allocation
  {
    const slide = paperSlide(pptx);
    const a = snapshot.allocation;
    sectionHeader(
      slide,
      "03 · Target allocation",
      "p. 05",
      "Where the money sits.",
      "Policy weights at the catalog-bucket level after look-through. The defensive sleeve anchors risk; equity is geographically diversified.",
    );

    // Allocation rows table on the left
    const rows: TableCell[][] = [
      [headerCell("Asset class / region"), headerCell("Group"), headerCell("Weight", { align: "right" })],
      ...a.rows.map((r) => [
        bodyCell(r.label),
        bodyCell(r.group, { color: INK_MUTED, fontSize: 9 }),
        bodyCell(`${r.weight.toFixed(1)}%`, {
          align: "right",
          fontFace: FONT_MONO,
        }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.9,
      y: 2.7,
      w: 7.2,
      colW: [4.2, 1.5, 1.5],
      fontFace: FONT_BODY,
      autoPage: false,
    });

    // Group totals strip below the table
    const totals = a.groupTotals;
    const totalChips: Array<[string, number, string]> = [
      ["Equity", totals.equity, BUCKET_EQUITY],
      ["Real estate", totals.realestate, BUCKET_REALESTATE],
      ["Bonds", totals.bonds, BUCKET_BONDS],
      ["Commodities", totals.commodities, BUCKET_COMMODITIES],
      ["Crypto", totals.crypto, BUCKET_CRYPTO],
      ["Cash", totals.cash, BUCKET_CASH],
    ].filter(([, v]) => (v as number) > 0) as Array<[string, number, string]>;
    // Place small totals below the table.
    const totalsY = 6.4;
    const totalsW = 7.2;
    const cw = totalsW / Math.max(totalChips.length, 1);
    totalChips.forEach(([label, value, color], i) => {
      const x = 0.9 + i * cw;
      slide.addShape("rect", {
        x,
        y: totalsY + 0.05,
        w: 0.12,
        h: 0.6,
        fill: { color },
        line: { color, width: 0 },
      });
      slide.addText(label.toUpperCase(), {
        x: x + 0.18,
        y: totalsY,
        w: cw - 0.2,
        h: 0.28,
        fontSize: 8,
        color: INK_MUTED,
        fontFace: FONT_MONO,
        charSpacing: 4,
      });
      slide.addText(`${value}%`, {
        x: x + 0.18,
        y: totalsY + 0.26,
        w: cw - 0.2,
        h: 0.45,
        fontSize: 16,
        color: NAVY,
        fontFace: FONT_DISPLAY,
      });
    });

    // Doughnut chart on the right
    const groupOrder: Array<keyof typeof a.groupTotals> = [
      "equity",
      "realestate",
      "bonds",
      "commodities",
      "crypto",
      "cash",
    ];
    const groupLabels: Record<keyof typeof a.groupTotals, string> = {
      equity: "Equity",
      realestate: "Real estate",
      bonds: "Bonds",
      commodities: "Commodities",
      crypto: "Crypto",
      cash: "Cash",
    };
    const palette: Record<keyof typeof a.groupTotals, string> = {
      equity: BUCKET_EQUITY,
      realestate: BUCKET_REALESTATE,
      bonds: BUCKET_BONDS,
      commodities: BUCKET_COMMODITIES,
      crypto: BUCKET_CRYPTO,
      cash: BUCKET_CASH,
    };
    const pieLabels: string[] = [];
    const pieValues: number[] = [];
    const pieColors: string[] = [];
    groupOrder.forEach((key) => {
      const v = a.groupTotals[key];
      if (v && v > 0) {
        pieLabels.push(groupLabels[key]);
        pieValues.push(v);
        pieColors.push(palette[key]);
      }
    });
    if (pieValues.length > 0) {
      slide.addChart(
        pptx.ChartType.doughnut,
        [{ name: "Allocation", labels: pieLabels, values: pieValues }],
        {
          x: 8.4,
          y: 2.7,
          w: 4.4,
          h: 4.3,
          chartColors: pieColors,
          showLegend: true,
          legendPos: "b",
          legendFontFace: FONT_BODY,
          legendFontSize: 10,
          legendColor: INK,
          showPercent: true,
          dataLabelColor: "FFFFFF",
          dataLabelFontFace: FONT_MONO,
          dataLabelFontSize: 10,
          holeSize: 62,
          showTitle: false,
          chartArea: { fill: { color: PAPER }, border: { pt: 0, color: PAPER } },
          plotArea: { fill: { color: PAPER } },
        },
      );
    }

    accentRule(slide);
  }

  // ----------------------------------------------------- ETF Implementation
  {
    const slide = paperSlide(pptx);
    sectionHeader(
      slide,
      "04 · ETF implementation",
      "p. 06",
      "The instruments.",
      "Each policy bucket is implemented by a single editable, low-cost UCITS ETF. Weights, TERs and per-bucket notes flow straight from the catalog.",
    );

    const rows: TableCell[][] = [
      [
        headerCell("#", { align: "right" }),
        headerCell("Bucket"),
        headerCell("Name"),
        headerCell("ISIN"),
        headerCell("Ticker"),
        headerCell("Weight", { align: "right" }),
        headerCell("TER", { align: "right" }),
        headerCell("Comment"),
      ],
      ...snapshot.etfs.map((e) => [
        bodyCell(String(e.n), { fontSize: 9, align: "right", color: INK_MUTED }),
        bodyCell(e.bucket, { fontSize: 9 }),
        bodyCell(e.name, { fontSize: 9, color: NAVY }),
        bodyCell(e.isin, { fontSize: 8, fontFace: FONT_MONO, color: INK_MUTED }),
        bodyCell(e.ticker, { fontSize: 8, fontFace: FONT_MONO }),
        bodyCell(e.weight, { fontSize: 9, align: "right", fontFace: FONT_MONO }),
        bodyCell(e.ter, { fontSize: 9, align: "right", fontFace: FONT_MONO, color: INK_MUTED }),
        bodyCell(e.comment, { fontSize: 8, color: INK_MUTED }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 2.6,
      w: 12.3,
      colW: [0.45, 1.55, 2.55, 1.45, 0.95, 0.9, 0.8, 3.65],
      fontFace: FONT_BODY,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 0.6,
    });

    accentRule(slide);
  }

  // -------------------------------------------------- Top Equity Holdings
  {
    const slide = paperSlide(pptx);
    sectionHeader(
      slide,
      "05 · Top equity holdings",
      "p. 07",
      "What's actually underneath.",
      "The largest single-issuer exposures after looking through each equity ETF to its constituent positions, ranked by share of total portfolio.",
    );

    const rows: TableCell[][] = [
      [
        headerCell("#", { align: "right" }),
        headerCell("Name"),
        headerCell("Source"),
        headerCell("% Portfolio", { align: "right" }),
        headerCell("% Equity", { align: "right" }),
      ],
      ...snapshot.holdings.map((h) => [
        bodyCell(String(h.n), { align: "right", color: INK_MUTED }),
        bodyCell(h.name, { color: NAVY }),
        bodyCell(h.source, { color: INK_MUTED, fontSize: 10 }),
        bodyCell(h.pctPortfolio, { align: "right", fontFace: FONT_MONO }),
        bodyCell(h.pctEquity, { align: "right", fontFace: FONT_MONO, color: INK_MUTED }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.9,
      y: 2.6,
      w: 11.5,
      colW: [0.5, 5.4, 3.1, 1.3, 1.2],
      fontFace: FONT_BODY,
    });

    accentRule(slide);
  }

  // ----------------------------------------------------------- Monte Carlo
  {
    const slide = paperSlide(pptx);
    const m = snapshot.monteCarlo;
    sectionHeader(
      slide,
      "06 · Monte Carlo projection",
      "p. 08",
      `${m.horizonYears}-year outcomes.`,
      `${m.paths} simulated paths over a ${m.horizonYears}-year horizon, drawn from the engine's capital-market assumptions. Values rebased so today = 100.`,
    );

    // Fan chart (left ~58% of width)
    const series = m.pathSeries;
    if (series && series.length > 1) {
      const labels = series.map((p) => String(p.year));
      const p10 = series.map((p) => p.p10);
      const lower = series.map((p) => Math.max(0, p.p50 - p.p10));
      const upper = series.map((p) => Math.max(0, p.p90 - p.p50));
      const p50 = series.map((p) => p.p50);

      // 2-arg combo-chart form (pptxgenjs 4.0.1 has a bug in the 3-arg form
      // where empty `data` is consumed as the options object).
      (slide.addChart as unknown as (
        type: PptxGenJS.IChartMulti[],
        options: PptxGenJS.IChartOpts,
      ) => PptxGenJS.Slide)(
        [
          {
            type: pptx.ChartType.area,
            data: [
              { name: "P10 base", labels, values: p10 },
              { name: "P10–P50 band", labels, values: lower },
              { name: "P50–P90 band", labels, values: upper },
            ],
            options: {
              barGrouping: "stacked",
              // The first series is rendered in the paper colour so it
              // disappears against the chart background, leaving the two
              // gold-tinted bands stacked above as the visible fan.
              chartColors: [PAPER, ACCENT_SOFT, ACCENT_PALE],
            },
          },
          {
            type: pptx.ChartType.line,
            data: [{ name: "P50 (median)", labels, values: p50 }],
            options: {
              chartColors: [NAVY],
              lineSize: 2.5,
              lineDataSymbol: "none",
            },
          },
        ],
        {
          x: 0.9,
          y: 2.6,
          w: 7.7,
          h: 4.4,
          showLegend: true,
          legendPos: "b",
          legendFontFace: FONT_BODY,
          legendFontSize: 9,
          legendColor: INK,
          catAxisTitle: "Years",
          catAxisTitleFontFace: FONT_MONO,
          catAxisTitleFontSize: 9,
          catAxisLabelFontFace: FONT_MONO,
          catAxisLabelFontSize: 8,
          catAxisLabelColor: INK_MUTED,
          showCatAxisTitle: true,
          valAxisTitle: "Index (start = 100)",
          valAxisTitleFontFace: FONT_MONO,
          valAxisTitleFontSize: 9,
          valAxisLabelFontFace: FONT_MONO,
          valAxisLabelFontSize: 8,
          valAxisLabelColor: INK_MUTED,
          showValAxisTitle: true,
          showTitle: false,
          chartArea: { fill: { color: PAPER }, border: { pt: 0, color: PAPER } },
          plotArea: { fill: { color: CREAM } },
        },
      );
    }

    // Six metric cards on the right (3 × 2)
    const grid: Array<[string, string, string | undefined]> = [
      ["P50 final", String(m.finalP50), m.finalP50CAGR],
      ["P10 final", String(m.finalP10), m.finalP10CAGR],
      ["P90 final", String(m.finalP90), m.finalP90CAGR],
      ["Exp. return", m.expReturnGeom, "geom., p.a."],
      ["Exp. volatility", m.expVol, "annualised"],
      ["P(loss)", m.pLoss15y, `at ${m.horizonYears}y`],
    ];
    const gx0 = 8.85;
    const gy0 = 2.6;
    const gW = 1.95;
    const gH = 1.4;
    const gxGap = 0.08;
    const gyGap = 0.08;
    grid.forEach(([label, value, sub], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      metricCard(
        slide,
        gx0 + col * (gW + gxGap),
        gy0 + row * (gH + gyGap),
        gW,
        gH,
        label,
        value,
        sub,
        false,
      );
    });

    accentRule(slide);
  }

  // ------------------------------------------------------------------- Fees
  {
    const slide = paperSlide(pptx);
    const f = snapshot.fees;
    sectionHeader(
      slide,
      "07 · Fee estimate",
      "p. 09",
      "The cost picture.",
      `Portfolio size ${f.portfolioSize}. Blended TER ${f.blendedTERPct} (${f.blendedTERBps} bps). Numbers include an indicative trading & FX-spread drag on top of the weighted TER.`,
    );

    // Three big stat cards across the top
    const topStats: Array<[string, string, string | undefined, boolean]> = [
      ["Year 1 fee", f.year1FeeCHF, "All-in, illustrative", true],
      ["Total drag (horizon)", f.totalDrag15yCHF, "Compounded across years", false],
      ["Drag p.a.", f.totalDragPctPa, "TER + trading & FX", false],
    ];
    const tY = 2.6;
    const tH = 1.6;
    const tW = (SLIDE_W - 1.8 - 0.3 * 2) / 3;
    topStats.forEach(([label, value, sub, accent], i) => {
      metricCard(slide, 0.9 + i * (tW + 0.3), tY, tW, tH, label, value, sub, accent);
    });

    // Breakdown table below
    const rows: TableCell[][] = [
      [
        headerCell("Bucket"),
        headerCell("Weight", { align: "right" }),
        headerCell("TER (bps)", { align: "right" }),
        headerCell("Contribution (bps)", { align: "right" }),
      ],
      ...f.rows.map((r) => [
        bodyCell(r.bucket, { color: NAVY }),
        bodyCell(r.weightPct, { align: "right", fontFace: FONT_MONO }),
        bodyCell(String(r.terBps), { align: "right", fontFace: FONT_MONO, color: INK_MUTED }),
        bodyCell(r.contributionBps.toFixed(2), { align: "right", fontFace: FONT_MONO }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.9,
      y: 4.5,
      w: 11.5,
      colW: [5.6, 1.7, 1.9, 2.3],
      fontFace: FONT_BODY,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 0.6,
    });

    accentRule(slide);
  }

  // -------------------------------------- Important Disclaimer & Risk Warning
  // Mirrors artifacts/portfolio-report-deck/src/pages/slides/Disclaimer3.tsx.
  {
    const slide = paperSlide(pptx);

    // Top markers
    slide.addText("RISK WARNING", {
      x: 0.9,
      y: 0.45,
      w: 9,
      h: 0.3,
      fontSize: 10,
      color: ACCENT,
      fontFace: FONT_MONO,
      charSpacing: 6,
    });
    slide.addText("p. 10 · Final notice", {
      x: 9.5,
      y: 0.45,
      w: 3.0,
      h: 0.3,
      fontSize: 10,
      color: INK_MUTED,
      fontFace: FONT_MONO,
      align: "right",
    });

    // Headline
    slide.addText("Important Disclaimer & Risk Warning", {
      x: 0.9,
      y: 0.85,
      w: 11.5,
      h: 0.7,
      fontSize: 30,
      color: NAVY,
      fontFace: FONT_DISPLAY,
    });
    slide.addText(
      "Please read this disclaimer carefully before relying on any output of the Investment Decision Lab.",
      {
        x: 0.9,
        y: 1.55,
        w: 11.5,
        h: 0.35,
        fontSize: 11,
        italic: true,
        color: INK_MUTED,
        fontFace: FONT_BODY,
      },
    );

    // Two-column section layout
    type Sec = { heading: string; body: string };
    const leftSections: Sec[] = [
      {
        heading: "No Investment Advice.",
        body: "The information, allocations, ETF examples, rationales, scenarios, and any other content generated by this tool are provided strictly for general informational and educational purposes. They do not constitute investment advice, a personal recommendation, an offer or solicitation to buy or sell any financial instrument, nor a suitability or appropriateness assessment within the meaning of MiFID II, FIDLEG/FinSA, or any other applicable regulation.",
      },
      {
        heading: "Illustrative & Deterministic Outputs.",
        body: "All allocations, fee estimates, stress-test impacts, and example ETFs are produced by a deterministic rule-based engine using simplified assumptions and illustrative parameters (e.g. assumed TERs, hypothetical historical-style shocks). They are not forecasts, not based on live market data, and should not be interpreted as projections of actual future performance.",
      },
      {
        heading: "Risk of Loss & Past Performance.",
        body: "All investments involve risk, including the possible loss of the entire principal. Past performance and historical scenarios are not reliable indicators of future results. Equity, bond, commodity, real-estate, and digital-asset markets can experience severe and prolonged drawdowns. Currency movements can materially affect returns for non-base-currency exposures.",
      },
      {
        heading: "No Personalized Advice or Fiduciary Relationship.",
        body: "This tool does not know your full financial situation, objectives, liquidity needs, tax position, regulatory status, or capacity for loss. No fiduciary, advisory, or client relationship is created by your use of this tool. You remain solely responsible for any investment decision you make.",
      },
    ];
    const rightSections: Sec[] = [
      {
        heading: "Tax & Legal Considerations.",
        body: "Tax treatment depends on your individual circumstances and jurisdiction and may change. Certain instruments (including UCITS ETFs, US-domiciled ETFs, crypto assets, and derivatives) may not be available, suitable, or legally distributable to all investors. Always consult a qualified tax and legal adviser before acting.",
      },
      {
        heading: "Third-Party Instruments.",
        body: "Any ETF tickers, issuers, or product names shown are examples only and are not endorsements. We do not guarantee the accuracy, completeness, or current availability of any instrument. Always read the relevant Key Information Document (KID/KIID), prospectus, and factsheet before investing.",
      },
      {
        heading: "Seek Professional Advice.",
        body: "Before making any investment decision, you should obtain independent financial, tax, and legal advice from a duly licensed professional who can take your personal circumstances into account. By using this tool you acknowledge and accept the limitations described above and agree that the operators and authors disclaim, to the fullest extent permitted by law, any liability for losses arising from reliance on its output.",
      },
    ];

    const buildRichParas = (secs: Sec[]) =>
      secs.flatMap((s, i) => {
        const runs = [
          {
            text: s.heading + " ",
            options: { bold: true, color: NAVY, fontFace: FONT_BODY, fontSize: 9 },
          },
          {
            text: s.body,
            options: { color: INK, fontFace: FONT_BODY, fontSize: 9 },
          },
        ];
        if (i < secs.length - 1) {
          // Append blank-line spacer paragraph so PowerPoint renders a gap.
          runs.push({
            text: "\n",
            options: { color: INK, fontFace: FONT_BODY, fontSize: 6 },
          });
        }
        return runs;
      });

    // Geometry: leave room on the right column for the BICon callout.
    const colTop = 2.05;
    const colBottom = 7.1;
    const colW = 5.5;
    const colLeftX = 0.9;
    const colRightX = 6.95;
    const calloutH = 0.95;
    const calloutGap = 0.25;
    const rightTextH = colBottom - colTop - calloutH - calloutGap;

    slide.addText(buildRichParas(leftSections), {
      x: colLeftX,
      y: colTop,
      w: colW,
      h: colBottom - colTop,
      valign: "top",
      paraSpaceAfter: 4,
    });
    slide.addText(buildRichParas(rightSections), {
      x: colRightX,
      y: colTop,
      w: colW,
      h: rightTextH,
      valign: "top",
      paraSpaceAfter: 4,
    });

    // BICon showcase callout (bottom of right column)
    const calloutY = colTop + rightTextH + calloutGap;
    slide.addShape("roundRect", {
      x: colRightX,
      y: calloutY,
      w: colW,
      h: calloutH,
      fill: { color: "FAEFD3" },
      line: { color: ACCENT, width: 0.5 },
      rectRadius: 0.05,
    });
    slide.addText("A BICON SHOWCASE", {
      x: colRightX + 0.15,
      y: calloutY + 0.12,
      w: colW - 0.3,
      h: 0.28,
      fontSize: 8,
      color: ACCENT,
      fontFace: FONT_MONO,
      charSpacing: 5,
    });
    slide.addText(
      "The Investment Decision Lab is presented as a BICon showcase. Use of the tool implies acceptance of this disclaimer in full.",
      {
        x: colRightX + 0.15,
        y: calloutY + 0.4,
        w: colW - 0.3,
        h: calloutH - 0.5,
        fontSize: 9,
        color: INK,
        fontFace: FONT_BODY,
      },
    );

    accentRule(slide);
  }

  const baseName = safeFilename(`Investment-Report-${isoDate()}`);
  await pptx.writeFile({ fileName: `${baseName}.pptx` });
}
