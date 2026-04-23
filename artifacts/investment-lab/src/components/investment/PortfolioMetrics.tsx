import { useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { Sigma, Activity, BarChart3, GitCompare, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetAllocation } from "@/lib/types";
import { computeMetrics, computeFrontier, buildCorrelationMatrix } from "@/lib/metrics";
import { useT } from "@/lib/i18n";

export function PortfolioMetrics({ allocation }: { allocation: AssetAllocation[] }) {
  const { t, lang } = useT();
  const de = lang === "de";
  const [expanded, setExpanded] = useState(false);

  const m = useMemo(() => computeMetrics(allocation), [allocation]);
  const frontier = useMemo(() => computeFrontier(allocation), [allocation]);
  const correlation = useMemo(() => buildCorrelationMatrix(allocation), [allocation]);

  const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
  const num = (v: number, digits = 2) => v.toFixed(digits);

  const frontierData = frontier.points.map((p) => ({
    vol: +(p.vol * 100).toFixed(2),
    ret: +(p.ret * 100).toFixed(2),
    equity: p.equityPct,
  }));
  const currentDot = {
    vol: +(frontier.current.vol * 100).toFixed(2),
    ret: +(frontier.current.ret * 100).toFixed(2),
  };

  const corrColor = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    if (v >= 0) return `rgba(220,38,38,${0.08 + 0.55 * a})`;
    return `rgba(37,99,235,${0.08 + 0.55 * a})`;
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Sigma className="h-5 w-5" /> {t("metrics.title")}
            </CardTitle>
            <CardDescription>{t("metrics.desc")}</CardDescription>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs font-mono text-muted-foreground">
              <span><span className="text-foreground font-semibold">{pct(m.expReturn)}</span> {t("metrics.expReturn").toLowerCase()}</span>
              <span><span className="text-foreground font-semibold">{pct(m.vol)}</span> {t("metrics.vol").toLowerCase()}</span>
              <span><span className="text-foreground font-semibold">{num(m.sharpe)}</span> {t("metrics.sharpe").toLowerCase()}</span>
              <span><span className="text-foreground font-semibold">{pct(m.maxDrawdown, 1)}</span> {t("metrics.maxDD").toLowerCase()}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)} className="shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {expanded ? t("build.homeBias.collapse") : t("build.homeBias.expand")}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
      <CardContent className="space-y-6">
        {/* Scalar metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile label={t("metrics.expReturn")} value={pct(m.expReturn)} sub={de ? "p.a." : "p.a."} />
          <MetricTile label={t("metrics.vol")} value={pct(m.vol)} sub={de ? "Standardabw." : "stdev"} />
          <MetricTile label={t("metrics.sharpe")} value={num(m.sharpe)} sub={`Rf ${pct(0.025, 1)}`} accent={m.sharpe >= 0.4 ? "good" : m.sharpe >= 0.2 ? "neutral" : "warn"} />
          <MetricTile label={t("metrics.maxDD")} value={pct(m.maxDrawdown, 1)} sub={de ? "geschätzt" : "estimated"} accent="warn" />
          <MetricTile label={t("metrics.beta")} value={num(m.beta)} sub={de ? "vs. ACWI" : "vs ACWI"} />
          <MetricTile label={t("metrics.alpha")} value={pct(m.alpha)} sub={de ? "p.a. vs. ACWI" : "p.a. vs ACWI"} accent={m.alpha >= 0 ? "good" : "warn"} />
          <MetricTile label={t("metrics.te")} value={pct(m.trackingError, 1)} sub={de ? "p.a." : "p.a."} />
          <MetricTile label={t("metrics.outperf")} value={`${m.outperformance >= 0 ? "+" : ""}${pct(m.outperformance)}`} sub={de ? "vs. ACWI p.a." : "vs ACWI p.a."} accent={m.outperformance >= 0 ? "good" : "warn"} />
        </div>

        {/* Efficient frontier */}
        <div className="space-y-3 pt-2 border-t">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" /> {t("metrics.frontier.title")}
          </h4>
          <p className="text-xs text-muted-foreground">{t("metrics.frontier.desc")}</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  dataKey="vol"
                  name={t("metrics.frontier.x")}
                  unit="%"
                  tick={{ fontSize: 11 }}
                  label={{ value: t("metrics.frontier.x"), position: "insideBottom", offset: -10, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="ret"
                  name={t("metrics.frontier.y")}
                  unit="%"
                  tick={{ fontSize: 11 }}
                  label={{ value: t("metrics.frontier.y"), angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <RechartsTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number, name: string) => [`${value}%`, name === "vol" ? t("metrics.frontier.x") : t("metrics.frontier.y")]}
                  labelFormatter={() => ""}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const p: any = payload[0].payload;
                    return (
                      <div className="bg-background border rounded-md px-2 py-1 text-xs shadow">
                        <div className="font-semibold">{p.equity}% {de ? "Aktien" : "Equity"}</div>
                        <div>{t("metrics.frontier.x")}: {p.vol}%</div>
                        <div>{t("metrics.frontier.y")}: {p.ret}%</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={frontierData} fill="hsl(var(--muted-foreground))" line={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 }} shape="circle" />
                <ReferenceDot x={currentDot.vol} y={currentDot.ret} r={7} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("metrics.frontier.legend")}
          </p>
        </div>

        {/* Correlation matrix */}
        <div className="space-y-3 pt-2 border-t">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <GitCompare className="h-4 w-4" /> {t("metrics.corr.title")}
          </h4>
          <p className="text-xs text-muted-foreground">{t("metrics.corr.desc")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]"></TableHead>
                  {correlation.labels.map((l) => (
                    <TableHead key={l} className="text-right text-[10px] uppercase tracking-wider">{l}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {correlation.matrix.map((row, i) => (
                  <TableRow key={correlation.labels[i]}>
                    <TableCell className="font-medium text-xs">{correlation.labels[i]}</TableCell>
                    {row.map((val, j) => (
                      <TableCell
                        key={j}
                        className="text-right font-mono text-xs"
                        style={{ backgroundColor: corrColor(val) }}
                      >
                        {val.toFixed(2)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("metrics.corr.legend")}</p>
        </div>

        <p className="text-[11px] text-muted-foreground border-t pt-3 flex items-start gap-2">
          <BarChart3 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{t("metrics.disclaimer")}</span>
        </p>
      </CardContent>
      )}
    </Card>
  );
}

function MetricTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "warn" | "neutral" }) {
  const accentClass =
    accent === "good" ? "text-emerald-600" :
    accent === "warn" ? "text-destructive" :
    "text-foreground";
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-mono font-semibold mt-1 ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
