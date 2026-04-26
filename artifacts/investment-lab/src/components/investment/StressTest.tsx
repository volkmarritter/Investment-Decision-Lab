import { useMemo, useState } from "react";
import { AlertTriangle, TrendingDown, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { AssetAllocation, BaseCurrency } from "@/lib/types";
import { runStressTest, runReverseStressTest } from "@/lib/scenarios";
import { parseDecimalInput } from "@/lib/manualWeights";
import { useT } from "@/lib/i18n";

export function StressTest({
  allocation,
  baseCurrency,
}: {
  allocation: AssetAllocation[];
  baseCurrency?: BaseCurrency;
}) {
  const { t } = useT();
  const results = runStressTest(allocation, baseCurrency);

  // Reverse stress test: text-buffer pattern (CH/DE/FR keyboards). Negative
  // numbers only make sense for a "loss" target, so we clamp to (-100, 0)
  // and fall back to -30 % while the user is editing.
  const [targetLossDraft, setTargetLossDraft] = useState<string>("-30");
  const targetLoss = useMemo(() => {
    const parsed = parseDecimalInput(targetLossDraft, { min: -99.9, max: -0.1 });
    return parsed ?? -30;
  }, [targetLossDraft]);
  const reverse = useMemo(
    () => runReverseStressTest(allocation, targetLoss, baseCurrency),
    [allocation, targetLoss, baseCurrency]
  );

  const chartData = results.map(r => ({
    name: r.name.replace(/^\d{4}\s/, ""),
    total: r.total,
  }));

  return (
    <Card className="mt-6 border-destructive/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Scenario Stress Test
        </CardTitle>
        <CardDescription>
          Deterministic historical-style shocks applied to the current allocation. Illustrative, not a forecast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {results.map(result => {
            const isNegative = result.total < 0;
            const colorClass = isNegative ? "text-destructive" : "text-emerald-600";
            
            return (
              <Card key={result.id} className="bg-muted/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{result.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-mono font-bold ${colorClass}`}>
                      {result.total > 0 ? "+" : ""}{result.total.toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-full ${isNegative ? 'bg-destructive' : 'bg-emerald-500'}`} 
                      style={{ 
                        width: `${Math.min(Math.abs(result.total), 100)}%`,
                      }} 
                    />
                  </div>

                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="contributions" className="border-none">
                      <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                        <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Top Drivers</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-0">
                        <div className="space-y-1.5">
                          {result.contributions.slice(0, 5).map((c, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="truncate pr-2 text-muted-foreground" title={c.key}>{c.key}</span>
                              <span className={`font-mono ${c.contribution < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                                {c.contribution > 0 ? "+" : ""}{c.contribution.toFixed(1)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Reverse Stress Test — "what would have to happen for my plan to break?".
            Two views: λ-multiplier on each historical scenario, and the uniform
            equity-only shock that would reach the target loss. Both are linear
            in shock for a fixed allocation, so cheap to recompute on edit. */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-3" data-testid="reverse-stress">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <Search className="h-3 w-3" />
                {t("stress.reverse.title")}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">
                {t("stress.reverse.desc")}
              </p>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="rev-target" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("stress.reverse.targetLabel")}
                </Label>
                <Input
                  id="rev-target"
                  type="text"
                  inputMode="decimal"
                  value={targetLossDraft}
                  onChange={(e) => setTargetLossDraft(e.target.value)}
                  className="h-8 w-24 font-mono text-sm mt-1"
                  data-testid="rev-target-input"
                />
              </div>
              <span className="text-xs text-muted-foreground pb-2">%</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="text-left py-1.5 font-medium">{t("stress.reverse.driver")}</th>
                  <th className="text-right py-1.5 font-medium">{t("stress.reverse.baseline")}</th>
                  <th className="text-right py-1.5 font-medium">{t("stress.reverse.required")}</th>
                </tr>
              </thead>
              <tbody>
                {reverse.scenarios.map((s) => (
                  <tr key={s.scenarioId} className="border-b border-border/50" data-testid={`rev-scenario-${s.scenarioId}`}>
                    <td className="py-1.5 pr-2">{s.scenarioName}</td>
                    <td className="py-1.5 text-right font-mono">
                      {s.baselineTotal.toFixed(1)}%
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {s.multiplier === null ? (
                        <span className="text-muted-foreground italic">{t("stress.reverse.noLoss")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {s.multiplier.toFixed(2)}×
                          {s.alreadyExceeds && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0">
                              {t("stress.reverse.alreadyExceeds")}
                            </Badge>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr data-testid="rev-equity-only">
                  <td className="py-1.5 pr-2 font-medium">
                    {t("stress.reverse.equityOnly")}
                    <span className="text-[10px] text-muted-foreground ml-1">
                      ({reverse.equityOnly.equityWeightTotal.toFixed(1)}% {t("stress.reverse.equityWeightSuffix")})
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">—</td>
                  <td className="py-1.5 text-right font-mono">
                    {reverse.equityOnly.uniformEquityShock === null ? (
                      <span className="text-muted-foreground italic">{t("stress.reverse.noEquity")}</span>
                    ) : reverse.equityOnly.uniformEquityShock < -99.9 ? (
                      <span className="text-muted-foreground italic">{t("stress.reverse.impossible")}</span>
                    ) : (
                      `${reverse.equityOnly.uniformEquityShock.toFixed(1)}%`
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-[250px] mt-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tickFormatter={(val) => `${val}%`} 
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} 
              />
              <RechartsTooltip 
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [`${value}%`, 'Portfolio Return']}
              />
              <Bar dataKey="total" radius={[4, 4, 4, 4]} maxBarSize={60}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.total < 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
