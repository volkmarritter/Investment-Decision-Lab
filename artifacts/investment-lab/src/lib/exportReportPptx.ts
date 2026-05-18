/**
 * Builds a .pptx file from a ReportSnapshot and triggers a browser download.
 * Mirrors the slide structure of the Portfolio Report Deck artifact, but uses
 * native PPTX shapes/tables instead of rendered React.
 */

import PptxGenJS from "pptxgenjs";
import type { buildReportSnapshot } from "./reportSnapshot";

type Snapshot = ReturnType<typeof buildReportSnapshot>;

const NAVY = "0F2A4A";
const NAVY_LIGHT = "1F3D5A";
const WHITE = "FFFFFF";
const GREY_TEXT = "4A5568";
const BODY = "1A202C";
const FONT = "Calibri";

type TableCell = {
  text: string;
  options?: PptxGenJS.TableCellProps;
};

function headerCell(text: string): TableCell {
  return {
    text,
    options: {
      bold: true,
      color: WHITE,
      fill: { color: NAVY },
      align: "left",
      valign: "middle",
      fontFace: FONT,
      fontSize: 10,
    },
  };
}

function bodyCell(
  text: string,
  opts: PptxGenJS.TableCellProps = {},
): TableCell {
  return {
    text,
    options: {
      color: BODY,
      fill: { color: WHITE },
      align: "left",
      valign: "middle",
      fontFace: FONT,
      fontSize: 9,
      ...opts,
    },
  };
}

