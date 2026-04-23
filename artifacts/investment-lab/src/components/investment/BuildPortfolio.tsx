import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Info, Target, ShieldAlert, BookOpen, ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio, computeNaturalBucketCount } from "@/lib/portfolio";
import { StressTest } from "./StressTest";
import { FeeEstimator } from "./FeeEstimator";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import { PortfolioMetrics } from "./PortfolioMetrics";
import { LookThroughAnalysis } from "./LookThroughAnalysis";
import { GeoExposureMap } from "./GeoExposureMap";
import { HomeBiasAnalysis } from "./HomeBiasAnalysis";
import { CurrencyOverview } from "./CurrencyOverview";
import { TopHoldings } from "./TopHoldings";
import { SavedScenariosUI } from "./SavedScenariosUI";
import { DisclaimerPdfBlock } from "./Disclaimer";
import { useT } from "@/lib/i18n";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

const defaultValues: PortfolioInput = {
  baseCurrency: "CHF",
  riskAppetite: "High",
  horizon: 10,
  targetEquityPct: 60,
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
};

export function BuildPortfolio() {
  const { t, lang } = useT();
  const form = useForm<PortfolioInput>({
    defaultValues,
  });

  const [output, setOutput] = useState<PortfolioOutput | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hasGenerated && output) {
      const parsedData = form.getValues();
      setValidation(runValidation(parsedData, lang));
      setOutput(buildPortfolio(parsedData, lang));
    }
  }, [lang]);

  // Auto-sync preferred exchange to base currency: CHF -> SIX, EUR -> XETRA, GBP -> LSE, USD -> All.
  const watchedBaseCcy = form.watch("baseCurrency");
  useEffect(() => {
    const map: Record<string, "SIX" | "XETRA" | "LSE" | "None"> = {
      CHF: "SIX",
      EUR: "XETRA",
      GBP: "LSE",
      USD: "None",
    };
    const target = map[watchedBaseCcy];
    if (target && form.getValues().preferredExchange !== target) {
      form.setValue("preferredExchange", target, { shouldDirty: false });
    }
  }, [watchedBaseCcy]);

  const handleExportPDF = async () => {
    if (!pdfRef.current || !output) return;
    
    setIsExporting(true);
    try {
      const { baseCurrency, riskAppetite } = form.getValues();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `investment-decision-lab_${baseCurrency}_${riskAppetite}_${timestamp}.pdf`;
      
      const { exportToPdf } = await import("@/lib/exportPdf");
      await exportToPdf(pdfRef.current, filename);
      toast.success(t("build.pdf.success"));
    } catch (error) {
      console.error(error);
      toast.error(t("build.pdf.error"));
    } finally {
      setIsExporting(false);
    }
  };

  const onSubmit = (data: PortfolioInput) => {
    // Coerce numeric types that might come back as strings from the form inputs
    const parsedData: PortfolioInput = {
      ...data,
      horizon: Number(data.horizon),
      targetEquityPct: Number(data.targetEquityPct),
      numETFs: Number(data.numETFs),
      numETFsMin: Number(data.numETFsMin ?? data.numETFs),
    };
    
    const valResult = runValidation(parsedData, lang);
    setValidation(valResult);

    if (valResult.isValid) {
      const portOutput = buildPortfolio(parsedData, lang);
      setOutput(portOutput);
    } else {
      setOutput(null);
    }
    
    setHasGenerated(true);
    
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const chartData = output?.allocation.map(a => ({
    name: `${a.assetClass} - ${a.region}`,
    value: a.weight
  })) || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* LEFT COLUMN: FORM */}
      <div className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-8 custom-scrollbar">
        <Card>
          <CardHeader>
            <div className="flex flex-col space-y-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div>
                <CardTitle>{t("build.params.title")}</CardTitle>
                <CardDescription>{t("build.params.desc")}</CardDescription>
              </div>
              <SavedScenariosUI
                hasGenerated={hasGenerated}
                getCurrentInput={() => form.getValues()}
                onLoadScenario={(input) => {
                  form.reset(input);
                  onSubmit(input);
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="baseCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          {t("build.baseCurrency.label")}
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>{t("build.baseCurrency.tooltip")}</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
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
                    name="horizon"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          {t("build.horizon.label")}
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>{t("build.horizon.tooltip")}</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={40} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="riskAppetite"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="flex items-center gap-2">
                        {t("build.riskAppetite.label")}
                        <Tooltip>
                          <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>{t("build.riskAppetite.tooltip")}</TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={(val) => {
                            field.onChange(val);
                            const map: Record<string, number> = {
                              Low: 20,
                              Moderate: 40,
                              High: 60,
                              "Very High": 80,
                            };
                            if (map[val] !== undefined) {
                              form.setValue("targetEquityPct", map[val], {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }
                          }}
                          defaultValue={field.value}
                          className="grid grid-cols-2 gap-2"
                        >
                          {["Low", "Moderate", "High", "Very High"].map((risk) => (
                            <FormItem key={risk} className="flex items-center space-x-2 space-y-0 rounded-md border p-3">
                              <FormControl>
                                <RadioGroupItem value={risk} />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">{t(`risk.${risk}`)}</FormLabel>
                            </FormItem>
                          ))}
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetEquityPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          {t("build.targetEquity.label")}
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>{t("build.targetEquity.tooltip")}</TooltipContent>
                          </Tooltip>
                        </span>
                        <span className="text-sm font-mono">{field.value}%</span>
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-4">
                          <Slider
                            min={0}
                            max={100}
                            step={1}
                            value={[Number(field.value)]}
                            onValueChange={(vals) => field.onChange(vals[0])}
                            className="flex-1"
                          />
                          <Input 
                            type="number" 
                            className="w-16 font-mono text-sm" 
                            {...field} 
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium leading-none">
                      {t("build.numEtfs.label")}
                      <Tooltip>
                        <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-xs whitespace-pre-line">{t("build.numEtfs.tooltip")}</TooltipContent>
                      </Tooltip>
                    </label>
                    <div className="flex items-center gap-2">
                      <Controller
                        control={form.control}
                        name="numETFsMin"
                        render={({ field }) => (
                          <Input type="number" min={3} max={15} placeholder="Min" className="w-20" {...field} value={field.value ?? ""} onChange={(e) => {
                            if (e.target.value === "") { field.onChange(undefined); return; }
                            const v = Math.max(3, Math.min(15, Number(e.target.value)));
                            field.onChange(v);
                            const currentMax = Number(form.getValues("numETFs"));
                            if (Number.isFinite(currentMax) && currentMax < v) form.setValue("numETFs", v);
                          }} />
                        )}
                      />
                      <span className="text-muted-foreground text-sm">–</span>
                      <Controller
                        control={form.control}
                        name="numETFs"
                        render={({ field }) => (
                          <Input type="number" min={3} max={15} placeholder="Max" className="w-20" {...field} onChange={(e) => {
                            if (e.target.value === "") { field.onChange(""); return; }
                            const raw = Math.max(3, Math.min(15, Number(e.target.value)));
                            const currentMin = Number(form.getValues("numETFsMin"));
                            const clamped = Number.isFinite(currentMin) ? Math.max(raw, currentMin) : raw;
                            field.onChange(clamped);
                          }} />
                        )}
                      />
                    </div>
                    <NumEtfsRangeWarning form={form} />
                  </div>
                  <FormField
                    control={form.control}
                    name="preferredExchange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          {t("build.preferredExchange.label")}
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>{t("build.preferredExchange.tooltip")}</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Exchange" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="None">None (Global)</SelectItem>
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
                  name="thematicPreference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        {t("build.thematicTilt.label")}
                        <Tooltip>
                          <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>{t("build.thematicTilt.tooltip")}</TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Theme" />
                          </SelectTrigger>
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

                <div className="space-y-4 pt-4 border-t">
                  <FormField
                    control={form.control}
                    name="includeCurrencyHedging"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.currencyHedging.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.currencyHedging.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeSyntheticETFs"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.syntheticETFs.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.syntheticETFs.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lookThroughView"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.lookThrough.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.lookThrough.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3 pt-2 border-t">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
                    {t("build.satellites.section")}
                  </h4>
                  <FormField
                    control={form.control}
                    name="includeCommodities"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.commodities.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.commodities.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeListedRealEstate"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.realEstate.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.realEstate.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeCrypto"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>{t("build.crypto.label")}</FormLabel>
                          <FormDescription className="text-xs">{t("build.crypto.desc")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <Button type="submit" className="w-full" size="lg">
                  {t("build.btn.generate")}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN: RESULTS */}
      <div className="lg:col-span-7 space-y-6" ref={resultsRef}>
        {!hasGenerated && (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
            <Target className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">Ready to Build</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Configure your preferences on the left and generate a portfolio to see the detailed breakdown, rationales, and ETF implementation.
            </p>
          </div>
        )}

        {hasGenerated && validation && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-2xl font-bold tracking-tight">Portfolio Results</h2>
              {output && validation.isValid && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleExportPDF}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {isExporting ? "Generating PDF..." : "Export PDF"}
                </Button>
              )}
            </div>

            <div ref={pdfRef} className="space-y-6 bg-background">
              {/* Section 2: Validation */}
            {validation.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Validation Errors</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    {validation.errors.map((err, i) => (
                      <li key={i}>
                        <span className="font-medium">{err.message}</span>
                        <br />
                        <span className="opacity-90">{err.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validation.warnings.length > 0 && validation.errors.length === 0 && (
              <Alert className="border-warning text-warning-foreground bg-warning/10">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning font-semibold">Portfolio Warnings</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    {validation.warnings.map((warn, i) => (
                      <li key={i}>
                        <span className="font-medium text-foreground">{warn.message}</span>
                        <br />
                        <span className="text-foreground/80">{warn.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validation.isValid && validation.warnings.length === 0 && (
              <Alert className="border-primary/20 bg-primary/5 text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Inputs Validated</AlertTitle>
                <AlertDescription>Your inputs pass all structural coherence checks.</AlertDescription>
              </Alert>
            )}

            {output && validation.isValid && (
              <>
                {/* Section 1: Profile Summary */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t("build.summary.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{t("build.summary.currency")} {form.getValues().baseCurrency}</Badge>
                      <Badge variant="secondary">{t("build.summary.risk")} {t(`risk.${form.getValues().riskAppetite}`)}</Badge>
                      <Badge variant="secondary">{t("build.summary.horizon")} {form.getValues().horizon}</Badge>
                      <Badge variant="secondary">{t("build.summary.targetEquity")} {form.getValues().targetEquityPct}%</Badge>
                      <Badge variant="outline" className="border-primary/20">{form.getValues().numETFs} {t("build.summary.etfs")}</Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Section 3: Target Asset Allocation */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("build.targetAllocation.title")}</CardTitle>
                    <CardDescription>{t("build.targetAllocation.desc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
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
                          >
                            {chartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            formatter={(value: number) => [`${value}%`, 'Weight']}
                            contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Horizontal Stacked Bar */}
                    <div className="h-4 w-full flex rounded-full overflow-hidden">
                      {chartData.map((d, i) => (
                        <div 
                          key={i} 
                          style={{ width: `${d.value}%`, backgroundColor: COLORS[i % COLORS.length] }} 
                          title={`${d.name}: ${d.value}%`}
                          className="h-full transition-all duration-500 hover:brightness-110"
                        />
                      ))}
                    </div>

                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset Class</TableHead>
                            <TableHead>Region/Detail</TableHead>
                            <TableHead className="text-right">Weight</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {output.allocation.map((alloc, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{alloc.assetClass}</TableCell>
                              <TableCell className="text-muted-foreground">{alloc.region}</TableCell>
                              <TableCell className="text-right font-mono">{alloc.weight.toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell colSpan={2}>Total</TableCell>
                            <TableCell className="text-right font-mono">100.0%</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Section 5: ETF Implementation */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t("build.implementation.title")}</CardTitle>
                    <CardDescription>{t("build.implementation.desc")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.assetClass")}</TableHead>
                            <TableHead className="whitespace-nowrap text-right">{t("build.impl.col.weight")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.name")}</TableHead>
                            <TableHead className="whitespace-nowrap font-mono">{t("build.impl.col.isin")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.ticker")}</TableHead>
                            <TableHead className="whitespace-nowrap text-right">{t("build.impl.col.ter")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.domicile")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.replication")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.distribution")}</TableHead>
                            <TableHead className="whitespace-nowrap">{t("build.impl.col.currency")}</TableHead>
                            <TableHead className="min-w-[220px]">{t("build.impl.col.comment")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {output.etfImplementation.map((etf, i) => (
                            <TableRow key={i}>
                              <TableCell>
                                <div className="font-medium">{etf.assetClass}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{etf.bucket.split(" - ")[1] ?? ""}</div>
                              </TableCell>
                              <TableCell className="text-right font-mono">{etf.weight.toFixed(1)}%</TableCell>
                              <TableCell className="font-medium">{etf.exampleETF}</TableCell>
                              <TableCell className="font-mono whitespace-nowrap">{etf.isin}</TableCell>
                              <TableCell className="font-mono whitespace-nowrap">
                                {etf.ticker}
                                {etf.exchange && etf.exchange !== "—" && (
                                  <span className="text-muted-foreground"> ({etf.exchange})</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">{(etf.terBps / 100).toFixed(2)}%</TableCell>
                              <TableCell className="whitespace-nowrap">{etf.domicile}</TableCell>
                              <TableCell className="whitespace-nowrap">{etf.replication}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {etf.distribution === "Accumulating"
                                  ? t("build.impl.dist.acc")
                                  : t("build.impl.dist.dist")}
                              </TableCell>
                              <TableCell className="font-mono">{etf.currency}</TableCell>
                              <TableCell className="text-muted-foreground min-w-[220px] max-w-[320px]">{etf.comment}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">
                      {t("build.impl.disclaimer")}
                    </p>
                  </CardContent>
                </Card>

                {/* Always-visible: Consolidated Currency Overview (post-hedge) */}
                <CurrencyOverview
                  etfs={output.etfImplementation}
                  baseCurrency={form.getValues().baseCurrency}
                />

                {/* Geographic Exposure Map + Look-Through Analysis + Top 10 Holdings (only when look-through view is active) */}
                {form.getValues().lookThroughView && (
                  <>
                    <GeoExposureMap
                      etfs={output.etfImplementation}
                      baseCurrency={form.getValues().baseCurrency}
                    />
                    <LookThroughAnalysis
                      etfs={output.etfImplementation}
                      baseCurrency={form.getValues().baseCurrency}
                    />
                    <TopHoldings
                      etfs={output.etfImplementation}
                      baseCurrency={form.getValues().baseCurrency}
                    />
                  </>
                )}

                {/* Risk & Performance Metrics (Sharpe, Beta, Alpha, TE, Max DD, Frontier, Correlation) */}
                <PortfolioMetrics allocation={output.allocation} />

                {/* Scenario Stress Test (moved up: directly after Look-Through Analysis) */}
                <StressTest allocation={output.allocation} />

                {/* Monte Carlo Simulation (moved up: directly after Stress Test) */}
                <MonteCarloSimulation
                  allocation={output.allocation}
                  horizonYears={form.getValues().horizon}
                  baseCurrency={form.getValues().baseCurrency}
                  hedged={form.getValues().includeCurrencyHedging}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Section 4: Portfolio Rationale */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4" /> {t("build.rationale.title")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {output.rationale.map((r, i) => (
                        <p key={i} className="leading-relaxed text-muted-foreground">{r}</p>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Section 6: Key Risks */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" /> {t("build.risks.title")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside pl-1">
                        {output.risks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                </div>

                {/* Section 6b: Home Bias Analysis (non-USD bases only, full width, collapsed by default) */}
                {form.getValues().baseCurrency !== "USD" && (
                  <HomeBiasAnalysis
                    etfs={output.etfImplementation}
                    baseCurrency={form.getValues().baseCurrency}
                  />
                )}

                {/* Section 7: Learning Insights */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> {t("build.learning.title")}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {output.learning.map((l, i) => (
                      <Card key={i} className="bg-primary/5 border-primary/10">
                        <CardContent className="p-4 text-sm">
                          <span className="font-semibold text-primary">{l.split(':')[0]}:</span>
                          <span className="text-muted-foreground">{l.split(':')[1]}</span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Fee Estimator */}
                <FeeEstimator 
                  allocation={output.allocation} 
                  horizonYears={form.getValues().horizon} 
                  baseCurrency={form.getValues().baseCurrency}
                  hedged={form.getValues().includeCurrencyHedging}
                />
              </>
            )}
            <DisclaimerPdfBlock />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function NumEtfsRangeWarning({ form }: { form: any }) {
  const values = form.watch();
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
  const lang = (typeof document !== "undefined" && document.documentElement.lang === "de") ? "de" : "en";
  if (max < min) {
    return (
      <p className="text-xs text-destructive mt-1">
        {lang === "de" ? "Max. muss ≥ Min. sein." : "Max must be ≥ Min."}
      </p>
    );
  }
  if (max < natural) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
        {lang === "de"
          ? `Hinweis: Ihre Auswahl benötigt ${natural} Buckets. Setzen Sie Max. auf ${natural} (oder höher), um alle Anlageklassen einzeln abzubilden.`
          : `Heads up: your selections need ${natural} buckets. Set Max to ${natural} (or higher) to keep every asset class as its own ETF.`}
      </p>
    );
  }
  if (min < natural) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
        {lang === "de"
          ? `Hinweis: Optimaler Min.-Wert ist ${natural} (Ihre Auswahl erzeugt ${natural} Buckets). Niedrigere Werte fassen kleinere Satelliten zusammen.`
          : `Heads up: optimal Min is ${natural} (your selections produce ${natural} buckets). Lower values will consolidate smaller satellites.`}
      </p>
    );
  }
  return null;
}
