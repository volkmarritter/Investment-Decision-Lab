import { useEffect, useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { Sigma, Activity, BarChart3, GitCompare, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoHint } from "@/components/ui/info-hint";
import { AssetAllocation, BaseCurrency } from "@/lib/types";
import { computeMetrics, computeFrontier, buildCorrelationMatrix, mapAllocationToAssets, CMA } from "@/lib/metrics";
import { getRiskFreeRate, subscribeRiskFreeRate, subscribeCMAOverrides } from "@/lib/settings";
import { applyCMALayers } from "@/lib/metrics";
import { useT } from "@/lib/i18n";

export function PortfolioMetrics({ allocation, baseCurrency }: { allocation: AssetAllocation[]; baseCurrency: BaseCurrency }) {
  const { t, lang } = useT();
  const de = lang === "de";
  const [showDetails, setShowDetails] = useState(false);
  const [rf, setRf] = useState<number>(() => getRiskFreeRate(baseCurrency));
  useEffect(() => subscribeRiskFreeRate((all) => setRf(all[baseCurrency])), [baseCurrency]);
  // Re-read RF whenever the active base currency changes (Sharpe / Alpha must
  // re-render with the new currency's RF immediately, even before the user
  // re-builds the portfolio).
  useEffect(() => { setRf(getRiskFreeRate(baseCurrency)); }, [baseCurrency]);
  // Re-render whenever the user edits CMA overrides in the Methodology tab.
  const [cmaVersion, setCmaVersion] = useState(0);
  useEffect(() => subscribeCMAOverrides(() => { applyCMALayers(); setCmaVersion((v) => v + 1); }), []);

  const m = useMemo(() => computeMetrics(allocation, baseCurrency), [allocation, baseCurrency, rf, cmaVersion]);
  const frontier = useMemo(() => computeFrontier(allocation, baseCurrency), [allocation, baseCurrency, rf, cmaVersion]);
  const correlation = useMemo(() => buildCorrelationMatrix(allocation), [allocation]);
  const exposures = useMemo(() => mapAllocationToAssets(allocation), [allocation]);

  const explain = {
    expReturn: {
      title: t("metrics.expReturn"),
      body: de
        ? "Was Sie auf lange Sicht jährlich verdienen könnten, im Schnitt. In manchen Jahren mehr, in anderen viel weniger – diese Zahl ist ein langfristiger Mittelwert, keine Garantie."
        : "What you might earn on average per year over the long run. Some years much more, some years far less — this is a long-term average, not a guarantee.",
    },
    vol: {
      title: t("metrics.vol"),
      body: de
        ? "Wie stark Ihr Portfolio typischerweise schwankt. Faustregel: in rund zwei von drei Jahren bewegt sich die Rendite innerhalb von ± diesem Wert um die erwartete Rendite."
        : "How much your portfolio typically swings up and down. Rule of thumb: in roughly two out of three years the return falls within ± this number around the expected return.",
    },
    sharpe: {
      title: t("metrics.sharpe"),
      body: de
        ? "Belohnung pro Einheit Risiko. > 0,5 ist ordentlich, > 1 ist sehr gut. Werte unter 0 bedeuten: Sie hätten besser Cash gehalten."
        : "Reward per unit of risk taken. > 0.5 is decent, > 1 is very good. Below 0 means you would have been better off just holding cash.",
    },
    maxDD: {
      title: t("metrics.maxDD"),
      body: de
        ? "Geschätzter schlimmster Wertverlust von Höchststand bis Tiefpunkt in einer schweren Krise. Wichtig: Können Sie das aushalten, ohne nervös zu verkaufen?"
        : "Estimated worst-case fall from peak to trough during a severe crisis. The key question: could you stomach this without panic-selling?",
    },
    beta: {
      title: t("metrics.beta"),
      body: de
        ? "Wie stark Ihr Portfolio mit dem globalen Aktienmarkt mitschwingt. 1,0 = bewegt sich wie der Markt; 0,5 = halb so stark; 1,2 = 20 % stärker."
        : "How much your portfolio moves with the global stock market. 1.0 = moves with the market; 0.5 = half as much; 1.2 = 20% more.",
    },
    alpha: {
      title: t("metrics.alpha"),
      body: de
        ? "Mehrrendite, die Sie über das hinaus erwarten können, was Ihr Marktrisiko (Beta) ohnehin schon liefern sollte. Positiv = Ihre Mischung fügt Wert hinzu."
        : "The extra return you can expect beyond what your market risk (beta) alone would deliver. Positive = your mix is adding value on top of the market.",
    },
    te: {
      title: t("metrics.te"),
      body: de
        ? "Wie weit Ihre Jahresrendite typischerweise vom globalen Aktienmarkt abweichen wird – nach oben oder unten. Höher = mutigere Wetten gegen den Markt."
        : "How far your annual return will typically drift from the global stock market — up or down. Higher = bolder bets away from the index.",
    },
    outperf: {
      title: t("metrics.outperf"),
      body: de
        ? "Erwartete Mehrrendite (oder Minderrendite) gegenüber einem Welt-Aktienindex pro Jahr. Negativ ist normal, wenn Sie defensiver investieren als der Markt."
        : "Expected extra return (or shortfall) versus a world equity index per year. Negative is normal if you invest more defensively than the market.",
    },
  };

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
        <CardTitle className="flex items-center gap-2">
          <Sigma className="h-5 w-5" /> {t("metrics.title")}
        </CardTitle>
        <CardDescription>{t("metrics.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Scalar metrics grid — 8 tiles, always visible */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile label={t("metrics.expReturn")} value={pct(m.expReturn)} sub={de ? "p.a." : "p.a."} info={explain.expReturn} />
          <MetricTile label={t("metrics.vol")} value={pct(m.vol)} sub={de ? "Standardabw." : "stdev"} info={explain.vol} />
          <MetricTile label={t("metrics.sharpe")} value={num(m.sharpe)} sub={`Rf ${pct(rf, 1)}`} accent={m.sharpe >= 0.4 ? "good" : m.sharpe >= 0.2 ? "neutral" : "warn"} info={explain.sharpe} />
          <MetricTile label={t("metrics.maxDD")} value={pct(m.maxDrawdown, 1)} sub={de ? "geschätzt" : "estimated"} accent="warn" info={explain.maxDD} />
          <MetricTile label={t("metrics.beta")} value={num(m.beta)} sub={de ? "vs. ACWI" : "vs ACWI"} info={explain.beta} />
          <MetricTile label={t("metrics.alpha")} value={pct(m.alpha)} sub={de ? "p.a. vs. ACWI" : "p.a. vs ACWI"} accent={m.alpha >= 0 ? "good" : "warn"} info={explain.alpha} />
          <MetricTile label={t("metrics.te")} value={pct(m.trackingError, 1)} sub={de ? "p.a." : "p.a."} info={explain.te} />
          <MetricTile label={t("metrics.outperf")} value={`${m.outperformance >= 0 ? "+" : ""}${pct(m.outperformance)}`} sub={de ? "vs. ACWI p.a." : "vs ACWI p.a."} accent={m.outperformance >= 0 ? "good" : "warn"} info={explain.outperf} />
        </div>

        {/* Show Details toggle — reveals asset table, efficient frontier, correlation matrix */}
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showDetails ? t("build.homeBias.collapse") : t("build.homeBias.expand")}
          </Button>
        </div>

        {showDetails && (
          <>
            {/* Per-asset expected returns table */}
            <div className="space-y-3 pt-2 border-t">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> {t("metrics.assetTable.title")}
              </h4>
              <p className="text-xs text-muted-foreground">{t("metrics.assetTable.desc")}</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("metrics.assetTable.asset")}</TableHead>
                      <TableHead className="text-right">{t("metrics.assetTable.weight")}</TableHead>
                      <TableHead className="text-right">{t("metrics.assetTable.expReturn")}</TableHead>
                      <TableHead className="text-right">{t("metrics.assetTable.vol")}</TableHead>
                      <TableHead className="text-right">{t("metrics.assetTable.contribution")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exposures.map((e) => {
                      const cma = CMA[e.key];
                      return (
                        <TableRow key={e.key}>
                          <TableCell className="font-medium text-xs">{cma.label}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{(e.weight * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-xs">{(cma.expReturn * 100).toFixed(2)}%</TableCell>
                          <TableCell className="text-right font-mono text-xs">{(cma.vol * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-xs">{(e.weight * cma.expReturn * 100).toFixed(2)}%</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell className="font-semibold text-xs">{t("metrics.assetTable.total")}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">100.0%</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{(m.expReturn * 100).toFixed(2)}%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
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
                  {correlation.labels.map((l, idx) => (
                    <TableHead
                      key={l}
                      className={`text-right text-[10px] uppercase tracking-wider ${correlation.held[idx] ? "text-foreground font-semibold" : "text-muted-foreground/70"}`}
                    >
                      {l}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {correlation.matrix.map((row, i) => (
                  <TableRow
                    key={correlation.labels[i]}
                    data-held={correlation.held[i] ? "true" : "false"}
                    className={correlation.held[i] ? "" : "opacity-60"}
                  >
                    <TableCell className={`text-xs ${correlation.held[i] ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                      {correlation.labels[i]}
                      {correlation.held[i] && <span className="ml-1 text-[9px] text-primary/80 align-top">●</span>}
                    </TableCell>
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
          <p className="text-[11px] text-muted-foreground">
            <span className="text-primary/80">●</span> {t("metrics.corr.heldLegend")}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("metrics.corr.legend")}</p>
        </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground border-t pt-3 flex items-start gap-2">
          <BarChart3 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{t("metrics.disclaimer")}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function MetricTile({ label, value, sub, accent, info }: { label: string; value: string; sub?: string; accent?: "good" | "warn" | "neutral"; info?: { title: string; body: string } }) {
  const accentClass =
    accent === "good" ? "text-emerald-600" :
    accent === "warn" ? "text-destructive" :
    "text-foreground";
  return (
    <div className="rounded-lg border bg-muted/20 p-3 relative">
      <div className="flex items-start justify-between gap-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        {info && (
          <InfoHint
            title={info.title}
            side="top"
            align="end"
            iconClassName="h-3.5 w-3.5"
            className="-mt-0.5 -mr-0.5"
          >
            {info.body}
          </InfoHint>
        )}
      </div>
      <div className={`text-xl font-mono font-semibold mt-1 ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
