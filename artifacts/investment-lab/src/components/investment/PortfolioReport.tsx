import { useMemo } from "react";
import { PortfolioInput, PortfolioOutput } from "@/lib/types";
import {
  CMA,
  computeMetrics,
  isSyntheticUsEffective,
  mapAllocationToAssetsLookthrough,
} from "@/lib/metrics";
import { getRiskFreeRate } from "@/lib/settings";
import { colorForBucket, compareBuckets } from "@/lib/chartColors";
import { buildLookthrough } from "@/lib/lookthrough";
import { runMonteCarlo } from "@/lib/monteCarlo";
import { estimateFees } from "@/lib/fees";
import { useT } from "@/lib/i18n";

/** Illustrative investment amount used by the Monte Carlo and Fee Estimator
 *  blocks of the detailed report. Mirrors the on-screen default for both
 *  components, so the PDF figures match what the operator sees by default. */
const ILLUSTRATIVE_AMOUNT = 100_000;

interface PortfolioReportProps {
  output: PortfolioOutput;
  input: PortfolioInput;
  generatedAt: Date;
  /** "basic" = single-page advisor summary (default).
   *  "detailed" = adds Top 10 Equity Holdings (always look-through),
   *  Monte Carlo summary + projection chart, and Fee Estimator summary. */
  variant?: "basic" | "detailed";
}

/** For values stored as fractions in [0..1] (e.g. computeMetrics outputs). */
const fmtPctFromFraction = (x: number, digits = 1) =>
  `${(x * 100).toFixed(digits)}%`;

/** For values already stored on a percent scale [0..100] (e.g. allocation
 *  rows and ETF implementation rows produced by the engine). Multiplying by
 *  100 again would render every weight 100x too high. */
const fmtPctFromPercent = (x: number, digits = 1) =>
  `${x.toFixed(digits)}%`;

const fmtNum = (x: number, digits = 2) => x.toFixed(digits);

