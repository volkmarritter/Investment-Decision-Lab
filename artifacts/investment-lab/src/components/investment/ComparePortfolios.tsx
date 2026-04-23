import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Info, Scale, ShieldAlert, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio, computeNaturalBucketCount } from "@/lib/portfolio";
import { defaultExchangeFor } from "@/lib/exchange";
import { diffPortfolios } from "@/lib/compare";
import { PortfolioMetrics } from "./PortfolioMetrics";
import { StressTest } from "./StressTest";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import { useT } from "@/lib/i18n";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

interface CompareFormValues {
  portA: PortfolioInput;
  portB: PortfolioInput;
}

const defaultValues: CompareFormValues = {
  portA: {
    baseCurrency: "CHF",
    riskAppetite: "Moderate",
    horizon: 10,
    targetEquityPct: 50,
    numETFs: 10,
    numETFsMin: 8,
    preferredExchange: "SIX",
    thematicPreference: "None",
    includeCurrencyHedging: false,
    includeSyntheticETFs: false,
    lookThroughView: true,
    includeCrypto: false,
    includeListedRealEstate: false,
    includeCommodities: true,
  },
  portB: {
    baseCurrency: "CHF",
    riskAppetite: "Very High",
    horizon: 20,
    targetEquityPct: 90,
    numETFs: 13,
    numETFsMin: 11,
    preferredExchange: "SIX",
    thematicPreference: "Technology",
    includeCurrencyHedging: true,
    includeSyntheticETFs: false,
    lookThroughView: true,
    includeCrypto: true,
    includeListedRealEstate: true,
    includeCommodities: true,
  }
};

