import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Info, Target, ShieldAlert, BookOpen, ArrowRight, Download, Loader2, RotateCcw, ClipboardCopy, X, Minus, Plus } from "lucide-react";
import {
  loadManualWeights,
  setManualWeight,
  clearManualWeight,
  clearAllManualWeights,
  subscribeManualWeights,
  type ManualWeights,
} from "@/lib/manualWeights";
import { buildAiPrompt } from "@/lib/aiPrompt";
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
import { InfoHint } from "@/components/ui/info-hint";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio, computeNaturalBucketCount } from "@/lib/portfolio";
import { defaultExchangeFor } from "@/lib/exchange";
import { setLastAllocation } from "@/lib/settings";
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
  const [numETFsMode, setNumETFsMode] = useState<"auto" | "manual">("auto");
  const resultsRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  // Auto-adjust the Number of ETFs to match the natural bucket count whenever
  // the user toggles satellite asset classes (Commodities, REITs, Crypto) or
  // changes the Thematic tilt — but only as long as they haven't manually
  // overridden the value (mode === "auto"). Recomputing is also re-triggered
  // by riskAppetite / targetEquity / horizon / baseCurrency since those
  // can shift how many equity region buckets the engine produces.
  const watchedIncludeCommodities = form.watch("includeCommodities");
  const watchedIncludeListedRealEstate = form.watch("includeListedRealEstate");
  const watchedIncludeCrypto = form.watch("includeCrypto");
  const watchedThematicPref = form.watch("thematicPreference");
  const watchedRiskAppetite = form.watch("riskAppetite");
  const watchedTargetEquityPct = form.watch("targetEquityPct");
  const watchedHorizon = form.watch("horizon");
  const watchedBaseCurrencyForEtfs = form.watch("baseCurrency");
  useEffect(() => {
    if (numETFsMode !== "auto") return;
    const v = form.getValues();
    let natural = 0;
    try {
      natural = computeNaturalBucketCount({
        ...v,
        horizon: Number(v.horizon),
        targetEquityPct: Number(v.targetEquityPct),
        numETFs: 15,
      });
    } catch {
      return;
    }
    if (!Number.isFinite(natural) || natural <= 0) return;
    const target = Math.max(3, Math.min(15, natural));
    if (Number(v.numETFs) !== target) {
      form.setValue("numETFs", target, { shouldDirty: false });
    }
    if (Number(v.numETFsMin) !== target) {
      form.setValue("numETFsMin", target, { shouldDirty: false });
    }
  }, [
    numETFsMode,
    watchedIncludeCommodities,
    watchedIncludeListedRealEstate,
    watchedIncludeCrypto,
    watchedThematicPref,
    watchedRiskAppetite,
    watchedTargetEquityPct,
    watchedHorizon,
    watchedBaseCurrencyForEtfs,
  ]);

  // Manual weight overrides — persisted in localStorage, applied at engine
  // build time so frozen rows survive setting changes.
  const [manualWeights, setManualWeightsState] = useState<ManualWeights>(() => loadManualWeights());
  useEffect(() => subscribeManualWeights(setManualWeightsState), []);

  useEffect(() => {
    if (hasGenerated && output) {
      const parsedData = form.getValues();
      setValidation(runValidation(parsedData, lang));
      const next = buildPortfolio(parsedData, lang, manualWeights);
      // Note: setOutput below will re-trigger the [output] effect which
      // publishes setLastAllocation, so we don't need to publish here too.
      setOutput(next);
    }
  }, [lang, manualWeights]);

  // Single source of truth for cross-tab publishing: whenever `output`
  // changes (built, rebuilt, cleared on reset, or cleared on validation
  // failure), publish the new allocation (or null) so other tabs like
  // Methodology can react — e.g. mark which rows of the static correlation
  // matrix are actually held.
  useEffect(() => {
    setLastAllocation(output?.allocation ?? null);
  }, [output]);

  // Auto-sync preferred exchange to base currency.
  const watchedBaseCcy = form.watch("baseCurrency");
  useEffect(() => {
    const target = defaultExchangeFor(watchedBaseCcy);
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
      const portOutput = buildPortfolio(parsedData, lang, manualWeights);
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
            <div className="flex flex-col space-y-3 lg:flex-row lg:items-start lg:justify-between lg:space-y-0 lg:gap-3">
              <div>
                <CardTitle>{t("build.params.title")}</CardTitle>
                <CardDescription>{t("build.params.desc")}</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        const current = form.getValues();
                        form.reset({
                          ...defaultValues,
                          baseCurrency: current.baseCurrency,
                          horizon: current.horizon,
                          riskAppetite: current.riskAppetite,
                        });
                        // Clear any previously-generated portfolio so other tabs
                        // (Methodology correlation matrix) stop showing held
                        // markers from a now-discarded build. The output effect
                        // will publish setLastAllocation(null) automatically.
                        setOutput(null);
                        setValidation(null);
                        setHasGenerated(false);
                        setNumETFsMode("auto");
                      }}
                      aria-label={lang === "de" ? "Auf Standardwerte zurücksetzen" : "Reset to defaults"}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {lang === "de"
                      ? "Auf Standard zurücksetzen (Währung, Horizont, Risikoprofil bleiben)"
                      : "Reset to defaults (Currency, Horizon, Risk preserved)"}
                  </TooltipContent>
                </Tooltip>
                <SavedScenariosUI
                  hasGenerated={hasGenerated}
                  getCurrentInput={() => form.getValues()}
                  onLoadScenario={(input) => {
                    form.reset(input);
                    setNumETFsMode("manual");
                    onSubmit(input);
                  }}
                />
              </div>
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
                          <InfoHint iconClassName="h-3 w-3">{t("build.baseCurrency.tooltip")}</InfoHint>
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
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
                          <InfoHint iconClassName="h-3 w-3">{t("build.horizon.tooltip")}</InfoHint>
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
                        <InfoHint iconClassName="h-3 w-3">{t("build.riskAppetite.tooltip")}</InfoHint>
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
                          value={field.value}
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
                          <InfoHint iconClassName="h-3 w-3">{t("build.targetEquity.tooltip")}</InfoHint>
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium leading-none">
                      {t("build.numEtfs.label")}
                      <InfoHint iconClassName="h-3 w-3" className="whitespace-pre-line"><span className="whitespace-pre-line">{t("build.numEtfs.tooltip")}</span></InfoHint>
                    </label>
                    <div className="flex items-center gap-1">
                      <Controller
                        control={form.control}
                        name="numETFsMin"
                        render={({ field }) => {
                          const current = Number.isFinite(Number(field.value)) ? Number(field.value) : 8;
                          const setMin = (v: number) => {
                            const clamped = Math.max(3, Math.min(15, v));
                            field.onChange(clamped);
                            const currentMax = Number(form.getValues("numETFs"));
                            if (Number.isFinite(currentMax) && currentMax < clamped) form.setValue("numETFs", clamped);
                            setNumETFsMode("manual");
                          };
                          return (
                            <div className="flex items-center flex-1 min-w-0 rounded-md border border-input bg-background overflow-hidden">
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-none shrink-0 hover:bg-accent" onClick={() => setMin(current - 1)} disabled={current <= 3} aria-label="Decrease minimum number of ETFs">
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input type="number" inputMode="numeric" min={3} max={15} placeholder="Min" className="flex-1 min-w-0 border-0 text-center px-1 h-9 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" {...field} value={field.value ?? ""} onChange={(e) => {
                                if (e.target.value === "") { field.onChange(undefined); setNumETFsMode("manual"); return; }
                                setMin(Number(e.target.value));
                              }} />
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-none shrink-0 hover:bg-accent" onClick={() => setMin(current + 1)} disabled={current >= 15} aria-label="Increase minimum number of ETFs">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        }}
                      />
                      <span className="text-muted-foreground text-sm shrink-0 px-1">–</span>
                      <Controller
                        control={form.control}
                        name="numETFs"
                        render={({ field }) => {
                          const current = Number.isFinite(Number(field.value)) ? Number(field.value) : 10;
                          const setMax = (v: number) => {
                            const raw = Math.max(3, Math.min(15, v));
                            const currentMin = Number(form.getValues("numETFsMin"));
                            const clamped = Number.isFinite(currentMin) ? Math.max(raw, currentMin) : raw;
                            field.onChange(clamped);
                            setNumETFsMode("manual");
                          };
                          return (
                            <div className="flex items-center flex-1 min-w-0 rounded-md border border-input bg-background overflow-hidden">
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-none shrink-0 hover:bg-accent" onClick={() => setMax(current - 1)} disabled={current <= 3} aria-label="Decrease maximum number of ETFs">
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input type="number" inputMode="numeric" min={3} max={15} placeholder="Max" className="flex-1 min-w-0 border-0 text-center px-1 h-9 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" {...field} onChange={(e) => {
                                if (e.target.value === "") { field.onChange(""); setNumETFsMode("manual"); return; }
                                setMax(Number(e.target.value));
                              }} />
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-none shrink-0 hover:bg-accent" onClick={() => setMax(current + 1)} disabled={current >= 15} aria-label="Increase maximum number of ETFs">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-start">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {numETFsMode === "auto" ? (
                            <span
                              role="status"
                              aria-label={t("build.numEtfs.modeTooltip.auto")}
                              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/30 cursor-default select-none"
                            >
                              {t("build.numEtfs.auto")}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setNumETFsMode("auto")}
                              aria-label={t("build.numEtfs.modeTooltip.manual")}
                              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                            >
                              {t("build.numEtfs.manual")}
                            </button>
                          )}
                        </TooltipTrigger>
                        <TooltipContent>
                          {numETFsMode === "auto"
                            ? t("build.numEtfs.modeTooltip.auto")
                            : t("build.numEtfs.modeTooltip.manual")}
                        </TooltipContent>
                      </Tooltip>
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
                          <InfoHint iconClassName="h-3 w-3">{t("build.preferredExchange.tooltip")}</InfoHint>
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Exchange" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="None">{t("build.preferredExchange.option.none")}</SelectItem>
                            <SelectItem value="LSE">LSE (London)</SelectItem>
                            <SelectItem value="XETRA">XETRA (Frankfurt)</SelectItem>
                            <SelectItem value="SIX">SIX (Zürich)</SelectItem>
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
                        <InfoHint iconClassName="h-3 w-3">{t("build.thematicTilt.tooltip")}</InfoHint>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
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

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      size="sm"
                      onClick={async () => {
                        const current = form.getValues();
                        const parsed: PortfolioInput = {
                          ...current,
                          horizon: Number(current.horizon),
                          targetEquityPct: Number(current.targetEquityPct),
                          numETFs: Number(current.numETFs),
                          numETFsMin: Number(current.numETFsMin ?? current.numETFs),
                        };
                        const prompt = buildAiPrompt(parsed, lang);
                        try {
                          await navigator.clipboard.writeText(prompt);
                          toast.success(t("build.toast.aiPromptCopied"));
                        } catch {
                          toast.error(t("build.toast.aiPromptError"));
                        }
                      }}
                    >
                      <ClipboardCopy className="h-4 w-4 mr-2" />
                      {t("build.btn.copyAiPrompt")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {t("build.btn.copyAiPrompt.tooltip")}
                  </TooltipContent>
                </Tooltip>
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
            <h3 className="text-lg font-medium">{t("build.empty.title")}</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              {t("build.empty.desc")}
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
                    {(() => {
                      const presentBuckets = new Set(output.etfImplementation.map(e => e.bucket));
                      const activeOverrides = Object.entries(manualWeights).filter(([k]) => presentBuckets.has(k));
                      const activeCount = activeOverrides.length;
                      const pinnedSum = activeOverrides.reduce((s, [, v]) => s + v, 0);
                      const saturated = activeCount > 0 && pinnedSum >= 100;
                      const staleCount = Object.keys(manualWeights).length - activeCount;
                      if (activeCount === 0 && staleCount === 0) return null;
                      return (
                        <div className="mb-3 space-y-2" data-testid="manual-weights-banner">
                          {activeCount > 0 && (
                            <Alert>
                              <Info className="h-4 w-4" />
                              <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <span>
                                  {activeCount === 1
                                    ? t("build.impl.manual.bannerOne")
                                    : t("build.impl.manual.bannerMany").replace("{n}", String(activeCount))}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => clearAllManualWeights()}
                                  data-testid="manual-weights-reset-all"
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  {t("build.impl.manual.resetAll")}
                                </Button>
                              </AlertDescription>
                            </Alert>
                          )}
                          {saturated && (
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>
                                {t("build.impl.manual.warnSaturated").replace("{sum}", pinnedSum.toFixed(1))}
                              </AlertDescription>
                            </Alert>
                          )}
                          {staleCount > 0 && (
                            <Alert>
                              <Info className="h-4 w-4" />
                              <AlertDescription>
                                {t("build.impl.manual.warnStale").replace("{n}", String(staleCount))}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      );
                    })()}
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
                            <TableRow key={i} data-testid={`etf-row-${etf.bucket}`}>
                              <TableCell>
                                <div className="font-medium flex items-center gap-1.5 flex-wrap">
                                  {etf.assetClass}
                                  {etf.isManualOverride && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[9px] px-1.5 py-0 h-4"
                                      data-testid={`custom-badge-${etf.bucket}`}
                                    >
                                      {t("build.impl.manual.badge")}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{etf.bucket.split(" - ")[1] ?? ""}</div>
                              </TableCell>
                              <TableCell className="text-right">
                                <ManualWeightCell
                                  bucket={etf.bucket}
                                  displayedWeight={etf.weight}
                                  isOverride={!!etf.isManualOverride}
                                  pinnedValue={manualWeights[etf.bucket]}
                                  resetTitle={t("build.impl.manual.resetRow")}
                                  editTitle={t("build.impl.manual.editTitle")}
                                />
                              </TableCell>
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

// ---------------------------------------------------------------------------
// Inline editable weight cell. Shows the current displayed weight as a small
// numeric input. When the user commits a value (Enter or blur), the override
// is persisted via setManualWeight; clearManualWeight is wired to the small
// reset button shown when the row is overridden.
// ---------------------------------------------------------------------------
function ManualWeightCell(props: {
  bucket: string;
  displayedWeight: number;
  isOverride: boolean;
  pinnedValue: number | undefined;
  resetTitle: string;
  editTitle: string;
}) {
  const { bucket, displayedWeight, isOverride, pinnedValue, resetTitle, editTitle } = props;
  // Source of truth for the input is ALWAYS the engine's effective weight,
  // not the user-typed pinned value. In the saturated / all-pinned-undershoot
  // edge cases the engine rescales pinned weights to keep the column at 100%,
  // so showing the typed value would diverge from what downstream metrics use.
  const effective = useRef(displayedWeight);
  effective.current = displayedWeight;
  const [draft, setDraft] = useState<string>(displayedWeight.toFixed(1));
  const [focused, setFocused] = useState(false);
  // Cancel/dirty flags used by the commit guard so that (a) Escape truly
  // reverts without persisting, and (b) focus + blur on an untouched cell
  // does not create a phantom override.
  const cancelNext = useRef(false);
  const dirty = useRef(false);

  // Sync external changes (rebuild, reset, lang switch, cross-tab) back into
  // the input when the user is not actively editing.
  useEffect(() => {
    if (!focused) {
      setDraft(displayedWeight.toFixed(1));
      dirty.current = false;
    }
  }, [displayedWeight, focused]);

  const commit = () => {
    if (cancelNext.current) {
      // Escape was pressed — restore the engine value and skip persistence.
      cancelNext.current = false;
      dirty.current = false;
      setDraft(effective.current.toFixed(1));
      return;
    }
    if (!dirty.current) return; // focus + blur with no change ⇒ no-op
    dirty.current = false;
    const parsed = parseFloat(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      // Invalid input: revert to the engine value and clear any existing
      // override so the row goes back to natural sizing.
      setDraft(effective.current.toFixed(1));
      if (isOverride) clearManualWeight(bucket);
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(parsed * 10) / 10));
    // No-op guard: if the typed value matches what is already in effect
    // (the pinned value on an overridden row, or the natural displayed
    // weight on a non-overridden row), don't write to storage. This avoids
    // creating phantom overrides on focus + blur with no real edit.
    const compareTo =
      isOverride && typeof pinnedValue === "number"
        ? pinnedValue
        : effective.current;
    if (Math.abs(clamped - compareTo) < 0.05) {
      setDraft(compareTo.toFixed(1));
      return;
    }
    setDraft(clamped.toFixed(1));
    setManualWeight(bucket, clamped);
  };

  return (
    <div className="inline-flex items-center justify-end gap-1">
      <Input
        type="number"
        inputMode="decimal"
        step="0.1"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            cancelNext.current = true;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        title={editTitle}
        aria-label={editTitle}
        className={`h-7 w-16 px-1.5 text-right font-mono text-xs ${isOverride ? "border-primary/60" : ""}`}
        data-testid={`weight-input-${bucket}`}
      />
      <span className="text-muted-foreground text-xs select-none">%</span>
      {isOverride ? (
        <button
          type="button"
          onClick={() => clearManualWeight(bucket)}
          title={resetTitle}
          aria-label={resetTitle}
          className="text-muted-foreground hover:text-foreground rounded p-0.5"
          data-testid={`weight-reset-${bucket}`}
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <span className="w-4" />
      )}
    </div>
  );
}