const fmtTimestamp = (d: Date, lang: "de" | "en") =>
  d.toLocaleString(lang === "de" ? "de-CH" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Sharpe interpretation band — keeps the report self-contained and bilingual
 * without coupling to PortfolioMetrics' on-screen tooltip strings.
 */
function sharpeBand(sharpe: number, lang: "de" | "en"): string {
  if (sharpe >= 0.6)
    return lang === "de" ? "stark" : "strong";
  if (sharpe >= 0.4)
    return lang === "de" ? "solide" : "solid";
  if (sharpe >= 0.2)
    return lang === "de" ? "moderat" : "moderate";
  return lang === "de" ? "schwach" : "weak";
}

export function PortfolioReport({
  output,
  input,
  generatedAt,
  variant = "basic",
}: PortfolioReportProps) {
  const { t, lang } = useT();
  const de = lang === "de";
  const isDetailed = variant === "detailed";

  const syntheticUsEffective = isSyntheticUsEffective(
    input.includeSyntheticETFs,
    input.baseCurrency,
    input.includeCurrencyHedging,
  );

  const metrics = useMemo(
    () =>
      computeMetrics(
        output.allocation,
        input.baseCurrency,
        input.lookThroughView ? output.etfImplementation : undefined,
        syntheticUsEffective,
        "normal",
      ),
    [
      output.allocation,
      output.etfImplementation,
      input.baseCurrency,
      input.lookThroughView,
      syntheticUsEffective,
    ],
  );

  const rf = getRiskFreeRate(input.baseCurrency);

  // Aggregate allocation rows for display. When look-through is on AND we
  // have an ETF implementation, decompose into the underlying country/asset
  // buckets via the same router used by the on-screen donut — so the PDF
  // mirrors what the user sees, not the raw row-region surface allocation.
  // Weights here are normalised to the percent scale [0..100] regardless of
  // source so the renderer can stay simple.
  const allocationRows = useMemo(() => {
    if (
      input.lookThroughView &&
      output.etfImplementation.length > 0
    ) {
      const lt = mapAllocationToAssetsLookthrough(
        output.allocation,
        output.etfImplementation,
        input.baseCurrency,
      );
      return lt
        .filter((e) => e.weight > 0.000005)
        .map((e) => {
          const label = CMA[e.key].label;
          return {
            label,
            // mapAllocationToAssetsLookthrough returns fractions in [0..1];
            // promote to percent for the unified renderer below.
            weight: e.weight * 100,
            color: colorForBucket(label),
          };
        })
        .sort((x, y) =>
          compareBuckets(
            { name: x.label, value: x.weight },
            { name: y.label, value: y.weight },
          ),
        );
    }
    // Surface allocation: weights are already on the percent scale [0..100].
    return output.allocation
      .filter((a) => a.weight > 0.05)
      .map((a) => {
        const label = `${a.assetClass} - ${a.region}`;
        return {
          label,
          weight: a.weight,
          color: colorForBucket(label),
        };
      })
      .sort((x, y) =>
        compareBuckets(
          { name: x.label, value: x.weight },
          { name: y.label, value: y.weight },
        ),
      );
  }, [
    output.allocation,
    output.etfImplementation,
    input.lookThroughView,
    input.baseCurrency,
  ]);

  const maxAllocWeight = Math.max(
    1,
    ...allocationRows.map((r) => r.weight),
  );

  const etfRows = output.etfImplementation.filter((e) => e.weight > 0.05);

  return (
    <div
      className="bg-white text-slate-900 font-sans"
      style={{
        width: "210mm",
        // Intentionally NO minHeight: we let the report size to its content so
        // a short portfolio doesn't get padded to a full page and a long one
        // can naturally span two pages via exportPdf's pagination.
        padding: "12mm 14mm",
        boxSizing: "border-box",
        fontSize: "10.5px",
        lineHeight: 1.35,
      }}
    >
      {/* Header */}
      <header
        className="flex items-start justify-between border-b-2 pb-3 mb-4"
        style={{ borderColor: "#0f172a" }}
      >
        <div>
          <div
            className="font-bold tracking-tight"
            style={{ fontSize: "16px", color: "#0f172a" }}
          >
            Investment Decision Lab
          </div>
          <div
            className="text-slate-600 mt-0.5"
            style={{ fontSize: "11px" }}
          >
            {isDetailed ? t("report.subtitle.detailed") : t("report.subtitle")}
            <span className="text-slate-400"> · </span>
            <span className="text-slate-700">
              {/* Mirror the *effective* gating used by the allocation memo
               *  below: look-through is only applied when the toggle is on
               *  AND there is an ETF implementation to decompose. This keeps
               *  the subtitle status truthful even in edge cases (e.g. a
               *  pure-fixed-income portfolio with the toggle on but no
               *  equity ETFs to look through). */}
              {input.lookThroughView && output.etfImplementation.length > 0
                ? t("report.feature.lookThrough")
                : t("report.feature.surfaceView")}
            </span>
          </div>
        </div>
        <div className="text-right text-slate-700" style={{ fontSize: "10px" }}>
          <div>
            <span className="text-slate-500">{t("report.meta.generated")}: </span>
            <span className="font-medium">{fmtTimestamp(generatedAt, lang)}</span>
          </div>
          <div>
            <span className="text-slate-500">{t("report.meta.base")}: </span>
            <span className="font-medium">{input.baseCurrency}</span>
          </div>
        </div>
      </header>

      {/* Profile chips */}
      <section className="mb-4">
        <div className="flex flex-wrap gap-2">
          <ProfileChip
            label={t("report.chip.risk")}
            value={t(`risk.${input.riskAppetite}`)}
          />
          <ProfileChip
            label={t("report.chip.horizon")}
            value={`${input.horizon} ${de ? "Jahre" : "years"}`}
          />
          <ProfileChip
            label={t("report.chip.targetEquity")}
            value={`${input.targetEquityPct}%`}
          />
          <ProfileChip
            label={t("report.chip.numEtfs")}
            value={`${etfRows.length}`}
          />
          {input.includeCurrencyHedging && (
            <ProfileChip
              label={t("report.chip.feature")}
              value={t("report.feature.hedging")}
            />
          )}
          {input.includeSyntheticETFs && (
            <ProfileChip
              label={t("report.chip.feature")}
              value={t("report.feature.synthetic")}
            />
          )}
          {input.lookThroughView && (
            <ProfileChip
              label={t("report.chip.feature")}
              value={t("report.feature.lookThrough")}
            />
          )}
          {input.thematicPreference !== "None" && (
            <ProfileChip
              label={t("report.chip.thematic")}
              value={input.thematicPreference}
            />
          )}
        </div>
      </section>

      {/* Key metrics */}
      <section className="mb-4">
        <SectionTitle>{t("report.section.metrics")}</SectionTitle>
        <div className="grid grid-cols-5 gap-2 mt-2">
          <MetricTile
            label={t("metrics.expReturn")}
            value={fmtPctFromFraction(metrics.expReturn)}
            sub="p.a."
          />
          <MetricTile
            label={t("metrics.vol")}
            value={fmtPctFromFraction(metrics.vol)}
            sub={de ? "Standardabw." : "stdev"}
          />
          <MetricTile
            label={t("metrics.sharpe")}
            value={fmtNum(metrics.sharpe)}
            sub={`${sharpeBand(metrics.sharpe, lang)} · Rf ${fmtPctFromFraction(rf, 1)}`}
          />
          <MetricTile
            label={t("metrics.maxDD")}
            value={fmtPctFromFraction(metrics.maxDrawdown, 1)}
            sub={de ? "Heuristik" : "heuristic"}
          />
          <MetricTile
            label={de ? "Alpha vs. ACWI" : "Alpha vs ACWI"}
            value={fmtPctFromFraction(metrics.alpha)}
            sub="p.a."
          />
        </div>
      </section>

      {/* Allocation bars */}
      <section className="mb-4">
        <SectionTitle>{t("report.section.allocation")}</SectionTitle>
        <div className="mt-2 space-y-1">
          {allocationRows.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              className="grid items-center gap-2"
              style={{
                gridTemplateColumns: "minmax(0, 1fr) 70mm 14mm",
              }}
            >
              <div
                className="truncate text-slate-800"
                style={{ fontSize: "10px" }}
                title={row.label}
              >
                {row.label}
              </div>
              <div
                className="relative rounded-sm bg-slate-100"
                style={{ height: "8px" }}
              >
                <div
                  className="absolute left-0 top-0 h-full rounded-sm"
                  style={{
                    width: `${(row.weight / maxAllocWeight) * 100}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
              <div
                className="text-right tabular-nums text-slate-900 font-medium"
                style={{ fontSize: "10px" }}
              >
                {fmtPctFromPercent(row.weight, 1)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ETF implementation */}
      <section className="mb-4">
        <SectionTitle>{t("report.section.implementation")}</SectionTitle>
        <table
          className="w-full mt-2 border-collapse"
          style={{ fontSize: "9.5px" }}
        >
          <thead>
            <tr className="text-left text-slate-600 border-b border-slate-300">
              <th className="py-1 pr-2 font-semibold" style={{ width: "6mm" }}>
                #
              </th>
              <th className="py-1 pr-2 font-semibold">
                {t("report.table.etf")}
              </th>
              <th className="py-1 pr-2 font-semibold" style={{ width: "26mm" }}>
                ISIN
              </th>
              <th className="py-1 pr-2 font-semibold" style={{ width: "16mm" }}>
                {t("report.table.ticker")}
              </th>
              <th
                className="py-1 pr-2 font-semibold text-right tabular-nums"
                style={{ width: "12mm" }}
              >
                TER
              </th>
              <th
                className="py-1 font-semibold text-right tabular-nums"
                style={{ width: "14mm" }}
              >
                {t("report.table.weight")}
              </th>
            </tr>
          </thead>
          <tbody>
            {etfRows.map((etf, i) => (
              <tr
                key={`${etf.isin}-${i}`}
                className="border-b border-slate-100"
              >
                <td className="py-1 pr-2 text-slate-500 tabular-nums">
                  {i + 1}
                </td>
                <td className="py-1 pr-2">
                  <div className="font-medium text-slate-900">
                    {etf.exampleETF}
                  </div>
                  <div className="text-slate-500" style={{ fontSize: "8.5px" }}>
                    {etf.bucket} · {etf.exchange} · {etf.currency} ·{" "}
                    {etf.distribution === "Accumulating"
                      ? de
                        ? "thesaurierend"
                        : "accumulating"
                      : de
                        ? "ausschüttend"
                        : "distributing"}
                  </div>
                </td>
                <td className="py-1 pr-2 tabular-nums text-slate-700">
                  {etf.isin}
                </td>
                <td className="py-1 pr-2 tabular-nums text-slate-700">
                  {etf.ticker}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-slate-700">
                  {(etf.terBps / 100).toFixed(2)}%
                </td>
                <td className="py-1 text-right tabular-nums font-semibold text-slate-900">
                  {fmtPctFromPercent(etf.weight, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isDetailed && (
        <DetailedSections
          output={output}
          input={input}
          syntheticUsEffective={syntheticUsEffective}
          lang={lang}
        />
      )}

      {/* Methodology line */}
      <div
        className="mt-3 pt-3 border-t border-slate-300 text-slate-600"
        style={{ fontSize: "8.5px", lineHeight: 1.4 }}
      >
        <span className="font-semibold text-slate-700">
          {t("report.footer.methodology")}:{" "}
        </span>
        {t("report.footer.methodology.body")}
      </div>

      {/* Full legal disclaimer — same content as the on-screen 7-section
       *  DisclaimerPdfBlock used by the legacy export, restyled to match the
       *  report's typography. Carrying the full disclaimer (rather than a
       *  short summary) preserves compliance parity with the previous PDF. */}
      <footer
        className="mt-3 pt-3 border-t border-slate-300 text-slate-600"
        style={{ fontSize: "7.5px", lineHeight: 1.4 }}
      >
        <h3
          className="font-semibold uppercase tracking-wider text-slate-700 mb-1"
          style={{ fontSize: "8.5px", letterSpacing: "0.06em" }}
        >
          {t("disclaimer.full.title")}
        </h3>
        <p className="italic mb-2 text-slate-500">
          {t("disclaimer.full.subtitle")}
        </p>
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i}>
              <span className="font-semibold text-slate-700">
                {t(`disclaimer.s${i}.title` as any)}.
              </span>{" "}
              <span className="text-slate-600">
                {t(`disclaimer.s${i}.body` as any)}
              </span>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-semibold uppercase tracking-wider text-slate-600"
      style={{ fontSize: "9px", letterSpacing: "0.08em" }}
    >
      {children}
    </h2>
  );
}

function ProfileChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5"
      style={{ fontSize: "9.5px" }}
    >
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5"
      style={{ minHeight: "16mm" }}
    >
      <div className="text-slate-500" style={{ fontSize: "8.5px" }}>
        {label}
      </div>
      <div
        className="font-bold text-slate-900 tabular-nums mt-0.5"
        style={{ fontSize: "13px" }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-slate-500 mt-0.5" style={{ fontSize: "8px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * Detailed-only sections: Top 10 Equity Holdings (always look-through),
 * Monte Carlo summary + projection chart, and Fee Estimator summary.
 *
 * Rendered between the ETF Implementation table and the Methodology footer
 * when `variant === "detailed"`. Uses the same illustrative investment
 * amount (ILLUSTRATIVE_AMOUNT) as the on-screen defaults so the PDF
 * numbers line up with what the operator sees by default.
 */
function DetailedSections({
  output,
  input,
  syntheticUsEffective,
  lang,
}: {
  output: PortfolioOutput;
  input: PortfolioInput;
  syntheticUsEffective: boolean;
  lang: "de" | "en";
}) {
  const de = lang === "de";
  // formatters for the illustrative-amount currency tiles
  const fmtMoney = (v: number) =>
    new Intl.NumberFormat(de ? "de-CH" : "en-GB", {
      style: "currency",
      currency: input.baseCurrency,
      maximumFractionDigits: 0,
    }).format(v);

  // Top 10 Equity Holdings — buildLookthrough always operates in
  // look-through mode (it IS the look-through engine), so this section is
  // independent of input.lookThroughView. Per spec: top holdings are
  // ALWAYS shown look-through in the detailed report.
  const lookthrough = useMemo(
    () => buildLookthrough(output.etfImplementation, lang, input.baseCurrency),
    [output.etfImplementation, lang, input.baseCurrency],
  );
  const topHoldings = lookthrough.topConcentrations.slice(0, 10);

  // Monte Carlo — run with the same defaults as the on-screen widget so
  // the report numbers reproduce on screen at a glance.
  const mc = useMemo(
    () =>
      runMonteCarlo(output.allocation, input.horizon, ILLUSTRATIVE_AMOUNT, {
        hedged: input.includeCurrencyHedging,
        baseCurrency: input.baseCurrency,
        syntheticUsEffective,
        riskRegime: "normal",
        tailModel: "gauss",
      }),
    [
      output.allocation,
      input.horizon,
      input.includeCurrencyHedging,
      input.baseCurrency,
      syntheticUsEffective,
    ],
  );

  // Fee Estimator — same call as the on-screen widget.
  const fees = useMemo(
    () =>
      estimateFees(output.allocation, input.horizon, ILLUSTRATIVE_AMOUNT, {
        hedged: input.includeCurrencyHedging && input.baseCurrency !== "USD",
      }),
    [
      output.allocation,
      input.horizon,
      input.includeCurrencyHedging,
      input.baseCurrency,
    ],
  );

  return (
    <>
      {/* Section: Top 10 Equity Holdings (look-through) */}
      <section className="mt-4">
        <SectionTitle>
          {de
            ? "Top 10 Aktien-Positionen (Look-Through)"
            : "Top 10 Equity Holdings (Look-Through)"}
        </SectionTitle>
        {topHoldings.length === 0 ? (
          <div
            className="mt-2 text-slate-500"
            style={{ fontSize: "9.5px" }}
          >
            {de
              ? "Keine Look-Through-Daten verfügbar (z.B. reines Anleihen-Portfolio)."
              : "No look-through data available (e.g. pure fixed-income portfolio)."}
          </div>
        ) : (
          <table
            className="w-full mt-1.5"
            style={{ fontSize: "9.5px", borderCollapse: "collapse" }}
          >
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th className="text-left py-1 pr-2 font-semibold" style={{ width: "6%" }}>
                  #
                </th>
                <th className="text-left py-1 pr-2 font-semibold">
                  {de ? "Position" : "Holding"}
                </th>
                <th className="text-left py-1 pr-2 font-semibold">
                  {de ? "Quelle" : "Source"}
                </th>
                <th className="text-right py-1 pr-2 font-semibold" style={{ width: "14%" }}>
                  {de ? "% Portfolio" : "% Portfolio"}
                </th>
                <th className="text-right py-1 font-semibold" style={{ width: "14%" }}>
                  {de ? "% Aktienteil" : "% of Equity"}
                </th>
              </tr>
            </thead>
            <tbody>
              {topHoldings.map((h, i) => {
                const pctOfEquity =
                  lookthrough.equityWeightTotal > 0
                    ? (h.pctOfPortfolio / lookthrough.equityWeightTotal) * 100
                    : 0;
                return (
                  <tr key={h.name} className="border-b border-slate-100">
                    <td className="py-1 pr-2 text-slate-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="py-1 pr-2 font-semibold text-slate-900">
                      {h.name}
                    </td>
                    <td className="py-1 pr-2 text-slate-600" style={{ fontSize: "8.5px" }}>
                      {h.source}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums font-semibold text-slate-900">
                      {h.pctOfPortfolio.toFixed(2)}%
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-700">
                      {pctOfEquity.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Section: Monte Carlo projection
       *  data-pdf-page-break="before" tells exportPdf.ts to start this
       *  section on a fresh A4 page (operator request: pagination here keeps
       *  the chart and its surrounding key figures on one continuous page,
       *  rather than splitting across the seam between page 1 and 2). */}
      <section className="mt-4" data-pdf-page-break="before">
        <SectionTitle>
          {de
            ? `Monte-Carlo-Projektion (illustrativ, ${fmtMoney(ILLUSTRATIVE_AMOUNT)} Investition)`
            : `Monte Carlo Projection (illustrative ${fmtMoney(ILLUSTRATIVE_AMOUNT)} investment)`}
        </SectionTitle>
        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
          <MetricTile
            label={de ? "Erwart. Rendite p.a." : "Expected return p.a."}
            value={fmtPctFromFraction(mc.expectedReturn, 2)}
            sub={de ? "geometr. Mittel" : "geometric mean"}
          />
          <MetricTile
            label={de ? "Erwart. Vol. p.a." : "Expected vol. p.a."}
            value={fmtPctFromFraction(mc.expectedVol, 1)}
            sub={de ? "Standardabw." : "std. deviation"}
          />
          <MetricTile
            label={de ? "Endwert P50" : "Final value P50"}
            value={fmtMoney(mc.finalP50)}
            sub={`P10 ${fmtMoney(mc.finalP10)} · P90 ${fmtMoney(mc.finalP90)}`}
          />
          <MetricTile
            label={de ? "P(Verlust) / P(Verdoppl.)" : "P(loss) / P(doubled)"}
            value={`${fmtPctFromFraction(mc.probLoss, 1)} / ${fmtPctFromFraction(mc.probDoubled, 1)}`}
            sub={`${input.horizon} ${de ? "Jahre Horizont" : "year horizon"}`}
          />
        </div>
        <div className="mt-2">
          <MonteCarloMiniChart
            paths={mc.paths}
            initial={ILLUSTRATIVE_AMOUNT}
            lang={lang}
          />
        </div>
        <div className="text-slate-500 mt-1" style={{ fontSize: "8px" }}>
          {de
            ? "2'000 Pfade, log-normal. P10/P50/P90-Bänder; reale Renditen können stärker streuen."
            : "2,000 paths, log-normal. P10/P50/P90 bands; real returns may dispersee more widely."}
        </div>
      </section>

      {/* Section: Fee Estimator summary */}
      <section className="mt-4">
        <SectionTitle>
          {de
            ? `Gebühren-Schätzung (illustrativ, ${fmtMoney(ILLUSTRATIVE_AMOUNT)} über ${input.horizon} Jahre)`
            : `Fee Estimate (illustrative ${fmtMoney(ILLUSTRATIVE_AMOUNT)} over ${input.horizon} years)`}
        </SectionTitle>
        <div className="grid grid-cols-3 gap-1.5 mt-1.5">
          <MetricTile
            label={de ? "Mittlere TER" : "Blended TER"}
            value={`${fees.blendedTerPct.toFixed(2)}% p.a.`}
            sub={de ? "gewichtet nach Position" : "position-weighted"}
          />
          <MetricTile
            label={de ? "Jährliche Gebühr" : "Annual fee"}
            value={fmtMoney(fees.annualFee)}
            sub={de ? "Jahr 1, kein Zinseszins" : "year 1, no compounding"}
          />
          <MetricTile
            label={de ? "Projizierter Drag" : "Projected drag"}
            value={`${fees.feeDragPct.toFixed(1)}%`}
            sub={de ? "vom Endwert" : "of final value"}
          />
        </div>
        {fees.breakdown.length > 0 && (
          <table
            className="w-full mt-2"
            style={{ fontSize: "9px", borderCollapse: "collapse" }}
          >
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th className="text-left py-1 pr-2 font-semibold">
                  {de ? "Bucket" : "Bucket"}
                </th>
                <th className="text-right py-1 pr-2 font-semibold">
                  {de ? "Gewicht" : "Weight"}
                </th>
                <th className="text-right py-1 pr-2 font-semibold">
                  TER (bps)
                </th>
                <th className="text-right py-1 font-semibold">
                  {de ? "Beitrag (bps)" : "Contribution (bps)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {fees.breakdown.map((row) => (
                <tr key={row.key} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-900">{row.key}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-700">
                    {row.weight.toFixed(1)}%
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-700">
                    {row.terBps}
                  </td>
                  <td className="py-1 text-right tabular-nums font-semibold text-slate-900">
                    {row.contributionBps.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-slate-500 mt-1" style={{ fontSize: "8px" }}>
          {de
            ? "Illustrative TERs. Trading-, FX- und Plattformkosten nicht enthalten."
            : "Illustrative TERs. Trading, FX, and platform costs not included."}
        </div>
      </section>
    </>
  );
}

/**
 * Inline SVG line chart of the Monte Carlo P10/P50/P90 paths over the
 * investment horizon. Drawn as raw SVG (rather than via Recharts) so the
 * off-screen html2canvas pass renders deterministically without waiting on
 * Recharts' ResponsiveContainer to measure the off-screen container.
 */
function MonteCarloMiniChart({
  paths,
  initial,
  lang,
}: {
  paths: { year: number; p10: number; p50: number; p90: number }[];
  initial: number;
  lang: "de" | "en";
}) {
  const de = lang === "de";
  if (paths.length === 0) return null;

  // Build viewBox geometry — use a generous canvas, the SVG will be scaled
  // to width:100% by CSS and rasterised at PDF DPI by html2canvas.
  const W = 600;
  const H = 180;
  const padL = 50;
  const padR = 12;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const years = paths.map((p) => p.year);
  const xMin = Math.min(...years);
  const xMax = Math.max(...years);
  const yMin = 0;
  const yMax = Math.max(...paths.map((p) => p.p90)) * 1.05;

  const xScale = (y: number) =>
    padL + ((y - xMin) / Math.max(1, xMax - xMin)) * innerW;
  const yScale = (v: number) =>
    padT + innerH - ((v - yMin) / Math.max(1, yMax - yMin)) * innerH;

  const polyline = (vals: number[]) =>
    paths.map((p, i) => `${xScale(p.year).toFixed(1)},${yScale(vals[i]).toFixed(1)}`).join(" ");

  const p10s = paths.map((p) => p.p10);
  const p50s = paths.map((p) => p.p50);
  const p90s = paths.map((p) => p.p90);

  // Y-axis ticks: 0, 25%, 50%, 75%, 100% of yMax
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((q) => yMin + q * (yMax - yMin));
  const fmtAxisMoney = (v: number) =>
    new Intl.NumberFormat(de ? "de-CH" : "en-GB", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);

  // Initial-value reference line
  const initialY = yScale(initial);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* gridlines + y labels */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={padL}
            x2={W - padR}
            y1={yScale(v)}
            y2={yScale(v)}
            stroke="#e2e8f0"
            strokeWidth={0.5}
          />
          <text
            x={padL - 4}
            y={yScale(v) + 3}
            textAnchor="end"
            fontSize={8}
            fill="#64748b"
            fontFamily="sans-serif"
          >
            {fmtAxisMoney(v)}
          </text>
        </g>
      ))}
      {/* initial reference */}
      <line
        x1={padL}
        x2={W - padR}
        y1={initialY}
        y2={initialY}
        stroke="#94a3b8"
        strokeWidth={0.6}
        strokeDasharray="3 3"
      />
      <text
        x={W - padR}
        y={initialY - 2}
        textAnchor="end"
        fontSize={7.5}
        fill="#64748b"
        fontFamily="sans-serif"
      >
        {de ? "Anlage" : "Initial"}
      </text>
      {/* x labels — first, mid, last (deduped so a 1-year horizon doesn't
       *  emit duplicate React keys / overlapping labels) */}
      {Array.from(
        new Set([xMin, Math.round((xMin + xMax) / 2), xMax]),
      ).map((y) => (
        <text
          key={y}
          x={xScale(y)}
          y={H - 8}
          textAnchor="middle"
          fontSize={8}
          fill="#64748b"
          fontFamily="sans-serif"
        >
          {de ? `J${y}` : `Y${y}`}
        </text>
      ))}
      {/* P10/P90 band */}
      <polyline
        points={polyline(p90s)}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={1.2}
      />
      <polyline
        points={polyline(p10s)}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={1.2}
      />
      {/* P50 median */}
      <polyline
        points={polyline(p50s)}
        fill="none"
        stroke="#0f172a"
        strokeWidth={1.6}
      />
      {/* Legend */}
      <g transform={`translate(${padL + 4}, ${padT + 8})`} fontFamily="sans-serif">
        <rect width={140} height={14} fill="white" opacity={0.8} />
        <line x1={4} x2={16} y1={7} y2={7} stroke="#0f172a" strokeWidth={1.6} />
        <text x={20} y={10} fontSize={8} fill="#0f172a">
          P50 ({de ? "Median" : "median"})
        </text>
        <line x1={70} x2={82} y1={7} y2={7} stroke="#cbd5e1" strokeWidth={1.2} />
        <text x={86} y={10} fontSize={8} fill="#0f172a">
          P10 / P90
        </text>
      </g>
    </svg>
  );
}
