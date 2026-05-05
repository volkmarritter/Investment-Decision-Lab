import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, ChevronDown, Info, Target, ShieldAlert, BookOpen, ArrowRight, Download, Loader2, RotateCcw, ClipboardCopy, X, Minus, Plus, Search } from "lucide-react";
import {
  loadManualWeights,
  setManualWeight,
  clearManualWeight,
  clearAllManualWeights,
  subscribeManualWeights,
  parseManualWeightInput,
  MANUAL_WEIGHTS_SUM_EPSILON,
  type ManualWeights,
} from "@/lib/manualWeights";
import {
  setETFSelection,
  subscribeETFSelections,
  getAllETFSelections,
  clearAllETFSelections,
  type ETFSlot,
} from "@/lib/etfSelection";
import { buildAiPrompt } from "@/lib/aiPrompt";
import { AllocationGroupSummary } from "./AllocationGroupSummary";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { MaximisableSection } from "./MaximisableSection";
import { cn } from "@/lib/utils";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio, computeNaturalBucketCount } from "@/lib/portfolio";
import { mapAllocationToAssetsLookthrough, CMA } from "@/lib/metrics";
import { colorForBucket, compareBuckets } from "@/lib/chartColors";
import { defaultExchangeFor } from "@/lib/exchange";
import {
  setLastAllocation,
  setLastEtfImplementation,
  setLastBuildInput,
  setLastBuildManualWeights,
  getBuildRationaleRisksOpen,
  setBuildRationaleRisksOpen,
} from "@/lib/settings";
import { StressTest } from "./StressTest";
import { FeeEstimator } from "./FeeEstimator";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import { PortfolioMetrics } from "./PortfolioMetrics";
import type { RiskRegime } from "@/lib/metrics";
import { LookThroughAnalysis } from "./LookThroughAnalysis";
import { GeoExposureMap } from "./GeoExposureMap";
import { HomeBiasAnalysis } from "./HomeBiasAnalysis";
import { CurrencyOverview } from "./CurrencyOverview";
import { TopHoldings } from "./TopHoldings";
import { ETFDetailsDialog } from "./ETFDetailsDialog";
import { EtfImplementationCommentCell } from "./EtfImplementationCommentCell";
import { ETFSnapshotFreshness } from "./SnapshotFreshness";
import { SavedScenariosUI } from "./SavedScenariosUI";
import { DisclaimerPdfBlock } from "./Disclaimer";
import { PortfolioReport } from "./PortfolioReport";
import { useT } from "@/lib/i18n";
import { exportEtfImplementationXlsx } from "@/lib/exportEtfImplementationXlsx";

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
  // Shared Crisis-Σ toggle: lifted up from PortfolioMetrics + MonteCarlo so a
  // single flip moves both tiles into the stressed-correlation view (Task #99).
  // Default "normal" preserves the legacy baseline reading.
  const [riskRegime, setRiskRegime] = useState<RiskRegime>("normal");
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDetailed, setIsExportingDetailed] = useState(false);
  const [numETFsMode, setNumETFsMode] = useState<"auto" | "manual">("auto");
  const [detailsEtf, setDetailsEtf] = useState<import("@/lib/types").ETFImplementation | null>(null);
  // Persisted open/closed state for the "Rationale & Key Risks" collapsible
  // (Task #85). Hydrated synchronously from localStorage so the first render
  // already reflects the user's last choice — no flash of the default-open
  // state before a useEffect could close it.
  const [rationaleRisksOpen, setRationaleRisksOpenState] = useState<boolean>(
    () => getBuildRationaleRisksOpen(),
  );
  const resultsRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const pdfDetailedRef = useRef<HTMLDivElement>(null);

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

  // Per-bucket ETF selection (default vs. curated alternative). Storage
  // lives in lib/etfSelection.ts; we don't keep a local copy because
  // getETFDetails() reads it directly during buildPortfolio(). The
  // monotonically-increasing tick below is a dep of the rebuild effect
  // below — incrementing it on every selection change is what forces
  // buildPortfolio() to re-run and pick up the new slot.
  const [etfSelectionTick, bumpEtfSelectionTick] = useState(0);
  useEffect(
    () => subscribeETFSelections(() => bumpEtfSelectionTick((n) => n + 1)),
    [],
  );

  // Track whether any per-bucket ETF picker selection is currently active,
  // so the "Reset ETFs to Default" header button can be disabled when
  // there is nothing to reset (avoids the "did anything happen?" surprise).
  // Initialized synchronously and kept in sync via the same etfSelection
  // change channel the rebuild effect uses.
  const [hasEtfSelections, setHasEtfSelections] = useState<boolean>(
    () => Object.keys(getAllETFSelections()).length > 0,
  );
  useEffect(
    () =>
      subscribeETFSelections((all) =>
        setHasEtfSelections(Object.keys(all).length > 0),
      ),
    [],
  );

  // Cross-tab publishing: broadcast the latest Build form values and
  // manual-weights snapshot so the Compare tab can mirror them into Slot A
  // (when linked). In-memory only — fresh on full page reload, mirrors the
  // existing setLastAllocation pattern.
  //
  // GATED on hasGenerated: until the user explicitly clicks "Generate
  // Portfolio" at least once, Build is just sitting at its default form
  // values and there is no portfolio to link Compare to. Publishing pre-
  // generate would auto-link Slot A on every fresh page load and replace
  // Compare's own defaults with Build's defaults — confusing and not what
  // the user asked for. Once hasGenerated flips true, we publish the
  // current snapshot and then keep streaming updates via form.watch so
  // mid-edit changes show up live in a linked Slot A.
  useEffect(() => {
    if (!hasGenerated) return;
    setLastBuildInput(form.getValues() as unknown as Record<string, unknown>);
    const sub = form.watch((value) => {
      setLastBuildInput(value as unknown as Record<string, unknown>);
    });
    return () => sub.unsubscribe();
  }, [form, hasGenerated]);

  // Manual-weights snapshot pub/sub. Same hasGenerated gate as above —
  // pre-generate, the local snapshot is whatever the user is mid-pinning
  // but hasn't asked to apply yet. Once Build has generated, every
  // subsequent pin/unpin/edit propagates to Compare.
  useEffect(() => {
    if (!hasGenerated) return;
    setLastBuildManualWeights(manualWeights);
  }, [manualWeights, hasGenerated]);

  useEffect(() => {
    if (hasGenerated && output) {
      const parsedData = form.getValues();
      setValidation(runValidation(parsedData, lang));
      const next = buildPortfolio(parsedData, lang, manualWeights);
      // Note: setOutput below will re-trigger the [output] effect which
      // publishes setLastAllocation, so we don't need to publish here too.
      setOutput(next);
    }
  }, [lang, manualWeights, etfSelectionTick]);

  // Single source of truth for cross-tab publishing: whenever `output`
  // changes (built, rebuilt, cleared on reset, or cleared on validation
  // failure), publish the new allocation (or null) so other tabs like
  // Methodology can react — e.g. mark which rows of the static correlation
  // matrix are actually held.
  // The `lookThroughView` toggle gates the look-through routing globally:
  // when OFF, downstream metric/correlation consumers fall back to the simpler
  // row-region routing (Europe ETF row → continental EU bucket etc.). When ON,
  // we publish the actual etfImplementation so look-through can decompose
  // multi-country ETFs (UK/CH split out of the Europe ETF, etc.).
  const watchedLookThroughView = form.watch("lookThroughView");
  useEffect(() => {
    setLastAllocation(output?.allocation ?? null);
    setLastEtfImplementation(
      watchedLookThroughView && output?.etfImplementation ? output.etfImplementation : null,
    );
  }, [output, watchedLookThroughView]);

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

  // Detailed PDF export — same off-screen pattern as the basic report, but
  // points at the second pdfDetailedRef which mounts a <PortfolioReport
  // variant="detailed" />. The detailed variant adds Top 10 Equity Holdings
  // (always look-through), Monte Carlo summary + chart, and Fee Estimator
  // summary, so the resulting PDF naturally spans two pages — exportToPdf's
  // pagination already handles multi-page output cleanly.
  const handleExportDetailedPDF = async () => {
    if (!pdfDetailedRef.current || !output) return;

    setIsExportingDetailed(true);
    try {
      const { baseCurrency, riskAppetite } = form.getValues();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `investment-decision-lab_detailed_${baseCurrency}_${riskAppetite}_${timestamp}.pdf`;

      const { exportToPdf } = await import("@/lib/exportPdf");
      await exportToPdf(pdfDetailedRef.current, filename);
      toast.success(t("build.pdf.successDetailed"));
    } catch (error) {
      console.error(error);
      toast.error(t("build.pdf.error"));
    } finally {
      setIsExportingDetailed(false);
    }
  };

  // Core generate routine. `scrollToResults` controls whether the page
  // jumps down to the results column after the build — true for explicit
  // user actions (Generate button, scenario load), false for the silent
  // first-mount auto-generate (Task #96) so the user lands at the top of
  // the page on the form, not pre-scrolled into the output.
  const generatePortfolio = (
    data: PortfolioInput,
    opts: { scrollToResults?: boolean } = {},
  ) => {
    const scrollToResults = opts.scrollToResults ?? true;
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

    if (scrollToResults) {
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  // react-hook-form passes `(data, event)` to the submit callback, so we
  // wrap generatePortfolio in a single-arg adapter to keep the default
  // (scroll-to-results) behaviour for explicit user submissions.
  const onSubmit = (data: PortfolioInput) => {
    generatePortfolio(data, { scrollToResults: true });
  };

  // Auto-generate an example portfolio on first mount (Task #96) so first-
  // time visitors see the full output instead of the empty "Ready to Build"
  // state. Reuses the same generate path as a real button click — including
  // validation, output state, manual-weights snapshotting and the cross-tab
  // broadcast — but with scroll suppressed so the user stays at the top of
  // the page. Guarded by a ref so the effect runs exactly once even under
  // React StrictMode's double-invoke in development.
  const didAutoGenerateRef = useRef(false);
  useEffect(() => {
    if (didAutoGenerateRef.current) return;
    didAutoGenerateRef.current = true;
    generatePortfolio(form.getValues(), { scrollToResults: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseChartData = (output?.allocation.map(a => ({
    name: `${a.assetClass} - ${a.region}`,
    value: a.weight
  })) || []).slice().sort(compareBuckets);

  // When Look-Through is ON and an ETF implementation exists, decompose the
  // pie/stacked-bar into the underlying country buckets (e.g. Equity-Europe
  // splits into UK / CH / Continental EU based on the actual MSCI Europe
  // holdings). When OFF or no implementation yet, use the row-level buckets.
  const chartData = (() => {
    if (!output || !watchedLookThroughView || output.etfImplementation.length === 0) {
      return baseChartData;
    }
    const lt = mapAllocationToAssetsLookthrough(
      output.allocation,
      output.etfImplementation,
      watchedBaseCcy,
    );
    return lt
      .filter(e => e.weight > 0)
      .map(e => ({ name: CMA[e.key].label, value: e.weight * 100 }))
      .sort(compareBuckets);
  })();

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
                  getCurrentManualWeights={() => manualWeights}
                  getCurrentETFSelections={() => getAllETFSelections()}
                  onLoadScenario={(scenario) => {
                    form.reset(scenario.input);
                    setNumETFsMode("manual");
                    // Restore the saved snapshot of custom weights into the
                    // global active overrides used by Build. If the scenario
                    // has no snapshot (older save, or saved without any
                    // pinned rows), clear the active overrides so the load
                    // is a clean restore.
                    const snapshot = scenario.manualWeights;
                    if (snapshot && Object.keys(snapshot).length > 0) {
                      // Replace storage atomically: clear first to drop any
                      // pre-existing pins, then write each entry from the
                      // snapshot. The CHANGE_EVENT fired by setManualWeight
                      // re-syncs the local state via subscribeManualWeights.
                      clearAllManualWeights();
                      for (const [bucket, w] of Object.entries(snapshot)) {
                        setManualWeight(bucket, w);
                      }
                    } else {
                      clearAllManualWeights();
                    }
                    // Restore the per-bucket ETF picker selections atomically:
                    // clear first to drop pre-existing picks, then re-write
                    // each entry from the saved snapshot. Older scenarios
                    // (saved before this feature) carry no etfSelections
                    // field — those load with every bucket back at the
                    // curated default, exactly the previous behaviour.
                    clearAllETFSelections();
                    const sel = scenario.etfSelections;
                    if (sel) {
                      for (const [key, slot] of Object.entries(sel)) {
                        setETFSelection(key, slot);
                      }
                    }
                    onSubmit(scenario.input);
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
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPDF}
                    disabled={isExporting || isExportingDetailed}
                  >
                    {isExporting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {isExporting ? t("build.btn.exportingPdf") : t("build.btn.exportPdf")}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleExportDetailedPDF}
                    disabled={isExporting || isExportingDetailed}
                  >
                    {isExportingDetailed ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {isExportingDetailed
                      ? t("build.btn.exportingPdf")
                      : t("build.btn.exportPdfDetailed")}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-6 bg-background">
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
                    {/* High-level group summary on the left, donut on the right */}
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-4 items-center">
                      {output ? (
                        <AllocationGroupSummary
                          allocation={output.allocation}
                          orientation="vertical"
                        />
                      ) : (
                        <div />
                      )}
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
                                <Cell key={`cell-${index}`} fill={colorForBucket(entry.name)} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                              contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Horizontal Stacked Bar */}
                    <div className="h-4 w-full flex rounded-full overflow-hidden">
                      {chartData.map((d, i) => (
                        <div 
                          key={i} 
                          style={{ width: `${d.value}%`, backgroundColor: colorForBucket(d.name) }} 
                          title={`${d.name}: ${d.value.toFixed(1)}%`}
                          className="h-full transition-all duration-500 hover:brightness-110"
                        />
                      ))}
                    </div>

                    {/* Legend (mirrors Compare-tab layout): one row per
                     * pie slice with color swatch, label, and weight %. */}
                    <ul
                      className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs"
                      aria-label={lang === "de" ? "Legende" : "Legend"}
                      data-testid="build-allocation-legend"
                    >
                      {chartData.map((d, i) => (
                        <li key={i} className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: colorForBucket(d.name) }}
                            aria-hidden
                          />
                          <span className="truncate text-muted-foreground" title={d.name}>{d.name}</span>
                          <span className="ml-auto tabular-nums font-medium">{d.value.toFixed(1)}%</span>
                        </li>
                      ))}
                    </ul>

                    {/* Heading for the bucket table. Makes explicit that
                     * this table shows the user-selected rows — i.e. it is
                     * NOT look-through-decomposed even when the toggle is
                     * ON (in which case the pie + bar above ARE
                     * decomposed). Avoids the ambiguity an operator
                     * flagged after the look-through pie change. */}
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">
                        {lang === "de" ? "Allokation nach Bucket (deine Auswahl)" : "Allocation by bucket (your selection)"}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {watchedLookThroughView && output.etfImplementation.length > 0
                          ? (lang === "de"
                              ? "Diese Tabelle zeigt die von dir gewählten Buckets — ohne Look-Through. Pie und Balken oben sind über die ETF-Bestände zerlegt."
                              : "This table shows the buckets you picked — without look-through. The pie and bar above are decomposed via the ETF holdings.")
                          : (lang === "de"
                              ? "Die von dir gewählten Buckets. Look-Through ist aus, daher zeigen Pie, Balken und Tabelle dieselbe Sicht."
                              : "The buckets you picked. Look-through is off, so the pie, bar and table all show the same view.")}
                      </p>
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
                          {output.allocation
                            .slice()
                            .sort((a, b) => compareBuckets(
                              { name: `${a.assetClass} - ${a.region}`, value: a.weight },
                              { name: `${b.assetClass} - ${b.region}`, value: b.weight },
                            ))
                            .map((alloc, i) => (
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

                {/* Sections 4 + 6: Construction Rationale + Key Risks
                    (collapsible, open by default for first-time users; the
                    user's last open/closed choice is persisted in localStorage
                    via setBuildRationaleRisksOpen — Task #85). */}
                <Collapsible
                  open={rationaleRisksOpen}
                  onOpenChange={(open) => {
                    setRationaleRisksOpenState(open);
                    setBuildRationaleRisksOpen(open);
                  }}
                  className="space-y-3"
                >
                  <CollapsibleTrigger
                    type="button"
                    className="group flex w-full items-center justify-between gap-2 text-left"
                  >
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Info className="h-4 w-4" /> {t("build.rationaleRisks.title")}
                    </h3>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
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
                        <CardContent className="space-y-3 text-sm">
                          {output.risks.map((r, i) => (
                            <p key={i} className="leading-relaxed text-muted-foreground">{r}</p>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Section 5: ETF Implementation */}
                {(() => {
                  const renderBanner = () => {
                    const presentBuckets = new Set(output.etfImplementation.map(e => e.bucket));
                    const activeOverrides = Object.entries(manualWeights).filter(([k]) => presentBuckets.has(k));
                    const activeCount = activeOverrides.length;
                    const pinnedSum = activeOverrides.reduce((s, [, v]) => s + v, 0);
                    // Only flag as "over" — the destructive scale-down case — when the
                    // pinned sum is *strictly above* 100 (within float tolerance from
                    // accumulated 0.1-step inputs). Exactly 100% is benign: pinned rows
                    // stay as typed and non-pinned rows simply go to 0; no warning needed.
                    const over = activeCount > 0 && pinnedSum > 100 + MANUAL_WEIGHTS_SUM_EPSILON;
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
                        {over && (
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
                  };

                  const renderTable = (compact: boolean) => (
                    <div
                      className={cn(
                        "rounded-md border overflow-x-auto",
                        compact && "[&_td]:py-1 [&_td]:px-1.5 [&_th]:h-8 [&_th]:px-1.5"
                      )}
                    >
                      <Table className={compact ? "text-[11px]" : "text-xs"}>
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
                            <TableHead
                              className={cn(
                                "min-w-[220px]",
                                // Maximised view (compact): no max-width and no wrap
                                // on the comment column so long comments push the
                                // table to its natural width and the horizontal
                                // scrollbar appears when actually needed, instead
                                // of being silently suppressed by line-wrapping
                                // inside a clamped cell.
                                compact && "whitespace-nowrap",
                              )}
                            >
                              {t("build.impl.col.comment")}
                            </TableHead>
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
                              <TableCell className="font-medium">
                                {etf.catalogKey && etf.selectableOptions.length > 1 ? (
                                  <Select
                                    value={String(etf.selectedSlot)}
                                    onValueChange={(v) =>
                                      setETFSelection(etf.catalogKey!, Number(v) as ETFSlot)
                                    }
                                  >
                                    <SelectTrigger
                                      className="h-7 px-2 text-xs gap-1.5 w-auto min-w-[180px] max-w-[280px] font-medium border-dashed hover:border-solid focus:border-solid"
                                      data-testid={`etf-picker-${etf.bucket}`}
                                      title={t("build.impl.picker.label")}
                                      aria-label={`${t("build.impl.picker.label")} — ${etf.bucket}`}
                                    >
                                      <SelectValue>{etf.exampleETF}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {etf.selectableOptions.map((opt, idx) => (
                                        <SelectItem
                                          key={`${etf.catalogKey}-${idx}`}
                                          value={String(idx)}
                                          data-testid={`etf-picker-option-${etf.bucket}-${idx}`}
                                        >
                                          <div className="flex flex-col gap-0.5 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-medium text-xs">{opt.name}</span>
                                              <Badge
                                                variant={idx === 0 ? "secondary" : "outline"}
                                                className="text-[9px] px-1.5 py-0 h-4 shrink-0"
                                              >
                                                {idx === 0
                                                  ? t("build.impl.picker.default")
                                                  : `${t("build.impl.picker.alt")} ${idx}`}
                                              </Badge>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                              {opt.isin} · {(opt.terBps / 100).toFixed(2)}% {t("build.impl.picker.terSuffix")}
                                            </span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  etf.exampleETF
                                )}
                              </TableCell>
                              <TableCell className="font-mono whitespace-nowrap p-0">
                                <button
                                  type="button"
                                  onClick={() => setDetailsEtf(etf)}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 -mx-2 -my-1.5 rounded hover:bg-muted/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors text-left"
                                  data-testid={`etf-isin-button-${etf.bucket}`}
                                  title={t("build.impl.isin.openDetails")}
                                  aria-label={`${t("build.impl.isin.openDetails")} — ${etf.isin}`}
                                >
                                  <span>{etf.isin}</span>
                                  <Search className="h-3 w-3 opacity-60 shrink-0" />
                                </button>
                              </TableCell>
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
                              <TableCell
                                className={cn(
                                  "text-muted-foreground",
                                  // Default (inline) view keeps the wrap+max-width
                                  // behaviour so the card doesn't get pushed wide.
                                  // Maximised (compact) view drops both caps and
                                  // forces a single line so long comments make the
                                  // table genuinely overflow → horizontal scroll
                                  // appears as needed instead of being suppressed
                                  // by silent line-wrapping inside a clamped cell.
                                  compact
                                    ? "min-w-[220px] whitespace-nowrap"
                                    : "min-w-[220px] max-w-[320px]",
                                )}
                              >
                                {/* Curated `comment` always wins. When the catalog
                                    row left the field blank, fall back to the same
                                    auto-generated description used in ETFDetailsDialog
                                    so operators scanning the implementation table can
                                    read the per-ETF summary inline without having to
                                    click into each row's detail dialog. The
                                    "auto-generated" hint label keeps the two
                                    distinguishable at a glance. The render is
                                    delegated to <EtfImplementationCommentCell> so it
                                    can be locked in by a focused component-level
                                    vitest (see tests/etfImplementationCommentCell.test.tsx). */}
                                <EtfImplementationCommentCell etf={etf} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );

                  const renderFooter = () => {
                    // The Excel export mirrors exactly the rows the user sees
                    // in `output.etfImplementation` — including any manual
                    // weight overrides and any alt-ETF picks the user has
                    // applied — because both flow through the same engine
                    // pipeline before landing in `output`. The button is
                    // disabled (kept in the DOM, just not clickable) when
                    // there are no rows so the layout doesn't jump and the
                    // tooltip can still explain why.
                    const hasRows = output.etfImplementation.length > 0;
                    return (
                      <>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <p className="text-[10px] text-muted-foreground italic flex-1">
                            {t("build.impl.disclaimer")}
                          </p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!hasRows}
                                  onClick={() => {
                                    exportEtfImplementationXlsx(
                                      output.etfImplementation,
                                      t,
                                      lang,
                                    );
                                    toast.success(
                                      t("build.impl.export.toast"),
                                    );
                                  }}
                                  data-testid="etf-implementation-export-xlsx-button"
                                  aria-label={t("build.impl.export.button")}
                                >
                                  <Download className="h-3.5 w-3.5 mr-1.5" />
                                  {t("build.impl.export.button")}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {hasRows
                                ? t("build.impl.export.tooltip")
                                : t("build.impl.export.tooltipEmpty")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <ETFSnapshotFreshness />
                      </>
                    );
                  };

                  return (
                    <MaximisableSection
                      title={t("build.implementation.title")}
                      description={t("build.implementation.desc")}
                      maximiseLabel={t("build.implementation.maximise")}
                      maximiseHint={t("build.implementation.maximiseHint")}
                      closeLabel={t("build.implementation.minimise")}
                      dialogTitle={t("build.implementation.dialogTitle")}
                      dialogDescription={t("build.implementation.desc")}
                      testIdPrefix="etf-implementation"
                      headerExtra={
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="hidden md:inline-flex h-8 w-8"
                              disabled={!hasEtfSelections}
                              onClick={() => {
                                clearAllETFSelections();
                                toast.success(t("build.implementation.resetEtfsToast"));
                              }}
                              data-testid="etf-implementation-reset-button"
                              aria-label={t("build.implementation.resetEtfs")}
                              title={t("build.implementation.resetEtfs")}
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span className="sr-only">{t("build.implementation.resetEtfs")}</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {hasEtfSelections
                              ? t("build.implementation.resetEtfsHint")
                              : t("build.implementation.resetEtfs")}
                          </TooltipContent>
                        </Tooltip>
                      }
                      renderContent={({ compact }) => (
                        <>
                          {renderBanner()}
                          {renderTable(compact)}
                        </>
                      )}
                      renderFooter={renderFooter}
                    />
                  );
                })()}

                <ETFDetailsDialog
                  etf={detailsEtf}
                  open={!!detailsEtf}
                  onOpenChange={(o) => {
                    if (!o) setDetailsEtf(null);
                  }}
                />

                {/* Always-visible: Consolidated Currency Overview (post-hedge).
                 *  The Look-Through toggle flips the unhedged-currency split:
                 *  ON  → curated underlying currencies (e.g. World ETF → USD/EUR/JPY/...).
                 *  OFF → ETF share-class currency only (no look-through). */}
                <CurrencyOverview
                  etfs={output.etfImplementation}
                  baseCurrency={form.getValues().baseCurrency}
                  lookThroughView={form.getValues().lookThroughView}
                />

                {/* Geographic Exposure Map + Home Bias + Look-Through Analysis + Top 10 Holdings
                 *  (only when look-through view is active). Home Bias sits
                 *  directly under the geo map so the qualitative verdict
                 *  ("over/modest/under") reads as a natural follow-on to the
                 *  visual regional breakdown the user just scanned. The card
                 *  itself returns null when look-through is OFF, so nesting
                 *  it inside this block doesn't change visibility behaviour. */}
                {form.getValues().lookThroughView && (
                  <>
                    <GeoExposureMap
                      etfs={output.etfImplementation}
                      baseCurrency={form.getValues().baseCurrency}
                    />
                    {/* Home Bias (non-USD bases only — full width, collapsed
                     *  by default). USD-base portfolios skip the card because
                     *  "home" framing collapses against the global default. */}
                    {form.getValues().baseCurrency !== "USD" && (
                      <HomeBiasAnalysis
                        etfs={output.etfImplementation}
                        baseCurrency={form.getValues().baseCurrency}
                        lookThroughView={watchedLookThroughView}
                      />
                    )}
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

                {/* Monte Carlo Simulation (placed before Risk Metrics so the
                 *  forward-looking distribution frames the backward-looking
                 *  risk/return statistics that follow). */}
                <MonteCarloSimulation
                  allocation={output.allocation}
                  horizonYears={form.getValues().horizon}
                  baseCurrency={form.getValues().baseCurrency}
                  hedged={form.getValues().includeCurrencyHedging}
                  includeSyntheticETFs={form.getValues().includeSyntheticETFs}
                  etfImplementation={watchedLookThroughView ? output.etfImplementation : undefined}
                  riskRegime={riskRegime}
                  onRiskRegimeChange={setRiskRegime}
                />

                {/* Risk & Performance Metrics (Sharpe, Beta, Alpha, TE, Max DD, Frontier, Correlation) */}
                <PortfolioMetrics
                  allocation={output.allocation}
                  baseCurrency={form.getValues().baseCurrency}
                  etfImplementation={watchedLookThroughView ? output.etfImplementation : undefined}
                  includeSyntheticETFs={form.getValues().includeSyntheticETFs}
                  hedged={form.getValues().includeCurrencyHedging}
                  riskRegime={riskRegime}
                  onRiskRegimeChange={setRiskRegime}
                />

                {/* Scenario Stress Test */}
                <StressTest allocation={output.allocation} baseCurrency={watchedBaseCcy} />

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
                  etfImplementations={output.etfImplementation}
                />
              </>
            )}
            <DisclaimerPdfBlock />
            </div>

            {/* Off-screen curated one-page PDF report. The export pipeline
             *  (handleExportPDF -> exportToPdf) photographs THIS container
             *  rather than the screen-visible cards, so the resulting PDF is a
             *  banker-style single-page summary instead of a stacked
             *  screenshot of every card. Positioned off-screen so html2canvas
             *  can still measure layout, while the user never sees it. */}
            {output && validation.isValid && (
              <div
                ref={pdfRef}
                aria-hidden="true"
                style={{
                  position: "fixed",
                  left: "-99999px",
                  top: 0,
                  width: "210mm",
                  pointerEvents: "none",
                }}
              >
                <PortfolioReport
                  output={output}
                  input={form.getValues()}
                  generatedAt={new Date()}
                  riskRegime={riskRegime}
                />
              </div>
            )}

            {/* Off-screen detailed PDF report. Same off-screen pattern as the
             *  basic report above, but mounts <PortfolioReport
             *  variant="detailed" /> which adds Top 10 Holdings (always
             *  look-through), Monte Carlo summary + chart, and Fee Estimator
             *  summary. The exporter naturally paginates across two pages. */}
            {output && validation.isValid && (
              <div
                ref={pdfDetailedRef}
                aria-hidden="true"
                style={{
                  position: "fixed",
                  left: "-99999px",
                  top: 0,
                  width: "210mm",
                  pointerEvents: "none",
                }}
              >
                <PortfolioReport
                  output={output}
                  input={form.getValues()}
                  generatedAt={new Date()}
                  variant="detailed"
                  riskRegime={riskRegime}
                />
              </div>
            )}
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
  const inputRef = useRef<HTMLInputElement | null>(null);
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
    const parsed = parseManualWeightInput(draft);
    if (parsed === null) {
      // Invalid / empty input: silently revert the draft to the engine value
      // and DO NOT mutate the override. Mobile users routinely blur with the
      // input mid-edit (an iOS keyboard tap, a misfired pointerdown), and
      // wiping a pinned weight on every fumble was the worst symptom of the
      // original bug. Clearing an override is now an explicit gesture only —
      // via the × reset button or the global "Reset all" action.
      setDraft(
        isOverride && typeof pinnedValue === "number"
          ? pinnedValue.toFixed(1)
          : effective.current.toFixed(1),
      );
      return;
    }
    // No-op guard: if the typed value matches what is already in effect
    // (the pinned value on an overridden row, or the natural displayed
    // weight on a non-overridden row), don't write to storage. This avoids
    // creating phantom overrides on focus + blur with no real edit.
    const compareTo =
      isOverride && typeof pinnedValue === "number"
        ? pinnedValue
        : effective.current;
    if (Math.abs(parsed - compareTo) < 0.05) {
      setDraft(compareTo.toFixed(1));
      return;
    }
    setDraft(parsed.toFixed(1));
    setManualWeight(bucket, parsed);
  };

  // Mobile safety net: iOS Safari does not always fire `blur` before a
  // subsequent tap (e.g. the user taps "Build Portfolio" with the keyboard
  // still up). Capture-phase pointerdown lets us force the input to blur
  // before the next React handler runs, which routes through onBlur → commit.
  // Listener is only attached while the input is focused so it has zero cost
  // the rest of the time.
  useEffect(() => {
    if (!focused) return;
    const handler = (e: PointerEvent) => {
      const node = inputRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && node.contains(target)) return;
      node.blur();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [focused]);

  return (
    <div className="inline-flex items-center justify-end gap-1">
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
        onFocus={(e) => {
          setFocused(true);
          // Select-all so a single tap lets the user retype the value
          // without first having to delete the existing digits — much more
          // forgiving on a phone keyboard.
          e.currentTarget.select();
        }}
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
        className={`h-8 w-[72px] px-1.5 text-right font-mono text-xs sm:h-7 sm:w-16 ${isOverride ? "border-primary/60" : ""}`}
        data-testid={`weight-input-${bucket}`}
      />
      <span className="text-muted-foreground text-xs select-none">%</span>
      {isOverride ? (
        <button
          type="button"
          onClick={() => clearManualWeight(bucket)}
          aria-label={resetTitle}
          className="text-muted-foreground hover:text-foreground rounded inline-flex items-center justify-center h-8 w-8 sm:h-5 sm:w-5"
          data-testid={`weight-reset-${bucket}`}
        >
          <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" aria-hidden="true" />
          <span className="sr-only">{resetTitle}</span>
        </button>
      ) : (
        <span className="w-8 sm:w-5" />
      )}
    </div>
  );
}
