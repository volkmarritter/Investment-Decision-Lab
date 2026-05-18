import path from "node:path";
import fs from "node:fs";
import PptxModule from "pptxgenjs";
const PptxGenJS = PptxModule.default || PptxModule;

const origProto = PptxGenJS.prototype;
origProto.writeFile = async function ({ fileName }) {
  const buf = await this.write({ outputType: "nodebuffer" });
  const out = path.join("/tmp", fileName);
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length, "bytes");
};

const snap = {
  meta: { reportTitle: "Investment Decision Lab — Portfolio Report", reportId: "ID-20260518-CHF-M70-15Y",
    generatedOn: "18 May 2026", preparedFor: "Example Investor", jurisdiction: "Switzerland",
    profileOneLiner: "CHF · Moderate · 15-year horizon · 70% target equity · look-through on.",
    correlationRegime: "Normal" },
  profile: { baseCurrency: "CHF", riskProfile: "Moderate", horizonYears: 15, targetEquityPct: 70, numEtfs: 8,
    toggles: { hedging: "On", bondHedging: "On (CHF)", syntheticEtfs: "Allowed", lookThrough: "On", thematic: "Off" } },
  keyMetrics: { expectedReturnPa: "6.3%", volatilityPa: "11.2%", sharpe: "0.48",
    sharpeInterpretation: "Solid risk-adjusted return.", riskFreeRate: "1.0%",
    maxDrawdownP5: "-28%", alphaVsAcwi: "+0.4%", equityDefensiveSplit: "70 / 30", weightedTER: "0.18%" },
  allocation: {
    rows: [
      { label: "Equity – Developed World", weight: 35, group: "equity" },
      { label: "Equity – Emerging Markets", weight: 10, group: "equity" },
      { label: "Equity – Small Cap", weight: 8, group: "equity" },
      { label: "Real Estate – Global", weight: 7, group: "realestate" },
      { label: "Fixed Income – Govt CHF", weight: 18, group: "bonds" },
      { label: "Fixed Income – Corp Global", weight: 12, group: "bonds" },
      { label: "Cash – CHF", weight: 10, group: "cash" },
    ],
    groupTotals: { equity: 53, realestate: 7, bonds: 30, cash: 10, commodities: 0, crypto: 0 },
  },
  etfs: Array.from({ length: 8 }).map((_, i) => ({
    n: i + 1, bucket: ["DM Equity","EM Equity","Small Cap","Real Estate","Govt CHF","Corp Global","Cash CHF","Gold"][i],
    name: "iShares Core MSCI World UCITS ETF", isin: "IE00B4L5Y983", ticker: "IWDA",
    weight: "12.5%", ter: "0.20%", comment: "Broad developed-market equity exposure, accumulating." })),
  holdings: Array.from({length: 10}).map((_, i) => ({
    n: i+1, name: ["Apple","Microsoft","Nvidia","Amazon","Alphabet A","Meta","Tesla","Broadcom","Berkshire B","Eli Lilly"][i],
    source: "MSCI World", pctPortfolio: `${(3 - i*0.2).toFixed(2)}%`, pctEquity: `${(5 - i*0.3).toFixed(1)}%` })),
  monteCarlo: { paths: "2,000", horizonYears: 15,
    pathSeries: Array.from({length: 16}).map((_, y) => ({ year: y, p10: 100 + y*3, p50: 100 + y*7, p90: 100 + y*14 })),
    finalP10: 145, finalP50: 205, finalP90: 310,
    finalP10CAGR: "+2.5% p.a.", finalP50CAGR: "+5.0% p.a.", finalP90CAGR: "+8.0% p.a.",
    expReturnGeom: "5.6%", expVol: "11.0%", pLoss15y: "8.0%", pDouble15y: "55%", cvar5: "-32%" },
  fees: { portfolioSize: "CHF 100,000", blendedTERPct: "0.18%", blendedTERBps: 18,
    year1FeeCHF: "CHF 180", totalDrag15yCHF: "CHF 4,800", totalDragPctPa: "−0.33%",
    rows: [
      { bucket: "DM Equity", weightPct: "35.0%", terBps: 20, contributionBps: 7.0 },
      { bucket: "EM Equity", weightPct: "10.0%", terBps: 25, contributionBps: 2.5 },
      { bucket: "Govt CHF", weightPct: "18.0%", terBps: 10, contributionBps: 1.8 },
    ] },
  tocSections: [
    { n: 1, title: "Profile summary", slide: 3, page: "p. 03" },
    { n: 2, title: "Key metrics", slide: 4, page: "p. 04" },
    { n: 3, title: "Target allocation", slide: 5, page: "p. 05" },
    { n: 4, title: "ETF implementation", slide: 6, page: "p. 06" },
    { n: 5, title: "Top 10 equity holdings", slide: 7, page: "p. 07" },
    { n: 6, title: "Monte Carlo projection", slide: 8, page: "p. 08" },
    { n: 7, title: "Fee estimate", slide: 9, page: "p. 09" },
    { n: 8, title: "Methodology & disclaimer", slide: 10, page: "p. 10" },
  ],
};

const { exportReportPptx } = await import("./src/lib/exportReportPptx.ts");
await exportReportPptx(snap);
console.log("OK");