function addSlideTitle(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.addText(title, {
    x: 0.4,
    y: 0.3,
    w: 9.2,
    h: 0.55,
    fontSize: 22,
    bold: true,
    color: NAVY,
    fontFace: FONT,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4,
      y: 0.85,
      w: 9.2,
      h: 0.3,
      fontSize: 11,
      color: GREY_TEXT,
      fontFace: FONT,
    });
  }
  slide.addShape("line", {
    x: 0.4,
    y: 1.2,
    w: 9.2,
    h: 0,
    line: { color: NAVY, width: 1 },
  });
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function isoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function exportReportPptx(snapshot: Snapshot): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = snapshot.meta.reportTitle;
  pptx.author = "Investment Decision Lab";

  // ---------------------------------------------------------------- Cover
  {
    const slide = pptx.addSlide();
    slide.background = { color: NAVY };
    slide.addText(snapshot.meta.reportTitle, {
      x: 0.6,
      y: 2.2,
      w: 12,
      h: 1.0,
      fontSize: 36,
      bold: true,
      color: WHITE,
      fontFace: FONT,
    });
    slide.addText(snapshot.meta.profileOneLiner, {
      x: 0.6,
      y: 3.2,
      w: 12,
      h: 0.6,
      fontSize: 16,
      color: WHITE,
      fontFace: FONT,
    });
    slide.addText(
      [
        { text: `Prepared for: `, options: { bold: true, color: WHITE } },
        { text: snapshot.meta.preparedFor, options: { color: WHITE } },
      ],
      {
        x: 0.6,
        y: 4.5,
        w: 12,
        h: 0.4,
        fontSize: 13,
        fontFace: FONT,
      },
    );
    slide.addText(
      [
        { text: `Generated: `, options: { bold: true, color: WHITE } },
        { text: snapshot.meta.generatedOn, options: { color: WHITE } },
        { text: `   ·   Jurisdiction: `, options: { bold: true, color: WHITE } },
        { text: snapshot.meta.jurisdiction, options: { color: WHITE } },
      ],
      {
        x: 0.6,
        y: 4.95,
        w: 12,
        h: 0.4,
        fontSize: 13,
        fontFace: FONT,
      },
    );
    slide.addText(snapshot.meta.reportId, {
      x: 0.6,
      y: 6.6,
      w: 12,
      h: 0.3,
      fontSize: 10,
      color: WHITE,
      fontFace: FONT,
      italic: true,
    });
  }

  // ----------------------------------------------------- Table of Contents
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "Table of Contents");
    const rows: TableCell[][] = [
      [headerCell("#"), headerCell("Section"), headerCell("Page")],
      ...snapshot.tocSections.map((s) => [
        bodyCell(String(s.n)),
        bodyCell(s.title),
        bodyCell(s.page),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 1.4,
      w: 12.3,
      colW: [0.7, 9.6, 2.0],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });
  }

  // ---------------------------------------------------------- Profile
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "Profile Summary");
    const p = snapshot.profile;
    const rows: TableCell[][] = [
      [headerCell("Field"), headerCell("Value")],
      [bodyCell("Base currency"), bodyCell(p.baseCurrency)],
      [bodyCell("Risk profile"), bodyCell(p.riskProfile)],
      [bodyCell("Investment horizon"), bodyCell(`${p.horizonYears} years`)],
      [bodyCell("Target equity"), bodyCell(`${p.targetEquityPct}%`)],
      [bodyCell("Number of ETFs"), bodyCell(String(p.numEtfs))],
      [bodyCell("Currency hedging"), bodyCell(p.toggles.hedging)],
      [bodyCell("Bond hedging"), bodyCell(p.toggles.bondHedging)],
      [bodyCell("Synthetic ETFs"), bodyCell(p.toggles.syntheticEtfs)],
      [bodyCell("Look-through"), bodyCell(p.toggles.lookThrough)],
      [bodyCell("Thematic tilt"), bodyCell(p.toggles.thematic)],
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 1.4,
      w: 12.3,
      colW: [4.3, 8.0],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });
  }

  // ---------------------------------------------------------- Key Metrics
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "Key Metrics");
    const k = snapshot.keyMetrics;
    const rows: TableCell[][] = [
      [headerCell("Metric"), headerCell("Value")],
      [bodyCell("Expected return p.a."), bodyCell(k.expectedReturnPa)],
      [bodyCell("Volatility p.a."), bodyCell(k.volatilityPa)],
      [bodyCell("Sharpe ratio"), bodyCell(`${k.sharpe} — ${k.sharpeInterpretation}`)],
      [bodyCell("Risk-free rate"), bodyCell(k.riskFreeRate)],
      [bodyCell("Max drawdown (P5)"), bodyCell(k.maxDrawdownP5)],
      [bodyCell("Alpha vs ACWI"), bodyCell(k.alphaVsAcwi)],
      [bodyCell("Equity / defensive split"), bodyCell(k.equityDefensiveSplit)],
      [bodyCell("Weighted TER"), bodyCell(k.weightedTER)],
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 1.4,
      w: 12.3,
      colW: [4.3, 8.0],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });
  }

  // ---------------------------------------------------------- Allocation
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "Target Allocation");
    const a = snapshot.allocation;
    const rows: TableCell[][] = [
      [headerCell("Asset class / region"), headerCell("Group"), headerCell("Weight")],
      ...a.rows.map((r) => [
        bodyCell(r.label),
        bodyCell(r.group),
        bodyCell(`${r.weight.toFixed(1)}%`, { align: "right" }),
      ]),
    ];
    const totalsLabel = `Equity ${a.groupTotals.equity}%  ·  Real estate ${a.groupTotals.realestate}%  ·  Bonds ${a.groupTotals.bonds}%  ·  Cash ${a.groupTotals.cash}%${a.groupTotals.commodities ? `  ·  Commodities ${a.groupTotals.commodities}%` : ""}${a.groupTotals.crypto ? `  ·  Crypto ${a.groupTotals.crypto}%` : ""}`;
    rows.push([
      {
        text: totalsLabel,
        options: {
          colspan: 3,
          bold: true,
          color: WHITE,
          fill: { color: NAVY_LIGHT },
          align: "left",
          fontFace: FONT,
          fontSize: 10,
        },
      },
    ]);
    slide.addTable(rows, {
      x: 0.4,
      y: 1.4,
      w: 7.6,
      colW: [4.2, 1.7, 1.7],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });

    // Pie chart of group totals (navy palette).
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
      realestate: "Real Estate",
      bonds: "Bonds",
      commodities: "Commodities",
      crypto: "Crypto",
      cash: "Cash",
    };
    const palette = ["0F2A4A", "1F3D5A", "3A5A80", "6A89B3", "A0B8D8", "C9D6E6"];
    const pieLabels: string[] = [];
    const pieValues: number[] = [];
    const pieColors: string[] = [];
    groupOrder.forEach((key, i) => {
      const v = a.groupTotals[key];
      if (v && v > 0) {
        pieLabels.push(groupLabels[key]);
        pieValues.push(v);
        pieColors.push(palette[i % palette.length]);
      }
    });
    if (pieValues.length > 0) {
      slide.addChart(
        pptx.ChartType.doughnut,
        [{ name: "Allocation", labels: pieLabels, values: pieValues }],
        {
          x: 8.2,
          y: 1.4,
          w: 4.8,
          h: 5.4,
          chartColors: pieColors,
          showLegend: true,
          legendPos: "b",
          legendFontFace: FONT,
          legendFontSize: 9,
          legendColor: BODY,
          showPercent: true,
          dataLabelColor: WHITE,
          dataLabelFontFace: FONT,
          dataLabelFontSize: 9,
          holeSize: 55,
          showTitle: false,
        },
      );
    }
  }

  // ---------------------------------------------------------- ETF list
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "ETF Implementation");
    const rows: TableCell[][] = [
      [
        headerCell("#"),
        headerCell("Bucket"),
        headerCell("Name"),
        headerCell("ISIN"),
        headerCell("Ticker"),
        headerCell("Weight"),
        headerCell("TER"),
        headerCell("Comment"),
      ],
      ...snapshot.etfs.map((e) => [
        bodyCell(String(e.n), { fontSize: 8 }),
        bodyCell(e.bucket, { fontSize: 8 }),
        bodyCell(e.name, { fontSize: 8 }),
        bodyCell(e.isin, { fontSize: 8 }),
        bodyCell(e.ticker, { fontSize: 8 }),
        bodyCell(e.weight, { fontSize: 8, align: "right" }),
        bodyCell(e.ter, { fontSize: 8, align: "right" }),
        bodyCell(e.comment, { fontSize: 8 }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.2,
      y: 1.4,
      w: 12.9,
      colW: [0.4, 1.6, 2.6, 1.5, 1.0, 0.9, 0.8, 4.1],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 0.6,
    });
  }

  // ---------------------------------------------------------- Top Holdings
  {
    const slide = pptx.addSlide();
    addSlideTitle(slide, "Top 10 Equity Holdings");
    const rows: TableCell[][] = [
      [
        headerCell("#"),
        headerCell("Name"),
        headerCell("Source"),
        headerCell("% Portfolio"),
        headerCell("% Equity"),
      ],
      ...snapshot.holdings.map((h) => [
        bodyCell(String(h.n)),
        bodyCell(h.name),
        bodyCell(h.source),
        bodyCell(h.pctPortfolio, { align: "right" }),
        bodyCell(h.pctEquity, { align: "right" }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.4,
      y: 1.4,
      w: 12.5,
      colW: [0.6, 5.5, 3.4, 1.5, 1.5],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });
  }

  // ---------------------------------------------------------- Monte Carlo
  {
    const slide = pptx.addSlide();
    addSlideTitle(
      slide,
      "Monte Carlo Projection",
      `${snapshot.monteCarlo.paths} paths · ${snapshot.monteCarlo.horizonYears}-year horizon`,
    );
    const m = snapshot.monteCarlo;
    const rows: TableCell[][] = [
      [headerCell("Percentile"), headerCell("Final (start = 100)"), headerCell("Implied CAGR")],
      [bodyCell("P10 (downside)"), bodyCell(String(m.finalP10), { align: "right" }), bodyCell(m.finalP10CAGR, { align: "right" })],
      [bodyCell("P50 (median)"), bodyCell(String(m.finalP50), { align: "right" }), bodyCell(m.finalP50CAGR, { align: "right" })],
      [bodyCell("P90 (upside)"), bodyCell(String(m.finalP90), { align: "right" }), bodyCell(m.finalP90CAGR, { align: "right" })],
    ];
    slide.addTable(rows, {
      x: 0.4,
      y: 1.4,
      w: 6.0,
      colW: [2.2, 1.9, 1.9],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });

    const stats: TableCell[][] = [
      [headerCell("Statistic"), headerCell("Value")],
      [bodyCell("Expected return (geom.)"), bodyCell(m.expReturnGeom)],
      [bodyCell("Expected volatility"), bodyCell(m.expVol)],
      [bodyCell(`P(loss over ${m.horizonYears}y)`), bodyCell(m.pLoss15y)],
      [bodyCell(`P(double over ${m.horizonYears}y)`), bodyCell(m.pDouble15y)],
      [bodyCell("CVaR (5%)"), bodyCell(m.cvar5)],
    ];
    slide.addTable(stats, {
      x: 0.4,
      y: 4.0,
      w: 6.0,
      colW: [3.5, 2.5],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });

    // Fan chart: stacked-area trick — P10 band invisible, then (P50-P10)
    // and (P90-P50) layered in navy tints, with a P50 line on top.
    const series = m.pathSeries;
    if (series && series.length > 1) {
      const labels = series.map((p) => String(p.year));
      const p10 = series.map((p) => p.p10);
      const lower = series.map((p) => Math.max(0, p.p50 - p.p10));
      const upper = series.map((p) => Math.max(0, p.p90 - p.p50));
      const p50 = series.map((p) => p.p50);
      slide.addChart(
        [
          {
            type: pptx.ChartType.area,
            data: [
              { name: "P10 base", labels, values: p10 },
              { name: "P10–P50", labels, values: lower },
              { name: "P50–P90", labels, values: upper },
            ],
            options: {
              barGrouping: "stacked",
              // The first series ("P10 base") is rendered in white on a
              // white slide background so it disappears, leaving the two
              // tinted bands (P10–P50, P50–P90) visible as the fan.
              chartColors: ["FFFFFF", "6A89B3", "A0B8D8"],
            },
          },
          {
            type: pptx.ChartType.line,
            data: [{ name: "P50 (median)", labels, values: p50 }],
            options: {
              chartColors: [NAVY],
              lineSize: 2,
              lineDataSymbol: "none",
            },
          },
        ],
        [],
        {
          x: 6.6,
          y: 1.4,
          w: 6.6,
          h: 5.4,
          showLegend: true,
          legendPos: "b",
          legendFontFace: FONT,
          legendFontSize: 9,
          legendColor: BODY,
          catAxisTitle: "Years",
          catAxisTitleFontFace: FONT,
          catAxisTitleFontSize: 9,
          catAxisLabelFontFace: FONT,
          catAxisLabelFontSize: 8,
          showCatAxisTitle: true,
          valAxisTitle: "Index (start = 100)",
          valAxisTitleFontFace: FONT,
          valAxisTitleFontSize: 9,
          valAxisLabelFontFace: FONT,
          valAxisLabelFontSize: 8,
          showValAxisTitle: true,
          showTitle: false,
        },
      );
    }
  }

  // ---------------------------------------------------------- Fees
  {
    const slide = pptx.addSlide();
    addSlideTitle(
      slide,
      "Fee Estimate",
      `Portfolio size: ${snapshot.fees.portfolioSize}  ·  Blended TER: ${snapshot.fees.blendedTERPct} (${snapshot.fees.blendedTERBps} bps)`,
    );
    const f = snapshot.fees;
    const top: TableCell[][] = [
      [headerCell("Metric"), headerCell("Value")],
      [bodyCell("Year 1 fee"), bodyCell(f.year1FeeCHF)],
      [bodyCell("Total drag (horizon)"), bodyCell(f.totalDrag15yCHF)],
      [bodyCell("Drag p.a."), bodyCell(f.totalDragPctPa)],
    ];
    slide.addTable(top, {
      x: 0.5,
      y: 1.4,
      w: 12.3,
      colW: [4.3, 8.0],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
    });

    const rows: TableCell[][] = [
      [
        headerCell("Bucket"),
        headerCell("Weight"),
        headerCell("TER (bps)"),
        headerCell("Contribution (bps)"),
      ],
      ...f.rows.map((r) => [
        bodyCell(r.bucket),
        bodyCell(r.weightPct, { align: "right" }),
        bodyCell(String(r.terBps), { align: "right" }),
        bodyCell(r.contributionBps.toFixed(2), { align: "right" }),
      ]),
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 3.6,
      w: 12.3,
      colW: [5.3, 2.0, 2.5, 2.5],
      border: { type: "solid", pt: 0.5, color: "CBD5E0" },
      fontFace: FONT,
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 0.6,
    });
  }

  // ---------------------------------------------------------- Close
  {
    const slide = pptx.addSlide();
    slide.background = { color: NAVY };
    slide.addText("Methodology & Disclaimer", {
      x: 0.6,
      y: 1.5,
      w: 12,
      h: 0.7,
      fontSize: 28,
      bold: true,
      color: WHITE,
      fontFace: FONT,
    });
    slide.addText(
      "This report is generated by the Investment Decision Lab for illustrative purposes only. " +
        "Forward-looking figures are model-based estimates using capital-market assumptions and a Monte Carlo simulation; " +
        "they are not a guarantee or forecast of future returns. ETF selections, allocations and fee figures reflect the inputs " +
        "and toggles you chose at generation time and may change as catalog data, prices, or assumptions are updated. " +
        "Nothing in this report constitutes investment, legal or tax advice. Consult a qualified professional before acting.",
      {
        x: 0.6,
        y: 2.6,
        w: 12,
        h: 3.0,
        fontSize: 13,
        color: WHITE,
        fontFace: FONT,
      },
    );
    slide.addText(`Report ID: ${snapshot.meta.reportId}`, {
      x: 0.6,
      y: 6.6,
      w: 12,
      h: 0.3,
      fontSize: 10,
      italic: true,
      color: WHITE,
      fontFace: FONT,
    });
  }

  const baseName = safeFilename(`Investment-Report-${isoDate()}`);
  await pptx.writeFile({ fileName: `${baseName}.pptx` });
}
