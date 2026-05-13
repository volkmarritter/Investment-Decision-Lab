// Explain tab — "Current Allocation" card. Mirrors BuildPortfolio's
// "Target Asset Allocation" block (donut + group summary + horizontal
// stacked bar + per-bucket table) but reads from the synthesized
// PersonalPortfolio.allocation produced by Explain.
//
// Respects Explain's existing Look-Through toggle: when ON and an ETF
// implementation is present, the donut + bar are decomposed via
// `mapAllocationToAssetsLookthrough`; when OFF the donut + bar route
// each user row through the shared region-only router
// `mapAllocationToAssets`, so the displayed CMA buckets are invariant
// under the Look-Through toggle (Task #294 — same rule applies in
// PortfolioMetrics). Without this, manual rows like
// "Equity - Asia Pacific ex-Japan" or "Equity - Other" would appear as
// raw row labels in OFF mode but as "Japan Equity" / "Other / Residual"
// in ON mode, contradicting the routing-consistency contract. The table
// below still shows the user's row-level buckets verbatim (same wording
// rationale as Build).
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type {
  AssetAllocation,
  BaseCurrency,
  ETFImplementation,
} from "@/lib/types";
import {
  CMA,
  mapAllocationToAssets,
  mapAllocationToAssetsLookthrough,
  type AssetExposure,
} from "@/lib/metrics";
import { colorForBucket, compareBuckets } from "@/lib/chartColors";
import { useT } from "@/lib/i18n";

import { AllocationGroupSummary } from "./AllocationGroupSummary";
import {
  BlendedBucketBadge,
  bucketEtfCounts,
  bucketKeyFor,
} from "./BlendedBucketBadge";

interface Props {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  baseCurrency: BaseCurrency;
  lookThroughView: boolean;
}

export function CurrentAllocationCard({
  allocation,
  etfImplementation,
  baseCurrency,
  lookThroughView,
}: Props) {
  const { t, lang } = useT();

  // Map a CMA-router result (region-only or look-through) to the
  // donut/legend shape, applying the same DE residual-bucket
  // localization in both branches so OFF and ON modes look consistent.
  const cmaToChart = (rows: AssetExposure[]) =>
    rows
      .filter((e) => e.weight > 0)
      .map((e) => ({
        // Localize the residual bucket label so the donut + legend read
        // "Sonstige / Rest" in DE instead of the English CMA label. All
        // other CMA labels are already neutral enough to stay in English.
        name: e.key === "equity_other" && lang === "de"
          ? "Sonstige / Rest"
          : CMA[e.key].label,
        value: e.weight * 100,
      }))
      .sort(compareBuckets);

  const chartData = (() => {
    if (lookThroughView && etfImplementation.length > 0) {
      return cmaToChart(
        mapAllocationToAssetsLookthrough(
          allocation,
          etfImplementation,
          baseCurrency,
        ),
      );
    }
    // Look-Through OFF: route each user row through the shared
    // region-only router so manual rows (e.g. Asia Pacific ex-Japan,
    // Other) land on the same CMA bucket the look-through path would
    // pick. Task #294.
    return cmaToChart(mapAllocationToAssets(allocation, baseCurrency));
  })();

  return (
    <Card data-testid="explain-current-allocation">
      <CardHeader>
        <CardTitle>{t("currentAllocation.title")}</CardTitle>
        <CardDescription>{t("currentAllocation.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-4 items-center">
          <AllocationGroupSummary
            allocation={allocation}
            orientation="vertical"
            testIdPrefix="explain-current-allocation"
          />
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={colorForBucket(entry.name)}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(1)}%`,
                    name,
                  ]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="h-4 w-full flex rounded-full overflow-hidden">
          {chartData.map((d, i) => (
            <div
              key={i}
              style={{
                width: `${d.value}%`,
                backgroundColor: colorForBucket(d.name),
              }}
              title={`${d.name}: ${d.value.toFixed(1)}%`}
              className="h-full transition-all duration-500 hover:brightness-110"
            />
          ))}
        </div>

        <ul
          className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs"
          aria-label={lang === "de" ? "Legende" : "Legend"}
          data-testid="explain-current-allocation-legend"
        >
          {chartData.map((d, i) => (
            <li key={i} className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: colorForBucket(d.name) }}
                aria-hidden
              />
              <span className="truncate text-muted-foreground" title={d.name}>
                {d.name}
              </span>
              <span className="ml-auto tabular-nums font-medium">
                {d.value.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-1">
          <h4 className="text-sm font-semibold">
            {lang === "de"
              ? "Allokation nach Bucket (deine Auswahl, ohne Look-Through)"
              : "Allocation by bucket (your selection, no look-through)"}
          </h4>
          <p className="text-xs text-muted-foreground">
            {lookThroughView && etfImplementation.length > 0
              ? lang === "de"
                ? "Diese Tabelle zeigt die von dir gewählten Buckets — ohne Look-Through. Pie und Balken oben sind über die ETF-Bestände zerlegt."
                : "This table shows the buckets you picked — without look-through. The pie and bar above are decomposed via the ETF holdings."
              : lang === "de"
                ? "Die von dir gewählten Buckets. Look-Through ist aus — Pie und Balken oben sind in CMA-Klassen geroutet (z. B. „Asia Pacific ex-Japan“ → Japan-Aktien), die Tabelle unten zeigt deine Zeilen-Buckets unverändert."
                : "The buckets you picked. Look-through is off — the pie and bar above are routed into CMA classes (e.g. \u201CAsia Pacific ex-Japan\u201D \u2192 Japan Equity), while the table below shows your row buckets verbatim."}
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {lang === "de" ? "Anlageklasse" : "Asset Class"}
                </TableHead>
                <TableHead>
                  {lang === "de" ? "Region/Detail" : "Region/Detail"}
                </TableHead>
                <TableHead className="text-right">
                  {lang === "de" ? "Gewicht" : "Weight"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const counts = bucketEtfCounts(etfImplementation);
                return allocation
                  .slice()
                  .sort((a, b) =>
                    compareBuckets(
                      {
                        name: `${a.assetClass} - ${a.region}`,
                        value: a.weight,
                      },
                      {
                        name: `${b.assetClass} - ${b.region}`,
                        value: b.weight,
                      },
                    ),
                  )
                  .map((alloc, i) => {
                    const count =
                      counts.get(bucketKeyFor(alloc.assetClass, alloc.region)) ??
                      0;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {alloc.assetClass}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <span>{alloc.region}</span>
                            <BlendedBucketBadge
                              count={count}
                              testId={`explain-blended-badge-${alloc.assetClass}-${alloc.region}`}
                            />
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {alloc.weight.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  });
              })()}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell colSpan={2}>
                  {lang === "de" ? "Gesamt" : "Total"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {allocation
                    .reduce((s, a) => s + a.weight, 0)
                    .toFixed(1)}
                  %
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
