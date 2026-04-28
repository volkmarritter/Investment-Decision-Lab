import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Scale, ShieldAlert, Target } from "lucide-react";
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

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio } from "@/lib/portfolio";
import { mapAllocationToAssetsLookthrough, CMA } from "@/lib/metrics";
import { colorForBucket, compareBuckets } from "@/lib/chartColors";
import { defaultExchangeFor } from "@/lib/exchange";
import { diffPortfolios } from "@/lib/compare";
import type { ManualWeights } from "@/lib/manualWeights";
import { PortfolioMetrics } from "./PortfolioMetrics";
import { StressTest } from "./StressTest";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import { FeeEstimator, formatThousandsLive } from "./FeeEstimator";
import { CurrencyOverview } from "./CurrencyOverview";
import { LookThroughAnalysis } from "./LookThroughAnalysis";
import { TopHoldings } from "./TopHoldings";
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
  const [hasGenerated, setHasGenerated] = useState(false);
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
  // render (avoids a 100000 → 100,000 jump on the very first keystroke).
  const [portAFeeAmountDraft, setPortAFeeAmountDraft] = useState<string>(() =>
    formatThousandsLive("100000"),
  );
  // Numeric value for the delta calc. Strip thousand separators (commas,
  // spaces, Swiss apostrophes) before parseDecimalInput, same convention as
  // FeeEstimator's own derivation.
  const portAFeeAmount = (() => {
    const cleaned = portAFeeAmountDraft.replace(/[\s',\u2019]/g, "");
    return parseDecimalInput(cleaned, { min: 0 }) ?? 0;
  })();

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
    setValidationA(stripComplexity(valA));
    setValidationB(stripComplexity(valB));

    if (valA.isValid) { setOutputA(buildPortfolio(parsedA, "en", manualWeightsA)); setInputA(parsedA); }
    else { setOutputA(null); setInputA(null); }

    if (valB.isValid) { setOutputB(buildPortfolio(parsedB, "en", manualWeightsB)); setInputB(parsedB); }
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
        <CardTitle className="text-xl">{title}</CardTitle>
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
                onLoadA: (scenario) => {
                  form.setValue("portA", { ...scenario.input }, { shouldDirty: true, shouldValidate: false });
                  // Replace slot A's snapshot with the saved entry's (or
                  // clear it when the saved entry has none) so the next
                  // Generate call honours the saved custom weights for A
                  // without leaking into B.
                  setManualWeightsA(
                    scenario.manualWeights && Object.keys(scenario.manualWeights).length > 0
                      ? { ...scenario.manualWeights }
                      : undefined,
                  );
                  toast.success(lang === "de" ? "In Portfolio A geladen" : "Loaded into Portfolio A");
                },
                onLoadB: (scenario) => {
                  form.setValue("portB", { ...scenario.input }, { shouldDirty: true, shouldValidate: false });
                  setManualWeightsB(
                    scenario.manualWeights && Object.keys(scenario.manualWeights).length > 0
                      ? { ...scenario.manualWeights }
                      : undefined,
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

                {/* Effective geographic equity allocation per portfolio.
                 *  Mobile: per-section A/B toggle. Desktop: side-by-side. */}
                {inputA && inputB && outputA && outputB && (
                  <>
                    <div className="md:hidden">
                      <Tabs defaultValue="A" className="w-full" data-testid="geo-mobile-toggle">
                        <TabsList className="grid w-full max-w-xs grid-cols-2">
                          <TabsTrigger value="A">Portfolio A</TabsTrigger>
                          <TabsTrigger value="B">Portfolio B</TabsTrigger>
                        </TabsList>
                        <TabsContent value="A" className="mt-4 min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          <GeoExposureMap
                            etfs={outputA.etfImplementation}
                            baseCurrency={inputA.baseCurrency}
                          />
                        </TabsContent>
                        <TabsContent value="B" className="mt-4 min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          <GeoExposureMap
                            etfs={outputB.etfImplementation}
                            baseCurrency={inputB.baseCurrency}
                          />
                        </TabsContent>
                      </Tabs>
                    </div>
                    <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                        <GeoExposureMap
                          etfs={outputA.etfImplementation}
                          baseCurrency={inputA.baseCurrency}
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                        <GeoExposureMap
                          etfs={outputB.etfImplementation}
                          baseCurrency={inputB.baseCurrency}
                        />
                      </div>
                    </div>
                  </>
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
                            />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4">
                            <MonteCarloSimulation
                              allocation={outputB!.allocation}
                              horizonYears={inputB.horizon}
                              baseCurrency={inputB.baseCurrency}
                              hedged={inputB.includeCurrencyHedging}
                              includeSyntheticETFs={inputB.includeSyntheticETFs}
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
                            <PortfolioMetrics allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined} includeSyntheticETFs={inputA.includeSyntheticETFs} hedged={inputA.includeCurrencyHedging} />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4">
                            <PortfolioMetrics allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined} includeSyntheticETFs={inputB.includeSyntheticETFs} hedged={inputB.includeCurrencyHedging} />
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
                          />
                          <PortfolioMetrics allocation={outputA!.allocation} baseCurrency={inputA.baseCurrency} etfImplementation={inputA.lookThroughView ? outputA!.etfImplementation : undefined} includeSyntheticETFs={inputA.includeSyntheticETFs} hedged={inputA.includeCurrencyHedging} />
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
                          />
                          <PortfolioMetrics allocation={outputB!.allocation} baseCurrency={inputB.baseCurrency} etfImplementation={inputB.lookThroughView ? outputB!.etfImplementation : undefined} includeSyntheticETFs={inputB.includeSyntheticETFs} hedged={inputB.includeCurrencyHedging} />
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
                            <CurrencyOverview etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                          </TabsContent>
                          <TabsContent value="B" className="mt-4 min-w-0">
                            <CurrencyOverview etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                          </TabsContent>
                        </Tabs>
                      </div>
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          <CurrencyOverview etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          <CurrencyOverview etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Look-Through Analysis — gated per side on lookThroughView. */}
                {inputA && inputB && outputA && outputB && (inputA.lookThroughView || inputB.lookThroughView) && (
                  <Card>
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
                      <div className="md:hidden">
                        <Tabs defaultValue={inputA.lookThroughView ? "A" : "B"} className="w-full" data-testid="compare-lookthrough-mobile-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4 min-w-0">
                            {inputA.lookThroughView ? (
                              <LookThroughAnalysis etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                            ) : (
                              <p className="text-sm text-muted-foreground italic">
                                {lang === "de"
                                  ? "Look-Through ist für Portfolio A deaktiviert."
                                  : "Look-through is off for Portfolio A."}
                              </p>
                            )}
                          </TabsContent>
                          <TabsContent value="B" className="mt-4 min-w-0">
                            {inputB.lookThroughView ? (
                              <LookThroughAnalysis etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                            ) : (
                              <p className="text-sm text-muted-foreground italic">
                                {lang === "de"
                                  ? "Look-Through ist für Portfolio B deaktiviert."
                                  : "Look-through is off for Portfolio B."}
                              </p>
                            )}
                          </TabsContent>
                        </Tabs>
                      </div>
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          {inputA.lookThroughView ? (
                            <LookThroughAnalysis etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              {lang === "de"
                                ? "Look-Through ist für Portfolio A deaktiviert."
                                : "Look-through is off for Portfolio A."}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          {inputB.lookThroughView ? (
                            <LookThroughAnalysis etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              {lang === "de"
                                ? "Look-Through ist für Portfolio B deaktiviert."
                                : "Look-through is off for Portfolio B."}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Top 10 Equity Holdings (Look-Through) — gated per side on lookThroughView. */}
                {inputA && inputB && outputA && outputB && (inputA.lookThroughView || inputB.lookThroughView) && (
                  <Card>
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
                      <div className="md:hidden">
                        <Tabs defaultValue={inputA.lookThroughView ? "A" : "B"} className="w-full" data-testid="compare-topholdings-mobile-toggle">
                          <TabsList className="grid w-full max-w-xs grid-cols-2">
                            <TabsTrigger value="A">Portfolio A</TabsTrigger>
                            <TabsTrigger value="B">Portfolio B</TabsTrigger>
                          </TabsList>
                          <TabsContent value="A" className="mt-4 min-w-0">
                            {inputA.lookThroughView ? (
                              <TopHoldings etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                            ) : (
                              <p className="text-sm text-muted-foreground italic">
                                {lang === "de"
                                  ? "Look-Through ist für Portfolio A deaktiviert."
                                  : "Look-through is off for Portfolio A."}
                              </p>
                            )}
                          </TabsContent>
                          <TabsContent value="B" className="mt-4 min-w-0">
                            {inputB.lookThroughView ? (
                              <TopHoldings etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                            ) : (
                              <p className="text-sm text-muted-foreground italic">
                                {lang === "de"
                                  ? "Look-Through ist für Portfolio B deaktiviert."
                                  : "Look-through is off for Portfolio B."}
                              </p>
                            )}
                          </TabsContent>
                        </Tabs>
                      </div>
                      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio A</h3>
                          {inputA.lookThroughView ? (
                            <TopHoldings etfs={outputA.etfImplementation} baseCurrency={inputA.baseCurrency} />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              {lang === "de"
                                ? "Look-Through ist für Portfolio A deaktiviert."
                                : "Look-through is off for Portfolio A."}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Portfolio B</h3>
                          {inputB.lookThroughView ? (
                            <TopHoldings etfs={outputB.etfImplementation} baseCurrency={inputB.baseCurrency} />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              {lang === "de"
                                ? "Look-Through ist für Portfolio B deaktiviert."
                                : "Look-through is off for Portfolio B."}
                            </p>
                          )}
                        </div>
                      </div>
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