export function ComparePortfolios() {
  const { lang } = useT();
  const form = useForm<CompareFormValues>({
    defaultValues,
  });

  // Auto-sync preferred exchange to base currency for both portfolios.
  const watchedA = form.watch("portA.baseCurrency");
  const watchedB = form.watch("portB.baseCurrency");
  useEffect(() => {
    const t = defaultExchangeFor(watchedA);
    if (t && form.getValues().portA.preferredExchange !== t) {
      form.setValue("portA.preferredExchange", t, { shouldDirty: false });
    }
  }, [watchedA]);
  useEffect(() => {
    const t = defaultExchangeFor(watchedB);
    if (t && form.getValues().portB.preferredExchange !== t) {
      form.setValue("portB.preferredExchange", t, { shouldDirty: false });
    }
  }, [watchedB]);

  const [outputA, setOutputA] = useState<PortfolioOutput | null>(null);
  const [outputB, setOutputB] = useState<PortfolioOutput | null>(null);
  const [inputA, setInputA] = useState<PortfolioInput | null>(null);
  const [inputB, setInputB] = useState<PortfolioInput | null>(null);
  const [validationA, setValidationA] = useState<ValidationResult | null>(null);
  const [validationB, setValidationB] = useState<ValidationResult | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const onSubmit = (data: CompareFormValues) => {
    const parse = (p: PortfolioInput): PortfolioInput => ({
      ...p,
      horizon: Number(p.horizon),
      targetEquityPct: Number(p.targetEquityPct),
      numETFs: Number(p.numETFs),
      numETFsMin: Number(p.numETFsMin ?? p.numETFs),
    });

    const parsedA = parse(data.portA);
    const parsedB = parse(data.portB);

    const valA = runValidation(parsedA);
    const valB = runValidation(parsedB);
    setValidationA(valA);
    setValidationB(valB);

    if (valA.isValid) { setOutputA(buildPortfolio(parsedA)); setInputA(parsedA); }
    else { setOutputA(null); setInputA(null); }

    if (valB.isValid) { setOutputB(buildPortfolio(parsedB)); setInputB(parsedB); }
    else { setOutputB(null); setInputB(null); }

    setHasGenerated(true);

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const chartDataA = outputA?.allocation.map(a => ({ name: `${a.assetClass} - ${a.region}`, value: a.weight })) || [];
  const chartDataB = outputB?.allocation.map(a => ({ name: `${a.assetClass} - ${a.region}`, value: a.weight })) || [];

  const diff = (outputA && outputB) ? diffPortfolios(outputA, outputB) : null;

  const renderFormColumn = (prefix: "portA" | "portB", title: string) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name={`${prefix}.baseCurrency`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Base Currency</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Currency" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="CHF">CHF</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`${prefix}.horizon`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Horizon (Years)</FormLabel>
                <FormControl><Input type="number" min={1} max={40} {...field} /></FormControl>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name={`${prefix}.riskAppetite`}
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Risk Appetite</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                  {["Low", "Moderate", "High", "Very High"].map((risk) => (
                    <FormItem key={risk} className="flex items-center space-x-2 space-y-0 rounded-md border p-2">
                      <FormControl><RadioGroupItem value={risk} /></FormControl>
                      <FormLabel className="font-normal cursor-pointer w-full text-xs">{risk}</FormLabel>
                    </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={`${prefix}.targetEquityPct`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex justify-between items-center">
                <span>Target Equity Allocation</span>
                <span className="text-sm font-mono">{field.value}%</span>
              </FormLabel>
              <FormControl>
                <div className="flex items-center gap-4">
                  <Slider min={0} max={100} step={1} value={[Number(field.value)]} onValueChange={(vals) => field.onChange(vals[0])} className="flex-1" />
                  <Input type="number" className="w-16 font-mono text-sm" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Number of ETFs (min – max)</label>
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name={`${prefix}.numETFsMin`}
                render={({ field }) => (
                  <Input type="number" min={3} max={15} placeholder="Min" className="w-20" {...field} value={field.value ?? ""} onChange={(e) => {
                    if (e.target.value === "") { field.onChange(undefined); return; }
                    const v = Math.max(3, Math.min(15, Number(e.target.value)));
                    field.onChange(v);
                    const currentMax = Number(form.getValues(`${prefix}.numETFs`));
                    if (Number.isFinite(currentMax) && currentMax < v) form.setValue(`${prefix}.numETFs`, v);
                  }} />
                )}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <Controller
                control={form.control}
                name={`${prefix}.numETFs`}
                render={({ field }) => (
                  <Input type="number" min={3} max={15} placeholder="Max" className="w-20" {...field} onChange={(e) => {
                    if (e.target.value === "") { field.onChange(""); return; }
                    const raw = Math.max(3, Math.min(15, Number(e.target.value)));
                    const currentMin = Number(form.getValues(`${prefix}.numETFsMin`));
                    const clamped = Number.isFinite(currentMin) ? Math.max(raw, currentMin) : raw;
                    field.onChange(clamped);
                  }} />
                )}
              />
            </div>
            <CompareNumEtfsRangeWarning form={form} prefix={prefix} />
          </div>
          <FormField
            control={form.control}
            name={`${prefix}.preferredExchange`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Preferred Exchange</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Exchange" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="None">None</SelectItem>
                    <SelectItem value="LSE">LSE</SelectItem>
                    <SelectItem value="XETRA">XETRA</SelectItem>
                    <SelectItem value="SIX">SIX</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name={`${prefix}.thematicPreference`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Thematic Tilt</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Theme" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  <SelectItem value="Technology">Technology</SelectItem>
                  <SelectItem value="Healthcare">Healthcare</SelectItem>
                  <SelectItem value="Sustainability">Sustainability</SelectItem>
                  <SelectItem value="Cybersecurity">Cybersecurity</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <div className="space-y-3 pt-4 border-t">
          <FormField
            control={form.control}
            name={`${prefix}.includeCurrencyHedging`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Currency Hedging</FormLabel>
                  <FormDescription className="text-xs">Hedge foreign exposure</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`${prefix}.includeSyntheticETFs`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Include Synthetic ETFs</FormLabel>
                  <FormDescription className="text-xs">
                    Use swap-based replication for US equity to eliminate 15% dividend withholding-tax leakage (~20-30 bps/yr); accepts controlled counterparty risk.
                  </FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`${prefix}.lookThroughView`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Look-Through Analysis</FormLabel>
                  <FormDescription className="text-xs">
                    Decompose selected ETFs into their underlying country, sector and top-holding exposures to reveal hidden concentration and overlap.
                  </FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3 pt-2 border-t">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            Satellite Asset Classes
          </h4>
          <FormField
            control={form.control}
            name={`${prefix}.includeCommodities`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Commodities (Gold)</FormLabel>
                  <FormDescription className="text-xs">Add a gold sleeve as inflation/crisis diversifier</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`${prefix}.includeListedRealEstate`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Listed Real Estate</FormLabel>
                  <FormDescription className="text-xs">Add a REIT allocation</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`${prefix}.includeCrypto`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>Include Crypto</FormLabel>
                  <FormDescription className="text-xs">Add a small digital asset allocation</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8 pb-12">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {renderFormColumn("portA", "Portfolio A")}
            {renderFormColumn("portB", "Portfolio B")}
          </div>

          <div className="flex justify-center">
            <Button type="submit" size="lg" className="w-full max-w-md gap-2">
              <Scale className="h-5 w-5" /> Compare Portfolios
            </Button>
          </div>
        </form>
      </Form>

      <div ref={resultsRef} className="pt-8">
        {!hasGenerated ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
            <Scale className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">Configure and Compare</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Setup both portfolios above and compare their structural allocation differences side by side.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Validation Alerts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                {validationA?.errors.length ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Portfolio A Errors</AlertTitle>
                    <AlertDescription>{validationA.errors[0].message}</AlertDescription>
                  </Alert>
                ) : validationA?.warnings.length ? (
                  <Alert className="border-warning text-warning-foreground bg-warning/10">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Portfolio A Warnings ({validationA.warnings.length})</AlertTitle>
                  </Alert>
                ) : validationA?.isValid && (
                  <Alert className="border-primary/20 bg-primary/5 text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Portfolio A Valid</AlertTitle>
                  </Alert>
                )}
              </div>
              <div>
                {validationB?.errors.length ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Portfolio B Errors</AlertTitle>
                    <AlertDescription>{validationB.errors[0].message}</AlertDescription>
                  </Alert>
                ) : validationB?.warnings.length ? (
                  <Alert className="border-warning text-warning-foreground bg-warning/10">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Portfolio B Warnings ({validationB.warnings.length})</AlertTitle>
                  </Alert>
                ) : validationB?.isValid && (
                  <Alert className="border-primary/20 bg-primary/5 text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Portfolio B Valid</AlertTitle>
                  </Alert>
                )}
              </div>
            </div>

            {outputA && outputB && diff && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                {/* Structural Differences */}
                <Card>
                  <CardHeader>
                    <CardTitle>Structural Differences</CardTitle>
                    <CardDescription>Direct allocation delta between A and B</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-8">
                    {diff.observations.length > 0 && (
                      <ul className="space-y-2 list-disc pl-5">
                        {diff.observations.map((obs, i) => (
                          <li key={i} className="text-sm">{obs}</li>
                        ))}
                      </ul>
                    )}

                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Asset Class / Region</TableHead>
                            <TableHead className="text-right">Portfolio A %</TableHead>
                            <TableHead className="text-right">Portfolio B %</TableHead>
                            <TableHead className="text-right">Δ (B - A)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {diff.rows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">
                                <div>{row.assetClass}</div>
                                <div className="text-xs text-muted-foreground">{row.region}</div>
                              </TableCell>
                              <TableCell className="text-right font-mono">{row.a.toFixed(1)}%</TableCell>
                              <TableCell className="text-right font-mono">{row.b.toFixed(1)}%</TableCell>
                              <TableCell className={`text-right font-mono font-medium ${row.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : row.delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                {row.delta > 0 ? '+' : ''}{row.delta.toFixed(1)}%
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Side by side charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <Card>
                    <CardHeader>
                      <CardTitle>Portfolio A Allocation</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={chartDataA} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                              {chartDataA.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RechartsTooltip formatter={(value: number) => [`${value}%`, 'Weight']} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="h-4 w-full flex rounded-full overflow-hidden mt-4">
                        {chartDataA.map((d, i) => (
                          <div key={i} style={{ width: `${d.value}%`, backgroundColor: COLORS[i % COLORS.length] }} title={`${d.name}: ${d.value}%`} className="h-full" />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle>Portfolio B Allocation</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={chartDataB} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                              {chartDataB.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RechartsTooltip formatter={(value: number) => [`${value}%`, 'Weight']} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="h-4 w-full flex rounded-full overflow-hidden mt-4">
                        {chartDataB.map((d, i) => (
                          <div key={i} style={{ width: `${d.value}%`, backgroundColor: COLORS[i % COLORS.length] }} title={`${d.name}: ${d.value}%`} className="h-full" />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Per-portfolio deep dives: Risk Metrics, Stress Test, Monte Carlo */}
                {inputA && inputB && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{lang === "de" ? "Detailanalyse je Portfolio" : "Per-Portfolio Deep Dive"}</CardTitle>
                      <CardDescription>
                        {lang === "de"
                          ? "Risiko-Kennzahlen, Szenario-Stresstests und Monte-Carlo-Simulation für jedes Portfolio."
                          : "Risk metrics, scenario stress tests and Monte Carlo simulation for each portfolio."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="A" className="w-full">
                        <TabsList className="grid w-full max-w-xs grid-cols-2">
                          <TabsTrigger value="A">Portfolio A</TabsTrigger>
                          <TabsTrigger value="B">Portfolio B</TabsTrigger>
                        </TabsList>
                        <TabsContent value="A" className="space-y-0 mt-4">
                          <PortfolioMetrics allocation={outputA!.allocation} />
                          <StressTest allocation={outputA!.allocation} />
                          <MonteCarloSimulation
                            allocation={outputA!.allocation}
                            horizonYears={inputA.horizon}
                            baseCurrency={inputA.baseCurrency}
                            hedged={inputA.includeCurrencyHedging}
                          />
                        </TabsContent>
                        <TabsContent value="B" className="space-y-0 mt-4">
                          <PortfolioMetrics allocation={outputB!.allocation} />
                          <StressTest allocation={outputB!.allocation} />
                          <MonteCarloSimulation
                            allocation={outputB!.allocation}
                            horizonYears={inputB.horizon}
                            baseCurrency={inputB.baseCurrency}
                            hedged={inputB.includeCurrencyHedging}
                          />
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function CompareNumEtfsRangeWarning({ form, prefix }: { form: any; prefix: "portA" | "portB" }) {
  const values = form.watch(prefix);
  if (!values) return null;
  const min = Number(values.numETFsMin ?? values.numETFs);
  const max = Number(values.numETFs);
  let natural = 0;
  try {
    natural = computeNaturalBucketCount({
      ...values,
      horizon: Number(values.horizon),
      targetEquityPct: Number(values.targetEquityPct),
      numETFs: 15,
    });
  } catch {
    return null;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max < min) {
    return <p className="text-xs text-destructive mt-1">Max must be ≥ Min.</p>;
  }
  if (max < natural) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
        Selections need {natural} buckets. Set Max to {natural} or higher.
      </p>
    );
  }
  if (min < natural) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
        Optimal Min is {natural}. Lower values consolidate smaller satellites.
      </p>
    );
  }
  return null;
}
