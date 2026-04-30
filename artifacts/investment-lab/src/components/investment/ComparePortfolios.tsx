import { useState, useRef, useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Scale, ShieldAlert, Target, Link2, PinOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { SavedScenariosUI } from "./SavedScenariosUI";
import { GeoExposureMap } from "./GeoExposureMap";
import { AllocationGroupSummary } from "./AllocationGroupSummary";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { InfoHint } from "@/components/ui/info-hint";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio } from "@/lib/portfolio";
import { mapAllocationToAssetsLookthrough, CMA } from "@/lib/metrics";
import { colorForBucket, compareBuckets } from "@/lib/chartColors";
import { defaultExchangeFor } from "@/lib/exchange";
import { diffPortfolios } from "@/lib/compare";
import type { ManualWeights } from "@/lib/manualWeights";
import { getAllETFSelections, type ETFSlot } from "@/lib/etfSelection";
import {
  getLastBuildInput,
  getLastBuildManualWeights,
  subscribeLastBuildInput,
  subscribeLastBuildManualWeights,
} from "@/lib/settings";
import { PortfolioMetrics } from "./PortfolioMetrics";
import { StressTest } from "./StressTest";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import type { RiskRegime } from "@/lib/metrics";
import { FeeEstimator, formatThousandsLive } from "./FeeEstimator";
import { CurrencyOverview } from "./CurrencyOverview";
import { LookThroughAnalysis } from "./LookThroughAnalysis";
import { TopHoldings } from "./TopHoldings";
import { EtfImplementationReadOnly } from "./EtfImplementationReadOnly";
import { ETFDetailsDialog } from "./ETFDetailsDialog";
import type { ETFImplementation } from "@/lib/types";
import { estimateFees } from "@/lib/fees";
import { parseDecimalInput } from "@/lib/manualWeights";
import { useT } from "@/lib/i18n";

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
  const { lang, t } = useT();
  const tr = (en: string, de: string) => (lang === "de" ? de : en);
  const form = useForm<CompareFormValues>({
    defaultValues,
  });

  // Link state: when true, Slot A mirrors whatever the user has currently
  // configured on the Build tab (form values + manual weights snapshot).
  // Default-on if Build has already published anything by mount time, so the
  // first arrival on Compare from a populated Build state is "already linked".
  // Auto-detaches (sets to false) when the user makes any edit to a portA
  // field or loads a saved scenario into Slot A — those are explicit signals
  // that Slot A should diverge from Build.
  // Declared here (before effects below depend on it) so the effects can
  // close over the latest value via the dep array.
  const [linked, setLinked] = useState<boolean>(() => getLastBuildInput() !== null);
  // Tracks whether Build has ever published. Drives whether we render the
  // "Linked / Re-link" badge at all (no point showing it on a fresh page
  // load where Build has never been visited).
  const [hasBuildPublished, setHasBuildPublished] = useState<boolean>(
    () => getLastBuildInput() !== null,
  );
  // Ref flag set to true during programmatic setValue calls driven by the
  // linked-sync effect, so the auto-pin watcher can distinguish user-driven
  // edits from our own mirror updates. Synchronous toggle is sufficient
  // because react-hook-form's watch fires synchronously inside setValue.
  const syncingRef = useRef(false);

  // Tracks whether we've made the initial link decision yet. Both
  // BuildPortfolio and ComparePortfolios are forceMount'ed by their parent
  // <Tabs>, so on the very first render Compare's useState(() => …) above
  // runs BEFORE Build's publish-on-mount useEffect — meaning the initial
  // `linked` and `hasBuildPublished` reads return false even though Build
  // is about to publish a moment later. This ref lets the subscribe-effect
  // below flip both flags on first observed publication exactly once,
  // preserving "default-on" semantics. User interaction with the
  // pin / re-link buttons clears this so Build publications never
  // surprise-re-link Slot A after the user has explicitly chosen.
  const initialLinkPendingRef = useRef(true);

  // ---- Linked-to-Build sync (Slot A only) ----
  // On mount and on every Build publication, mirror Build's PortfolioInput
  // into form.portA and Build's manual weights snapshot into manualWeightsA
  // — but only while linked is true. The syncingRef guard tells the
  // auto-pin watcher (further below) that the resulting setValue/state
  // changes were ours, not the user's, so we don't immediately self-detach.
  useEffect(() => {
    // Catch the case where Build's mount-time publish landed AFTER our
    // useState() initializers ran (forceMount sibling timing — see the
    // initialLinkPendingRef comment above). On the first render where Build
    // has any value, flip both flags to true and apply the initial mirror.
    // This block intentionally runs every time the effect re-fires; the
    // initialLinkPendingRef guard keeps it idempotent and ensures we only
    // auto-link once.
    const bootstrap = getLastBuildInput();
    if (bootstrap && initialLinkPendingRef.current) {
      initialLinkPendingRef.current = false;
      if (!hasBuildPublished) setHasBuildPublished(true);
      if (!linked) setLinked(true);
    }

    // Initial pull on mount (or whenever `linked` flips back to true via
    // the Re-link button).
    if (linked) {
      const initial = getLastBuildInput() as PortfolioInput | null;
      if (initial) {
        syncingRef.current = true;
        // Backfill `lookThroughView` to `true` defensively if a stale
        // Build snapshot lacks the field — the per-slot toggle in
        // Compare must default ON.
        form.setValue(
          "portA",
          { ...initial, lookThroughView: initial.lookThroughView ?? true },
          { shouldDirty: false, shouldValidate: false },
        );
        syncingRef.current = false;
      }
      const initialMW = getLastBuildManualWeights();
      setManualWeightsA(initialMW && Object.keys(initialMW).length > 0 ? { ...initialMW } : undefined);
      // Re-link drops any per-slot picker snapshot so Slot A falls back to
      // the global store the Build tab is reading from — same picks as Build.
      setEtfSelectionsA(undefined);
    }
    const unsubInput = subscribeLastBuildInput((input) => {
      // Track first publication so the badge can render.
      if (input) {
        setHasBuildPublished(true);
        // Honour "default-on" if Build publishes for the first time AFTER
        // we mounted (rather than before): auto-link Slot A exactly once,
        // unless the user has already touched the pin / re-link controls.
        if (initialLinkPendingRef.current) {
          initialLinkPendingRef.current = false;
          setLinked(true);
        }
      }
      if (!linked || !input) return;
      syncingRef.current = true;
      const safe = input as unknown as PortfolioInput;
      form.setValue(
        "portA",
        { ...safe, lookThroughView: safe.lookThroughView ?? true },
        { shouldDirty: false, shouldValidate: false },
      );
      syncingRef.current = false;
    });
    const unsubMW = subscribeLastBuildManualWeights((w) => {
      if (!linked) return;
      setManualWeightsA(w && Object.keys(w).length > 0 ? { ...w } : undefined);
    });
    return () => {
      unsubInput();
      unsubMW();
    };
  }, [linked, form]);

  // Auto-pin / auto-detach on first user edit to portA. Loading a saved
  // scenario into Slot A also detaches, but does so explicitly in the
  // load handler — this watcher only catches in-form edits.
  useEffect(() => {
    const sub = form.watch((_value, info) => {
      if (!linked) return;
      if (syncingRef.current) return;
      const name = info?.name;
      if (!name || !name.startsWith("portA.")) return;
      initialLinkPendingRef.current = false;
      setLinked(false);
      toast.info(t("compare.slotA.unlinkToast"));
    });
    return () => sub.unsubscribe();
  }, [linked, form, t]);

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
  // Per-slot snapshots of custom (pinned) ETF weights. Populated when the
  // user loads a saved portfolio that carries a snapshot; passed to the
  // engine so each slot's pinned values and "Custom" badges show up just
  // like in Build today. The Compare tab itself does not provide UI to
  // author custom weights — they are authored in Build and travel via
  // save / load.
  const [manualWeightsA, setManualWeightsA] = useState<ManualWeights | undefined>(undefined);
  const [manualWeightsB, setManualWeightsB] = useState<ManualWeights | undefined>(undefined);
  // Per-slot ETF picker snapshots. Undefined = "fall back to the global
  // selection store" (the same store the Build tab is mutating today). A
  // defined map = "use exactly this snapshot for the slot", which is what
  // a saved-scenario load installs so the two slots can diverge cleanly.
  // Without this split, both slots historically shared the global store
  // and would silently disagree with the saved scenario data for at least
  // one slot.
  const [etfSelectionsA, setEtfSelectionsA] = useState<Record<string, ETFSlot> | undefined>(undefined);
  const [etfSelectionsB, setEtfSelectionsB] = useState<Record<string, ETFSlot> | undefined>(undefined);

  const [hasGenerated, setHasGenerated] = useState(false);
  // Shared Crisis-Σ toggles (Task #99). Per-side state so each portfolio's
  // Monte Carlo + Risk-&-Performance tiles stay in lockstep — and both the
  // mobile A/B-tabbed instances and the desktop side-by-side instances
  // reuse the same value, so flipping the regime in one location moves
  // every linked tile for that side. Defaults to "normal" so existing
  // baselines stay byte-identical.
  const [riskRegimeA, setRiskRegimeA] = useState<RiskRegime>("normal");
  const [riskRegimeB, setRiskRegimeB] = useState<RiskRegime>("normal");
  const resultsRef = useRef<HTMLDivElement>(null);

  // Lifted Fee Estimator amount draft for Portfolio A. Owning this here
  // (instead of letting each FeeEstimator keep its own internal state) lets
  // us
  //   - share the same value across the desktop and mobile-Tabs A
  //     instances of the Fee Estimator (otherwise switching viewports would
  //     flash a different number), and
  //   - feed the actual user-entered amount into the "Portfolio X is N bps
  //     cheaper — about CHF Y / year on CHF Z" delta sentence so the
  //     reference figure matches what's typed in Portfolio A's input.
  // Seeded already-formatted to match what FeeEstimator displays on first
  // render (avoids a 100000 → 100'000 jump on the very first keystroke).
  const [portAFeeAmountDraft, setPortAFeeAmountDraft] = useState<string>(() =>
    formatThousandsLive("100000"),
  );

  // ETFDetailsDialog state for the read-only ETF Implementation table on
  // Compare. Both Slot A and Slot B share a single dialog instance — only
  // one row can be inspected at a time.
  const [detailsEtf, setDetailsEtf] = useState<ETFImplementation | null>(null);
  // Numeric value for the delta calc. Strip thousand separators (Swiss
  // apostrophes, spaces, legacy commas) before parseDecimalInput, same
  // convention as FeeEstimator's own derivation.
  const portAFeeAmount = (() => {
    const cleaned = portAFeeAmountDraft.replace(/[\s',\u2019]/g, "");
    return parseDecimalInput(cleaned, { min: 0 }) ?? 0;
  })();

  const parseSide = (p: PortfolioInput): PortfolioInput => ({
    ...p,
    horizon: Number(p.horizon),
    targetEquityPct: Number(p.targetEquityPct),
    numETFs: Number(p.numETFs),
    numETFsMin: Number(p.numETFsMin ?? p.numETFs),
  });

  // In Compare the user cannot adjust the ETF max-cap (control was removed),
  // so the "High complexity" warning is not actionable here. Suppress it; the
  // Build tab still surfaces it where the user can react to it.
  const stripComplexity = (v: ValidationResult): ValidationResult => ({
    ...v,
    warnings: v.warnings.filter(
      (w) => w.message !== "High complexity (Complexity Risk)." &&
             w.message !== "Hohe Komplexität (Komplexitätsrisiko).",
    ),
  });

  // Per-side rebuild used by the Look-Through toggle so toggling that
  // side's switch immediately re-runs that side's portfolio (refreshing
  // the captured `inputA`/`inputB` value the gating predicates read)
  // without re-running the other slot or re-scrolling the page.
  // Only re-runs if the side has already been generated at least once.
  const rebuildSide = (prefix: "portA" | "portB") => {
    const v = form.getValues()[prefix];
    const parsed = parseSide(v);
    const val = runValidation(parsed);
    if (prefix === "portA") {
      // Skip if Slot A has not been generated yet — toggling before
      // pressing Compare should just update the form value, not
      // generate output out of nowhere.
      if (!outputA && !inputA) return;
      setValidationA(stripComplexity(val));
      if (val.isValid) {
        setOutputA(buildPortfolio(parsed, "en", manualWeightsA, etfSelectionsA));
        setInputA(parsed);
      } else {
        setOutputA(null);
        setInputA(null);
      }
    } else {
      if (!outputB && !inputB) return;
      const etfSelectionsBForBuild = etfSelectionsB ?? {};
      setValidationB(stripComplexity(val));
      if (val.isValid) {
        setOutputB(buildPortfolio(parsed, "en", manualWeightsB, etfSelectionsBForBuild));
        setInputB(parsed);
      } else {
        setOutputB(null);
        setInputB(null);
      }
    }
  };

  const onSubmit = (data: CompareFormValues) => {
    const parsedA = parseSide(data.portA);
    const parsedB = parseSide(data.portB);

    const valA = runValidation(parsedA);
    const valB = runValidation(parsedB);
    setValidationA(stripComplexity(valA));
    setValidationB(stripComplexity(valB));

    if (valA.isValid) { setOutputA(buildPortfolio(parsedA, "en", manualWeightsA, etfSelectionsA)); setInputA(parsedA); }
    else { setOutputA(null); setInputA(null); }

    // Slot B contract (Task #78): Portfolio B is a clean default-only
    // baseline unless a saved scenario has explicitly been loaded into
    // it. When `etfSelectionsB` is undefined (no scenario loaded), pass
    // an empty map instead of letting the engine fall back to the
    // global ETF picker store the Build tab writes to — otherwise
    // Build's per-bucket picks would silently leak into Slot B. The
    // saved-scenario load path (onLoadB below) already installs a
    // concrete map (or `{}` for older saves), so this fallback only
    // affects the never-loaded case.
    const etfSelectionsBForBuild = etfSelectionsB ?? {};
    if (valB.isValid) { setOutputB(buildPortfolio(parsedB, "en", manualWeightsB, etfSelectionsBForBuild)); setInputB(parsedB); }
    else { setOutputB(null); setInputB(null); }

    setHasGenerated(true);

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  // When Look-Through is ON for a portfolio (per-portfolio toggle, mirrors
  // BuildPortfolio behavior), decompose the pie into the underlying country
  // buckets via the actual ETF holdings. Otherwise use the row-level buckets.
  const buildChartData = (
    out: PortfolioOutput | null,
    input: PortfolioInput | null,
  ): { name: string; value: number }[] => {
    if (!out) return [];
    const base = out.allocation.map(a => ({
      name: `${a.assetClass} - ${a.region}`,
      value: a.weight,
    }));
    if (!input || !input.lookThroughView || out.etfImplementation.length === 0) {
      return base.slice().sort(compareBuckets);
    }
    const lt = mapAllocationToAssetsLookthrough(
      out.allocation,
      out.etfImplementation,
      input.baseCurrency,
    );
    return lt
      .filter(e => e.weight > 0)
      .map(e => ({ name: CMA[e.key].label, value: e.weight * 100 }))
      .sort(compareBuckets);
  };
  const chartDataA = buildChartData(outputA, inputA);
  const chartDataB = buildChartData(outputB, inputB);

  const diff = (outputA && outputB) ? diffPortfolios(outputA, outputB) : null;

  const renderFormColumn = (prefix: "portA" | "portB", title: string) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-xl">{title}</CardTitle>
          {prefix === "portA" && hasBuildPublished && (
            <div className="flex items-center gap-1.5" data-testid="compare-slot-a-link-controls">
              {linked ? (
                <>
                  <Badge variant="secondary" className="gap-1 h-6 font-normal" data-testid="compare-slot-a-linked-badge">
                    <Link2 className="h-3 w-3" />
                    {t("compare.slotA.linked")}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          initialLinkPendingRef.current = false;
                          setLinked(false);
                          toast.info(t("compare.slotA.unlinkToast"));
                        }}
                        aria-label={t("compare.slotA.linkedHint")}
                        data-testid="compare-slot-a-unpin-button"
                      >
                        <PinOff className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{t("compare.slotA.linkedHint")}</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    initialLinkPendingRef.current = false;
                    setLinked(true);
                  }}
                  data-testid="compare-slot-a-relink-button"
                >
                  <Link2 className="h-3 w-3" />
                  {t("compare.slotA.relink")}
                </Button>
              )}
            </div>
          )}
        </div>
        {prefix === "portA" && hasBuildPublished && linked && (
          <p
            className="mt-2 text-xs text-muted-foreground italic"
            data-testid="compare-slot-a-linked-statement"
          >
            {t("compare.slotA.linkedStatement")}
          </p>
        )}
        {/* Slot B helper (Task #78): mirror Slot A's linked-statement
            visibility — only show this hint when A is currently
            displaying its "this is your Build portfolio" statement, so
            the two sentences appear as a paired explanation of the
            Compare layout. The check `hasBuildPublished && linked`
            matches Slot A's render condition above. */}
        {prefix === "portB" && hasBuildPublished && linked && (
          <p
            className="mt-2 text-xs text-muted-foreground italic"
            data-testid="compare-slot-b-defaults-statement"
          >
            {t("compare.slotB.defaultsStatement")}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name={`${prefix}.baseCurrency`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5">
                  <span>{tr("Base Currency", "Basiswährung")}</span>
                  <InfoHint iconClassName="h-3 w-3">{t("build.baseCurrency.tooltip")}</InfoHint>
                </FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder={tr("Currency", "Währung")} /></SelectTrigger>
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
                <FormLabel className="flex items-center gap-1.5">
                  <span>{tr("Horizon (Years)", "Horizont (Jahre)")}</span>
                  <InfoHint iconClassName="h-3 w-3">{t("build.horizon.tooltip")}</InfoHint>
                </FormLabel>
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
              <FormLabel className="flex items-center gap-1.5">
                <span>{tr("Risk Appetite", "Risikobereitschaft")}</span>
                <InfoHint iconClassName="h-3 w-3">{t("build.riskAppetite.tooltip")}</InfoHint>
              </FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={(val) => {
                    field.onChange(val);
                    // Mirror the Build tab: when the user changes Risk Appetite,
                    // jump the Target Equity Allocation slider to the canonical
                    // anchor for that risk band so the two inputs stay coherent.
                    const map: Record<string, number> = {
                      Low: 20,
                      Moderate: 40,
                      High: 60,
                      "Very High": 80,
                    };
                    if (map[val] !== undefined) {
                      form.setValue(`${prefix}.targetEquityPct`, map[val], {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                  value={field.value}
                  className="grid grid-cols-2 gap-2"
                >
                  {(["Low", "Moderate", "High", "Very High"] as const).map((risk) => {
                    const label = lang === "de"
                      ? ({ Low: "Niedrig", Moderate: "Moderat", High: "Hoch", "Very High": "Sehr hoch" } as const)[risk]
                      : risk;
                    return (
                      <FormItem key={risk} className="flex items-center space-x-2 space-y-0 rounded-md border p-2">
                        <FormControl><RadioGroupItem value={risk} /></FormControl>
                        <FormLabel className="font-normal cursor-pointer w-full text-xs">{label}</FormLabel>
                      </FormItem>
                    );
                  })}
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
                <span className="flex items-center gap-1.5">
                  <span>{tr("Target Equity Allocation", "Aktien-Zielallokation")}</span>
                  <InfoHint iconClassName="h-3 w-3">{t("build.targetEquity.tooltip")}</InfoHint>
                </span>
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

        <FormField
          control={form.control}
          name={`${prefix}.thematicPreference`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-1.5">
                <span>{tr("Thematic Tilt", "Thematischer Tilt")}</span>
                <InfoHint iconClassName="h-3 w-3">{t("build.thematicTilt.tooltip")}</InfoHint>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder={tr("Theme", "Thema")} /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="None">{tr("None", "Keine")}</SelectItem>
                  <SelectItem value="Technology">{tr("Technology", "Technologie")}</SelectItem>
                  <SelectItem value="Healthcare">{tr("Healthcare", "Gesundheit")}</SelectItem>
                  <SelectItem value="Sustainability">{tr("Sustainability", "Nachhaltigkeit")}</SelectItem>
                  <SelectItem value="Cybersecurity">{tr("Cybersecurity", "Cybersicherheit")}</SelectItem>
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
                  <FormLabel>{tr("Currency Hedging", "Währungsabsicherung")}</FormLabel>
                  <FormDescription className="text-xs">{tr("Hedge foreign exposure", "Fremdwährungsengagement absichern")}</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
          {/* Per-slot Look-Through toggle. Mirrors Build's switch (same
           *  label / description keys so EN+DE stay aligned). When OFF for a
           *  side, all look-through-derived sections (Geographic Exposure,
           *  Look-Through Analysis, Top 10 Holdings) hide for that side and
           *  PortfolioMetrics falls back to bucket-level routing — same
           *  behaviour as Build. We additionally re-run that side's
           *  portfolio on toggle so `inputA`/`inputB` (which the gating
           *  predicates read) reflect the new toggle without requiring the
           *  user to press "Compare Portfolios" again. */}
          <FormField
            control={form.control}
            name={`${prefix}.lookThroughView`}
            render={({ field }) => (
              <FormItem
                className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"
                data-testid={`compare-${prefix === "portA" ? "a" : "b"}-lookthrough-toggle`}
              >
                <div className="space-y-0.5">
                  <FormLabel>{t("build.lookThrough.label")}</FormLabel>
                  <FormDescription className="text-xs">{t("build.lookThrough.desc")}</FormDescription>
                </div>
                <FormControl>
                  <Switch
                    data-testid={`compare-${prefix === "portA" ? "a" : "b"}-lookthrough-switch`}
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      // Defer to next microtask so RHF has the new value
                      // before we read it via getValues() inside rebuildSide.
                      queueMicrotask(() => rebuildSide(prefix));
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3 pt-2 border-t">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            {tr("Satellite Asset Classes", "Satelliten-Anlageklassen")}
          </h4>
          <FormField
            control={form.control}
            name={`${prefix}.includeCommodities`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FormLabel>{tr("Commodities (Gold)", "Rohstoffe (Gold)")}</FormLabel>
                  <FormDescription className="text-xs">{tr("Add a gold sleeve as inflation/crisis diversifier", "Gold als Inflations- und Krisendiversifikator")}</FormDescription>
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
                  <FormLabel>{tr("Listed Real Estate", "Börsennotierte Immobilien")}</FormLabel>
                  <FormDescription className="text-xs">{tr("Add a REIT allocation", "REIT-Allokation hinzufügen")}</FormDescription>
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
                  <FormLabel>{tr("Include Crypto", "Krypto einbeziehen")}</FormLabel>
                  <FormDescription className="text-xs">{tr("Add a small digital asset allocation", "Kleine Allokation in digitale Vermögenswerte")}</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );

  // Reusable per-side gating for look-through-derived panels
  // (Geographic Exposure, Look-Through Analysis, Top 10 Holdings).
  // - When both sides have lookThroughView OFF: returns null so the
  //   surrounding wrapper (the inputA/inputB && (showA || showB) check
  //   on the call site) hides the entire section, including any Card
  //   chrome. No "Look-through is off for Portfolio X" placeholder.
  // - When only one side is OFF: desktop drops the hidden side's column
  //   and renders the visible side at full width; mobile renders the
  //   visible side directly without an A/B Tabs control so the user
  //   can't land on an empty tab.
  // - When both sides are ON: classic side-by-side desktop / A-B mobile
  //   tabs layout, identical to the previous behaviour.
  const renderLookThroughSection = (
    showA: boolean,
    showB: boolean,
    renderForSide: (side: "A" | "B") => ReactNode,
    mobileTestId: string,
  ) => {
    if (!showA && !showB) return null;
    const sideHeading = (label: string) => (
      <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
        {label}
      </h3>
    );
    return (
      <>
        {/* Mobile */}
        <div className="md:hidden">
          {showA && showB ? (
            <Tabs defaultValue="A" className="w-full" data-testid={mobileTestId}>
              <TabsList className="grid w-full max-w-xs grid-cols-2">
                <TabsTrigger value="A">Portfolio A</TabsTrigger>
                <TabsTrigger value="B">Portfolio B</TabsTrigger>
              </TabsList>
              <TabsContent value="A" className="mt-4 min-w-0">
                {sideHeading("Portfolio A")}
                {renderForSide("A")}
              </TabsContent>
              <TabsContent value="B" className="mt-4 min-w-0">
                {sideHeading("Portfolio B")}
                {renderForSide("B")}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="min-w-0">
              {sideHeading(`Portfolio ${showA ? "A" : "B"}`)}
              {renderForSide(showA ? "A" : "B")}
            </div>
          )}
        </div>
        {/* Desktop. When only one side is visible, the visible side is
         *  rendered as a single full-width column (no empty placeholder
         *  on the hidden side) — feels cleaner than an empty grid cell.
         *  When both are visible, classic two-column grid. */}
        {showA && showB ? (
          <div className="hidden md:grid md:grid-cols-2 md:gap-6">
            <div className="min-w-0">
              {sideHeading("Portfolio A")}
              {renderForSide("A")}
            </div>
            <div className="min-w-0">
              {sideHeading("Portfolio B")}
              {renderForSide("B")}
            </div>
          </div>
        ) : (
          <div className="hidden md:block min-w-0">
            {sideHeading(`Portfolio ${showA ? "A" : "B"}`)}
            {renderForSide(showA ? "A" : "B")}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-8 pb-12">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {renderFormColumn("portA", "Portfolio A")}
            {renderFormColumn("portB", "Portfolio B")}
          </div>

          <div className="flex flex-col items-center gap-3">
            <Button type="submit" size="lg" className="w-full max-w-md gap-2">
              <Scale className="h-5 w-5" /> {tr("Compare Portfolios", "Portfolios vergleichen")}
            </Button>
            <SavedScenariosUI
              compareSlots={{
                getInputA: () => {
                  const v = form.getValues().portA;
                  return {
                    ...v,
                    horizon: Number(v.horizon),
                    targetEquityPct: Number(v.targetEquityPct),
                    numETFs: Number(v.numETFs),
                    numETFsMin: Number(v.numETFsMin ?? v.numETFs),
                  };
                },
                getInputB: () => {
                  const v = form.getValues().portB;
                  return {
                    ...v,
                    horizon: Number(v.horizon),
                    targetEquityPct: Number(v.targetEquityPct),
                    numETFs: Number(v.numETFs),
                    numETFsMin: Number(v.numETFsMin ?? v.numETFs),
                  };
                },
                getSnapshotA: () => manualWeightsA,
                getSnapshotB: () => manualWeightsB,
                // Per-slot picker snapshot resolution mirrors the engine's
                // own resolution chain inside getETFDetails: per-slot map if
                // defined, else fall back to the global store. So saving a
                // linked / un-loaded slot captures Build's current picks.
                getEtfSelectionsA: () => etfSelectionsA ?? getAllETFSelections(),
                getEtfSelectionsB: () => etfSelectionsB ?? getAllETFSelections(),
                onLoadA: (scenario) => {
                  // Loading a saved scenario into Slot A is an explicit
                  // "this slot should diverge from Build" signal — detach
                  // before applying the load so the link sync doesn't
                  // immediately overwrite the loaded values on the next
                  // Build publication. Also clear initialLinkPendingRef so
                  // a future Build publish doesn't surprise-re-link.
                  initialLinkPendingRef.current = false;
                  if (linked) {
                    setLinked(false);
                  }
                  // Use syncingRef so the auto-pin watcher doesn't fire a
                  // second toast on top of the load toast (defensive — we
                  // already set linked=false above, but a stale watcher
                  // could still see linked=true in this same tick).
                  syncingRef.current = true;
                  // Backfill `lookThroughView` to `true` for older saved
                  // scenarios that don't carry the field — the per-slot
                  // toggle in Compare must default ON.
                  form.setValue(
                    "portA",
                    { ...scenario.input, lookThroughView: scenario.input.lookThroughView ?? true },
                    { shouldDirty: true, shouldValidate: false },
                  );
                  syncingRef.current = false;
                  // Replace slot A's snapshot with the saved entry's (or
                  // clear it when the saved entry has none) so the next
                  // Generate call honours the saved custom weights for A
                  // without leaking into B.
                  setManualWeightsA(
                    scenario.manualWeights && Object.keys(scenario.manualWeights).length > 0
                      ? { ...scenario.manualWeights }
                      : undefined,
                  );
                  // Per-slot ETF picker snapshot: install the saved map so
                  // Slot A reflects the saved picks even when Build's
                  // global store has different selections. Empty / missing
                  // snapshot installs an empty map (which means "use the
                  // default for every bucket") rather than undefined, so
                  // older saves are restored as a clean default state and
                  // don't leak Build's current picks into Slot A.
                  setEtfSelectionsA(
                    scenario.etfSelections ? { ...scenario.etfSelections } : {},
                  );
                  toast.success(lang === "de" ? "In Portfolio A geladen" : "Loaded into Portfolio A");
                },
                onLoadB: (scenario) => {
                  // Backfill `lookThroughView` to `true` for older saved
                  // scenarios that don't carry the field — the per-slot
                  // toggle in Compare must default ON.
                  form.setValue(
                    "portB",
                    { ...scenario.input, lookThroughView: scenario.input.lookThroughView ?? true },
                    { shouldDirty: true, shouldValidate: false },
                  );
                  setManualWeightsB(
                    scenario.manualWeights && Object.keys(scenario.manualWeights).length > 0
                      ? { ...scenario.manualWeights }
                      : undefined,
                  );
                  setEtfSelectionsB(
                    scenario.etfSelections ? { ...scenario.etfSelections } : {},
                  );
                  toast.success(lang === "de" ? "In Portfolio B geladen" : "Loaded into Portfolio B");
                },
                hasGeneratedA: !!outputA,
                hasGeneratedB: !!outputB,
              }}
            />
          </div>
        </form>
      </Form>

      <div ref={resultsRef} className="pt-8">
        {!hasGenerated ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
            <Scale className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">{lang === "de" ? "Konfigurieren und Vergleichen" : "Configure and Compare"}</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              {lang === "de"
                ? "Konfigurieren Sie oben beide Portfolios und vergleichen Sie ihre strukturellen Allokationsunterschiede nebeneinander."
                : "Setup both portfolios above and compare their structural allocation differences side by side."}
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
                    <AlertTitle>{tr("Portfolio A Errors", "Portfolio A – Fehler")}</AlertTitle>
                    <AlertDescription>{validationA.errors[0].message}</AlertDescription>
                  </Alert>
                ) : validationA?.warnings.length ? (
                  <Alert className="border-warning text-warning-foreground bg-warning/10">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>{tr("Portfolio A Warnings", "Portfolio A – Warnungen")} ({validationA.warnings.length})</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-2 space-y-2 text-sm">
                        {validationA.warnings.map((warn, i) => (
                          <li key={i}>
                            <span className="font-medium text-foreground">{warn.message}</span>
                            {warn.suggestion && (<><br /><span className="text-foreground/80">{warn.suggestion}</span></>)}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : validationA?.isValid && (
                  <Alert className="border-primary/20 bg-primary/5 text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>{tr("Portfolio A Valid", "Portfolio A – gültig")}</AlertTitle>
                  </Alert>
                )}
              </div>
              <div>
                {validationB?.errors.length ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{tr("Portfolio B Errors", "Portfolio B – Fehler")}</AlertTitle>
                    <AlertDescription>{validationB.errors[0].message}</AlertDescription>
                  </Alert>
                ) : validationB?.warnings.length ? (
                  <Alert className="border-warning text-warning-foreground bg-warning/10">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>{tr("Portfolio B Warnings", "Portfolio B – Warnungen")} ({validationB.warnings.length})</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-2 space-y-2 text-sm">
                        {validationB.warnings.map((warn, i) => (
                          <li key={i}>
                            <span className="font-medium text-foreground">{warn.message}</span>
                            {warn.suggestion && (<><br /><span className="text-foreground/80">{warn.suggestion}</span></>)}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : validationB?.isValid && (
                  <Alert className="border-primary/20 bg-primary/5 text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>{tr("Portfolio B Valid", "Portfolio B – gültig")}</AlertTitle>
                  </Alert>
                )}
              </div>
            </div>

            {outputA && outputB && diff && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                {/* Structural Differences */}
                <Card>
                  <CardHeader>
                    <CardTitle>{tr("Structural Differences", "Strukturelle Unterschiede")}</CardTitle>
                    <CardDescription>{tr("Direct allocation delta between A and B", "Direkte Allokationsdifferenz zwischen A und B")}</CardDescription>
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
                            <TableHead>{tr("Asset Class / Region", "Anlageklasse / Region")}</TableHead>
                            <TableHead className="text-right">Portfolio A %</TableHead>
                            <TableHead className="text-right">Portfolio B %</TableHead>
                            <TableHead className="text-right">Δ (B − A)</TableHead>
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

                {/* Side by side allocation cards.
                 *  Mobile: per-section A/B toggle (one card visible at a time).
                 *  Desktop (md+): both cards side-by-side. */}
                {(() => {
                  const allocCards = [
                    { title: tr("Portfolio A Allocation", "Allokation Portfolio A"), data: chartDataA, slot: "A" as const, allocation: outputA?.allocation ?? [] },
                    { title: tr("Portfolio B Allocation", "Allokation Portfolio B"), data: chartDataB, slot: "B" as const, allocation: outputB?.allocation ?? [] },
                  ] as const;

                  const renderAllocCard = (item: (typeof allocCards)[number]) => (
                    <Card key={item.title}>
                      <CardHeader>
                        <CardTitle>{item.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {/* High-level group summary on the left, donut on the right */}
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-4 items-center">
                          {item.allocation.length > 0 ? (
                            <AllocationGroupSummary
                              allocation={item.allocation}
                              testIdPrefix={`portfolio-${item.slot}`}
                              orientation="vertical"
                            />
                          ) : (
                            <div />
                          )}
                          <div className="h-[250px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={item.data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                                  {item.data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={colorForBucket(entry.name)} />
                                  ))}
                                </Pie>
                                <RechartsTooltip formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="h-4 w-full flex rounded-full overflow-hidden mt-4">
                          {item.data.map((d, i) => (
                            <div key={i} style={{ width: `${d.value}%`, backgroundColor: colorForBucket(d.name) }} title={`${d.name}: ${d.value.toFixed(1)}%`} className="h-full" />
                          ))}
                        </div>
                        <ul
                          className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs"
                          aria-label={lang === "de" ? "Legende" : "Legend"}
                          data-testid={`legend-${item.slot}`}
                        >
                          {item.data.map((d, i) => (
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
                      </CardContent>
                    </Card>
                  );

                  return (
                    <>
                      {/* Mobile: A/B toggle */}
                      <div className="md:hidden">
                        <Tabs defaultValue="A" className="w-full" data-testid="alloc-mobile-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4">{renderAllocCard(allocCards[0])}</TabsContent>
                          <TabsContent value="B" className="mt-4">{renderAllocCard(allocCards[1])}</TabsContent>
                        </Tabs>
                      </div>
                      {/* Desktop: side-by-side */}
                      <div className="hidden md:grid md:grid-cols-2 md:gap-8">
                        {allocCards.map(renderAllocCard)}
                      </div>
                    </>
                  );
                })()}

                {/* Geographic Exposure Map — gated per side on
                 *  lookThroughView. Hidden entirely when both sides are OFF;
                 *  collapses cleanly to a single column when only one side
                 *  is OFF. Matches Build's behaviour. The outer wrapper
                 *  carries a testid so e2e tests can scope to this
                 *  section (the Build tab also renders a GeoExposureMap
                 *  via forceMount, so a page-wide title query would
                 *  otherwise pick that up too). */}
                {inputA && inputB && outputA && outputB &&
                  (inputA.lookThroughView || inputB.lookThroughView) && (
                    <div data-testid="compare-geo-section">
                      {renderLookThroughSection(
                        inputA.lookThroughView,
                        inputB.lookThroughView,
                        (side) => (
                          <GeoExposureMap
                            etfs={(side === "A" ? outputA : outputB).etfImplementation}
                            baseCurrency={(side === "A" ? inputA : inputB).baseCurrency}
                          />
                        ),
                        "geo-mobile-toggle",
                      )}
                    </div>
                  )}

                {/* Per-portfolio deep dives: Monte Carlo, Risk Metrics, Stress Test */}
                {inputA && inputB && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{lang === "de" ? "Detailanalyse je Portfolio" : "Per-Portfolio Deep Dive"}</CardTitle>
                      <CardDescription>
                        {lang === "de"
                          ? "Monte-Carlo-Simulation, Risiko-Kennzahlen und Szenario-Stresstests für jedes Portfolio."
                          : "Monte Carlo simulation, risk metrics and scenario stress tests for each portfolio."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Mobile: each sub-section gets its own independent A/B toggle. */}
                      <div className="md:hidden space-y-6">
                        {/* Monte Carlo */}
                        <Tabs defaultValue="A" className="w-full" data-testid="deepdive-mc-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4">
                            <MonteCarloSimulation
                              allocation={outputA!.allocation}
                              horizonYears={inputA.horizon}
                              baseCurrency={inputA.baseCurrency}
                              hedged={inputA.includeCurrencyHedging}
                              includeSyntheticETFs={inputA.includeSyntheticETFs}
                              etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined}
                              riskRegime={riskRegimeA}
                              onRiskRegimeChange={setRiskRegimeA}
                            />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4">
                            <MonteCarloSimulation
                              allocation={outputB!.allocation}
                              horizonYears={inputB.horizon}
                              baseCurrency={inputB.baseCurrency}
                              hedged={inputB.includeCurrencyHedging}
                              includeSyntheticETFs={inputB.includeSyntheticETFs}
                              etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined}
                              riskRegime={riskRegimeB}
                              onRiskRegimeChange={setRiskRegimeB}
                            />
                          </TabsContent>
                        </Tabs>

                        {/* Risk Metrics */}
                        <Tabs defaultValue="A" className="w-full" data-testid="deepdive-risk-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4">
                            <PortfolioMetrics allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined} includeSyntheticETFs={inputA.includeSyntheticETFs} hedged={inputA.includeCurrencyHedging} riskRegime={riskRegimeA} onRiskRegimeChange={setRiskRegimeA} />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4">
                            <PortfolioMetrics allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined} includeSyntheticETFs={inputB.includeSyntheticETFs} hedged={inputB.includeCurrencyHedging} riskRegime={riskRegimeB} onRiskRegimeChange={setRiskRegimeB} />
                          </TabsContent>
                        </Tabs>

                        {/* Stress Test */}
                        <Tabs defaultValue="A" className="w-full" data-testid="deepdive-stress-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4">
                            <StressTest allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4">
                            <StressTest allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} />
                          </TabsContent>
                        </Tabs>
                      </div>

                      {/* Desktop: side-by-side */}
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="space-y-0 min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          <MonteCarloSimulation
                            allocation={outputA!.allocation}
                            horizonYears={inputA.horizon}
                            baseCurrency={inputA.baseCurrency}
                            hedged={inputA.includeCurrencyHedging}
                            includeSyntheticETFs={inputA.includeSyntheticETFs}
                            etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined}
                            riskRegime={riskRegimeA}
                            onRiskRegimeChange={setRiskRegimeA}
                          />
                          <PortfolioMetrics allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined} includeSyntheticETFs={inputA.includeSyntheticETFs} hedged={inputA.includeCurrencyHedging} riskRegime={riskRegimeA} onRiskRegimeChange={setRiskRegimeA} />
                          <StressTest allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} />
                        </div>
                        <div className="space-y-0 min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          <MonteCarloSimulation
                            allocation={outputB!.allocation}
                            horizonYears={inputB.horizon}
                            baseCurrency={inputB.baseCurrency}
                            hedged={inputB.includeCurrencyHedging}
                            includeSyntheticETFs={inputB.includeSyntheticETFs}
                            etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined}
                            riskRegime={riskRegimeB}
                            onRiskRegimeChange={setRiskRegimeB}
                          />
                          <PortfolioMetrics allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined} includeSyntheticETFs={inputB.includeSyntheticETFs} hedged={inputB.includeCurrencyHedging} riskRegime={riskRegimeB} onRiskRegimeChange={setRiskRegimeB} />
                          <StressTest allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Fees & Costs (TER) — Fee Estimator for both portfolios + delta.
                 *  Portfolio A's investment-amount input is lifted to the
                 *  parent (portAFeeAmountDraft) so:
                 *    - the desktop and mobile-Tabs A instances share the
                 *      same draft value, and
                 *    - the delta sentence below uses Portfolio A's actual
                 *      typed amount (not a hardcoded reference) when
                 *      computing the annual-fee gap. */}
                {inputA && inputB && outputA && outputB && (() => {
                  const feesA = estimateFees(outputA.allocation, inputA.horizon, portAFeeAmount, {
                    hedged: inputA.includeCurrencyHedging && inputA.baseCurrency !== "USD",
                    etfImplementations: outputA.etfImplementation,
                  });
                  const feesB = estimateFees(outputB.allocation, inputB.horizon, portAFeeAmount, {
                    hedged: inputB.includeCurrencyHedging && inputB.baseCurrency !== "USD",
                    etfImplementations: outputB.etfImplementation,
                  });
                  const terDiffBps = feesA.blendedTerBps - feesB.blendedTerBps;
                  const cheaperSide: "A" | "B" | null =
                    terDiffBps > 0.5 ? "B" : terDiffBps < -0.5 ? "A" : null;
                  const absBps = Math.round(Math.abs(terDiffBps));
                  const annualFeeDiff = (Math.abs(terDiffBps) / 10000) * portAFeeAmount;
                  const fmtA = (v: number) =>
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: inputA.baseCurrency,
                      maximumFractionDigits: 0,
                    }).format(v);
                  const refLabel = fmtA(portAFeeAmount);
                  const deltaText: string =
                    portAFeeAmount <= 0
                      ? lang === "de"
                        ? `Geben Sie einen Anlagebetrag in Portfolio A ein, um den jährlichen Gebührenunterschied zu sehen.`
                        : `Enter an investment amount in Portfolio A to see the annual fee gap.`
                      : cheaperSide === null
                      ? lang === "de"
                        ? "Beide Portfolios haben praktisch dieselbe Blended TER."
                        : "Both portfolios have effectively the same blended TER."
                      : lang === "de"
                      ? `Portfolio ${cheaperSide} ist ${absBps} Bp günstiger — ca. ${fmtA(annualFeeDiff)} / Jahr bei ${refLabel}.`
                      : `Portfolio ${cheaperSide} is ${absBps} bps cheaper — about ${fmtA(annualFeeDiff)} / year on ${refLabel}.`;
                  return (
                    <Card>
                      <CardHeader>
                        <CardTitle>{lang === "de" ? "Gebühren & Kosten (TER)" : "Fees & Costs (TER)"}</CardTitle>
                        <CardDescription>
                          {lang === "de"
                            ? "Geschätzte Blended TER und Gebühren-Drag über den Anlagehorizont — je Portfolio mit der tatsächlich gewählten ETF-Auswahl."
                            : "Estimated blended TER and projected fee drag over the investment horizon — for each portfolio using its picked ETFs."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Mobile: A/B toggle */}
                        <div className="md:hidden">
                          <Tabs defaultValue="A" className="w-full" data-testid="compare-fees-mobile-toggle">
                            <TabsList className="grid w-full max-w-xs grid-cols-2">
                              <TabsTrigger value="A">Portfolio A</TabsTrigger>
                              <TabsTrigger value="B">Portfolio B</TabsTrigger>
                            </TabsList>
                            <TabsContent value="A" className="mt-4 min-w-0">
                              <FeeEstimator
                                allocation={outputA.allocation}
                                horizonYears={inputA.horizon}
                                baseCurrency={inputA.baseCurrency}
                                hedged={inputA.includeCurrencyHedging}
                                etfImplementations={outputA.etfImplementation}
                                amountDraft={portAFeeAmountDraft}
                                onAmountDraftChange={setPortAFeeAmountDraft}
                              />
                            </TabsContent>
                            <TabsContent value="B" className="mt-4 min-w-0">
                              <FeeEstimator
                                allocation={outputB.allocation}
                                horizonYears={inputB.horizon}
                                baseCurrency={inputB.baseCurrency}
                                hedged={inputB.includeCurrencyHedging}
                                etfImplementations={outputB.etfImplementation}
                              />
                            </TabsContent>
                          </Tabs>
                        </div>
                        {/* Desktop: side-by-side */}
                        <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                            <FeeEstimator
                              allocation={outputA.allocation}
                              horizonYears={inputA.horizon}
                              baseCurrency={inputA.baseCurrency}
                              hedged={inputA.includeCurrencyHedging}
                              etfImplementations={outputA.etfImplementation}
                              amountDraft={portAFeeAmountDraft}
                              onAmountDraftChange={setPortAFeeAmountDraft}
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                            <FeeEstimator
                              allocation={outputB.allocation}
                              horizonYears={inputB.horizon}
                              baseCurrency={inputB.baseCurrency}
                              hedged={inputB.includeCurrencyHedging}
                              etfImplementations={outputB.etfImplementation}
                            />
                          </div>
                        </div>
                        <p className="mt-6 text-sm text-muted-foreground" data-testid="compare-fees-delta">
                          {deltaText}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ETF Implementation (read-only) — full Build-style table per side. */}
                {inputA && inputB && outputA && outputB && (
                  <Card data-testid="compare-etf-implementation-card">
                    <CardHeader>
                      <CardTitle>{t("compare.implementation.title")}</CardTitle>
                      <CardDescription>{t("compare.implementation.desc")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Mobile: A/B toggle */}
                      <div className="md:hidden">
                        <Tabs defaultValue="A" className="w-full" data-testid="compare-etf-mobile-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4 min-w-0">
                            <EtfImplementationReadOnly
                              etfs={outputA.etfImplementation}
                              testIdPrefix="compare-etf-a"
                              onIsinClick={setDetailsEtf}
                            />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4 min-w-0">
                            <EtfImplementationReadOnly
                              etfs={outputB.etfImplementation}
                              testIdPrefix="compare-etf-b"
                              onIsinClick={setDetailsEtf}
                            />
                          </TabsContent>
                        </Tabs>
                      </div>
                      {/* Desktop: side-by-side */}
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          <EtfImplementationReadOnly
                            etfs={outputA.etfImplementation}
                            testIdPrefix="compare-etf-a"
                            onIsinClick={setDetailsEtf}
                          />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          <EtfImplementationReadOnly
                            etfs={outputB.etfImplementation}
                            testIdPrefix="compare-etf-b"
                            onIsinClick={setDetailsEtf}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Consolidated Currency Overview (Post-Hedge) — always visible for both. */}
                {inputA && inputB && outputA && outputB && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {lang === "de"
                          ? "Konsolidierte Währungsübersicht (nach Hedge)"
                          : "Consolidated Currency Overview (Post-Hedge)"}
                      </CardTitle>
                      <CardDescription>
                        {lang === "de"
                          ? "Effektive Währungsexponierung je Portfolio nach Anwendung von Hedging-Flags und Basiswährung."
                          : "Effective currency exposure per portfolio after applying hedging flags and base currency."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="md:hidden">
                        <Tabs defaultValue="A" className="w-full" data-testid="compare-currency-mobile-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4 min-w-0">
                            <CurrencyOverview etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} lookThroughView={inputA.lookThroughView} />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4 min-w-0">
                            <CurrencyOverview etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} lookThroughView={inputB.lookThroughView} />
                          </TabsContent>
                        </Tabs>
                      </div>
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          <CurrencyOverview etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} lookThroughView={inputA.lookThroughView} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          <CurrencyOverview etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} lookThroughView={inputB.lookThroughView} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Look-Through Analysis — gated per side on lookThroughView.
                 *  When both sides are OFF the entire wrapping Card disappears
                 *  (no empty card shell, no "Look-through is off for Portfolio
                 *  X" placeholder), matching how Build hides the section. When
                 *  only one side is OFF, we drop that side's column on
                 *  desktop and remove its tab on mobile. */}
                {inputA && inputB && outputA && outputB && (inputA.lookThroughView || inputB.lookThroughView) && (
                  <Card data-testid="compare-lookthrough-analysis-card">
                    <CardHeader>
                      <CardTitle>
                        {lang === "de" ? "Look-Through-Analyse" : "Look-Through Analysis"}
                      </CardTitle>
                      <CardDescription>
                        {lang === "de"
                          ? "Geografische und Sektor-Verteilung auf Basis der zugrunde liegenden ETF-Bestände."
                          : "Geographic and sector breakdown derived from the underlying ETF holdings."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {renderLookThroughSection(
                        inputA.lookThroughView,
                        inputB.lookThroughView,
                        (side) => (
                          <LookThroughAnalysis
                            etfs={(side === "A" ? outputA : outputB).etfImplementation}
                            baseCurrency={(side === "A" ? inputA : inputB).baseCurrency}
                          />
                        ),
                        "compare-lookthrough-mobile-toggle",
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Top 10 Equity Holdings (Look-Through) — gated per side on
                 *  lookThroughView. Same all-off / one-off semantics as the
                 *  Look-Through Analysis card above. */}
                {inputA && inputB && outputA && outputB && (inputA.lookThroughView || inputB.lookThroughView) && (
                  <Card data-testid="compare-top10-holdings-card">
                    <CardHeader>
                      <CardTitle>
                        {lang === "de"
                          ? "Top 10 Aktienpositionen (Look-Through)"
                          : "Top 10 Equity Holdings (Look-Through)"}
                      </CardTitle>
                      <CardDescription>
                        {lang === "de"
                          ? "Größte Einzelpositionen aggregiert über die zugrunde liegenden Aktien-ETFs je Portfolio."
                          : "Largest single-name concentrations aggregated across each portfolio's underlying equity ETFs."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {renderLookThroughSection(
                        inputA.lookThroughView,
                        inputB.lookThroughView,
                        (side) => (
                          <TopHoldings
                            etfs={(side === "A" ? outputA : outputB).etfImplementation}
                            baseCurrency={(side === "A" ? inputA : inputB).baseCurrency}
                          />
                        ),
                        "compare-topholdings-mobile-toggle",
                      )}
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}
          </div>
        )}
      </div>
      <ETFDetailsDialog
        etf={detailsEtf}
        open={!!detailsEtf}
        onOpenChange={(o) => {
          if (!o) setDetailsEtf(null);
        }}
      />
    </div>
  );
}
