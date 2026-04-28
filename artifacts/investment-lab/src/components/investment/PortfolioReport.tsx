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
import { useT } from "@/lib/i18n";

interface PortfolioReportProps {
  output: PortfolioOutput;
  input: PortfolioInput;
  generatedAt: Date;
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
}: PortfolioReportProps) {
  const { t, lang } = useT();
  const de = lang === "de";

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
            {t("report.subtitle")}
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
