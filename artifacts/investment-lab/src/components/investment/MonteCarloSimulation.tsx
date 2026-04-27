import { useEffect, useMemo, useState } from "react";
import { subscribeCMAOverrides } from "@/lib/settings";
import { applyCMALayers } from "@/lib/metrics";
import { Activity, TrendingUp, TrendingDown, Target, Flame } from "lucide-react";
import {
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ComposedChart,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssetAllocation, BaseCurrency } from "@/lib/types";
import { runMonteCarlo } from "@/lib/monteCarlo";
import { parseDecimalInput } from "@/lib/manualWeights";
import { useT } from "@/lib/i18n";

interface MonteCarloSimulationProps {
  allocation: AssetAllocation[];
  horizonYears: number;
  baseCurrency: BaseCurrency;
  hedged?: boolean;
}

export function MonteCarloSimulation({
  allocation,
  horizonYears,
  baseCurrency,
  hedged,
}: MonteCarloSimulationProps) {
  const { t, lang } = useT();
  // Raw text buffer is the source of truth so mobile users on Swiss/German/
  // French keyboards can type "100000,50" without `<input type="number">`
  // silently emptying the field. parseDecimalInput accepts dot *and* comma
  // decimals; null falls back to 0 so the simulation still runs while the
  // user is mid-edit. See the audit comment in src/lib/manualWeights.ts.
  const [amountDraft, setAmountDraft] = useState<string>("100000");
  const investmentAmount = useMemo(
    () => parseDecimalInput(amountDraft, { min: 0 }) ?? 0,
    [amountDraft],
  );
  // Re-run the simulation whenever the user edits CMA overrides in the
  // Methodology tab. runMonteCarlo now reads μ/σ from CMA, so override
  // changes must trigger a fresh useMemo computation.
  const [cmaVersion, setCmaVersion] = useState(0);
  useEffect(() => subscribeCMAOverrides(() => { applyCMALayers(); setCmaVersion((v) => v + 1); }), []);

  const result = useMemo(
    () =>
      runMonteCarlo(allocation, horizonYears, investmentAmount, {
        hedged: !!hedged,
        baseCurrency,
      }),
    [allocation, horizonYears, investmentAmount, hedged, baseCurrency, cmaVersion]
  );

  const formatCurrency = (value: number) => {
    const compact = Math.abs(value) > 1_000_000;
    return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", {
      style: "currency",
      currency: baseCurrency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(value);
  };

  const chartData = result.paths.map((p) => ({
    year: `Y${p.year}`,
    p10: Math.round(p.p10),
    p50: Math.round(p.p50),
    p90: Math.round(p.p90),
    band: [Math.round(p.p10), Math.round(p.p90)] as [number, number],
  }));

  const tickerStats = [
    {
      label: t("mc.stat.expReturn"),
      value: `${(result.expectedReturn * 100).toFixed(2)}%`,
      sub: t("mc.stat.perYear"),
      icon: TrendingUp,
    },
    {
      label: t("mc.stat.expVol"),
      value: `${(result.expectedVol * 100).toFixed(2)}%`,
      sub: t("mc.stat.perYear"),
      icon: Activity,
    },
    {
      label: t("mc.stat.probLoss"),
      value: `${(result.probLoss * 100).toFixed(1)}%`,
      sub: t("mc.stat.atHorizon"),
      icon: TrendingDown,
    },
    {
      label: t("mc.stat.probDoubled"),
      value: `${(result.probDoubled * 100).toFixed(1)}%`,
      sub: t("mc.stat.atHorizon"),
      icon: Target,
    },
  ];

  return (
    <Card className="mt-6 border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          {t("mc.title")}
        </CardTitle>
        <CardDescription>{t("mc.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-w-xs">
          <Label htmlFor="mc-amount" className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("mc.investmentAmount")}
          </Label>
          <Input
            id="mc-amount"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tickerStats.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
                  <Icon className="h-3 w-3" /> {s.label}
                </div>
                <div className="text-base font-semibold mt-1">{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.sub}</div>
              </div>
            );
          })}
        </div>

        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.final.p10")}
              </div>
              <div className="text-base font-semibold mt-1">{formatCurrency(result.finalP10)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.final.p50")}
              </div>
              <div className="text-base font-semibold mt-1 text-primary">
                {formatCurrency(result.finalP50)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.final.p90")}
              </div>
              <div className="text-base font-semibold mt-1">{formatCurrency(result.finalP90)}</div>
            </div>
          </div>
        </div>

        {/* Tail-risk row: Conditional VaR (Expected Shortfall) at 95 % and 99 %.
            Shows the *average* horizon outcome in the worst 5 % / 1 % of paths,
            both as a monetary value and as a horizon return. CVaR is a stricter
            risk measure than P10 (which is the threshold) — it reports what the
            tail actually looks like once you are inside it. Standard in CFA and
            Solvency-II reports. */}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="mc-tail-risk">
          <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold uppercase tracking-wide text-destructive">
            <Flame className="h-3 w-3" />
            {t("mc.tail.title")}
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.tail.cvar95")}
              </div>
              <div className="text-base font-semibold mt-1" data-testid="mc-cvar95-final">
                {formatCurrency(result.cvar95Final)}
              </div>
              <div className="text-[10px] text-destructive font-mono mt-0.5">
                {(result.cvar95Return * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.tail.cvar99")}
              </div>
              <div className="text-base font-semibold mt-1" data-testid="mc-cvar99-final">
                {formatCurrency(result.cvar99Final)}
              </div>
              <div className="text-[10px] text-destructive font-mono mt-0.5">
                {(result.cvar99Return * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
            {t("mc.tail.desc")}
          </p>
        </div>

        {/* Path-based realized Max Drawdown — replaces the analytical
            heuristic from metrics.ts for the simulation view. We report
            the median (typical path) and the 5th-percentile (bad-tail
            path) of the worst peak-to-trough drop observed *along* each
            simulated path. Honest tail measure, simulation-consistent. */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3" data-testid="mc-realized-mdd">
          <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <TrendingDown className="h-3 w-3" />
            {t("mc.mdd.title")}
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.mdd.median")}
              </div>
              <div
                className="text-base font-semibold mt-1 font-mono"
                data-testid="mc-mdd-p50"
              >
                {(result.realizedMddP50 * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("mc.mdd.p05")}
              </div>
              <div
                className="text-base font-semibold mt-1 font-mono text-amber-600 dark:text-amber-400"
                data-testid="mc-mdd-p05"
              >
                {(result.realizedMddP05 * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
            {t("mc.mdd.desc")}
          </p>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="mcBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="year" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickFormatter={(v) => formatCurrency(v as number)}
                width={80}
              />
              <RechartsTooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(value: any, name: string) => {
                  if (Array.isArray(value)) {
                    return [`${formatCurrency(value[0])} – ${formatCurrency(value[1])}`, name];
                  }
                  return [formatCurrency(Number(value)), name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="band"
                name={t("mc.legend.band")}
                stroke="none"
                fill="url(#mcBand)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p50"
                name={t("mc.legend.p50")}
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p10"
                name={t("mc.legend.p10")}
                stroke="hsl(var(--chart-3))"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p90"
                name={t("mc.legend.p90")}
                stroke="hsl(var(--chart-2))"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[11px] text-muted-foreground italic">{t("mc.disclaimer")}</p>
      </CardContent>
    </Card>
  );
}
