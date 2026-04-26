import { useEffect, useMemo, useState } from "react";
import { BookOpen, Database, Calculator, AlertTriangle, ExternalLink, RotateCcw, ShieldQuestion, Layers, Activity, GitCompare, Building2, RefreshCw, Pencil, Replace, Coins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CMA, BENCHMARK, buildCorrelationMatrix, getCMAConsensus, getCMASources, getCMASeed, applyCMALayers, AssetKey } from "@/lib/metrics";
import { SCENARIOS } from "@/lib/scenarios";
import { getRiskFreeRates, getRiskFreeRateOverrides, setRiskFreeRate, resetRiskFreeRate, subscribeRiskFreeRate, RF_DEFAULTS, RFCurrency, getCMAOverrides, setCMAOverrides, resetCMAOverrides, subscribeCMAOverrides, CMAUserOverrides, getHomeBiasOverrides, setHomeBiasOverrides, resetHomeBiasOverrides, subscribeHomeBiasOverrides, resolvedHomeBias, HOME_BIAS_DEFAULTS, HomeBiasCurrency, getLastAllocation, subscribeLastAllocation } from "@/lib/settings";
import type { AssetAllocation } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/manualWeights";
import {
  BucketTree,
  BucketTreeBulkToggle,
  groupCatalogByAssetClass,
  type BucketLeaf,
} from "@/components/BucketTree";
import { EtfOverrideDialog } from "@/components/EtfOverrideDialog";
import { getCatalog, type ETFRecord } from "@/lib/etfs";
import {
  getETFOverrides,
  clearETFOverride,
  clearAllETFOverrides,
  subscribeETFOverrides,
} from "@/lib/etfOverrides";
import type { CatalogSummary, CatalogEntrySummary } from "@/lib/admin-api";

const LAST_REVIEWED = "Q2 2026";

export function Methodology() {
  const { lang } = useT();
  const de = lang === "de";

  // Per-currency RF (Task #32, 2026-04-26). Each base currency keeps its own
  // money-market rate because USD T-Bills, EUR ESTR, GBP SONIA and CHF SARON
  // diverge meaningfully. The four-row table below is the editor; the
  // construction overlay table further down displays the currently-shown
  // currency's RF in its Sharpe-tilt row.
  const RF_CURRENCIES: RFCurrency[] = ["USD", "EUR", "GBP", "CHF"];
  const buildRfDraft = (): Record<RFCurrency, string> => {
    const all = getRiskFreeRates();
    return {
      USD: (all.USD * 100).toFixed(2),
      EUR: (all.EUR * 100).toFixed(2),
      GBP: (all.GBP * 100).toFixed(2),
      CHF: (all.CHF * 100).toFixed(2),
    };
  };
  const [rfRates, setRfRates] = useState<Record<RFCurrency, number>>(() => getRiskFreeRates());
  const [rfDraft, setRfDraft] = useState<Record<RFCurrency, string>>(() => buildRfDraft());
  useEffect(() => subscribeRiskFreeRate((all) => { setRfRates(all); setRfDraft(buildRfDraft()); }), []);

  const applyRf = (ccy: RFCurrency) => {
    // Locale-comma safe: route the user's draft string through the shared
    // parser so "2,5" on a CH/DE/FR phone keypad parses the same as "2.5"
    // (Task #14 — extended to Methodology by Task #19).
    const v = parseDecimalInput(rfDraft[ccy]);
    if (v !== null && v >= 0 && v <= 20) setRiskFreeRate(ccy, v / 100);
  };
  const rfOverrides = getRiskFreeRateOverrides();

  // ---------------------------------------------------------------- CMA editor
  // Local working buffer of user inputs. Persisted on "Apply".
  const fmtPct = (n: number, dp = 2) => (n * 100).toFixed(dp);
  const buildDraft = (): Record<AssetKey, { mu: string; sigma: string }> => {
    const ov = getCMAOverrides();
    const out = {} as Record<AssetKey, { mu: string; sigma: string }>;
    (Object.keys(CMA) as AssetKey[]).forEach((k) => {
      const u = ov[k];
      out[k] = {
        mu: u?.expReturn !== undefined ? fmtPct(u.expReturn, 2) : "",
        sigma: u?.vol !== undefined ? fmtPct(u.vol, 2) : "",
      };
    });
    return out;
  };
  const [cmaDraft, setCmaDraft] = useState(() => buildDraft());
  const [cmaVersion, setCmaVersion] = useState(0);
  useEffect(() => subscribeCMAOverrides(() => { applyCMALayers(); setCmaVersion((v) => v + 1); setCmaDraft(buildDraft()); }), []);

  const cmaSources = getCMASources();
  const consensus = getCMAConsensus();
  const overrides = getCMAOverrides();
  const userOverrideCount = Object.keys(overrides).length;
  void cmaVersion;

  const applyCmaDraft = () => {
    const next: CMAUserOverrides = {};
    (Object.keys(CMA) as AssetKey[]).forEach((k) => {
      const d = cmaDraft[k];
      const entry: { expReturn?: number; vol?: number } = {};
      // Locale-comma safe: route both fields through the shared parser so
      // "0,5" on a CH/DE/FR phone keypad parses the same as "0.5"
      // (Task #14 — extended to Methodology by Task #19).
      const mu = parseDecimalInput(d.mu);
      const sg = parseDecimalInput(d.sigma);
      if (mu !== null) entry.expReturn = mu / 100;
      if (sg !== null && sg >= 0) entry.vol = sg / 100;
      if (entry.expReturn !== undefined || entry.vol !== undefined) next[k] = entry;
    });
    setCMAOverrides(next);
  };
  const resetCma = () => { resetCMAOverrides(); };

  // ---------------------------------------------------------- Home-bias editor
  // Per-currency multiplier on the home equity region. Defaults from
  // HOME_BIAS_DEFAULTS; user overrides persisted in localStorage.
  const HB_CURRENCIES: HomeBiasCurrency[] = ["USD", "EUR", "GBP", "CHF"];
  const HB_REGION_LABEL: Record<HomeBiasCurrency, string> = {
    USD: "USA",
    EUR: "Europe",
    GBP: "Europe",
    CHF: "Switzerland",
  };
  const HB_REGION_LABEL_DE: Record<HomeBiasCurrency, string> = {
    USD: "USA",
    EUR: "Europa",
    GBP: "Europa",
    CHF: "Schweiz",
  };
  const buildHbDraft = (): Record<HomeBiasCurrency, string> => {
    const ov = getHomeBiasOverrides();
    return {
      USD: ov.USD !== undefined ? ov.USD.toFixed(2) : "",
      EUR: ov.EUR !== undefined ? ov.EUR.toFixed(2) : "",
      GBP: ov.GBP !== undefined ? ov.GBP.toFixed(2) : "",
      CHF: ov.CHF !== undefined ? ov.CHF.toFixed(2) : "",
    };
  };
  const [hbDraft, setHbDraft] = useState(() => buildHbDraft());
  const [hbVersion, setHbVersion] = useState(0);
  useEffect(() => subscribeHomeBiasOverrides(() => { setHbVersion((v) => v + 1); setHbDraft(buildHbDraft()); }), []);
  void hbVersion;

  const hbOverrides = getHomeBiasOverrides();
  const hbOverrideCount = Object.keys(hbOverrides).length;

  const applyHbDraft = () => {
    const next: Record<string, number> = {};
    for (const c of HB_CURRENCIES) {
      // Locale-comma safe: route through the shared parser so "1,2" on a
      // CH/DE/FR phone keypad parses the same as "1.2" (Task #14 —
      // extended to Methodology by Task #19). Empty / garbage → null →
      // currency stays on its default multiplier.
      const v = parseDecimalInput(hbDraft[c]);
      if (v !== null && v >= 0 && v <= 5) next[c] = v;
    }
    setHomeBiasOverrides(next);
  };
  const resetHb = () => { resetHomeBiasOverrides(); };

  const sourceBadge = (src: "seed" | "consensus" | "user") => {
    if (src === "user") return <Badge variant="default" className="text-[10px] px-1.5 py-0">{de ? "Eigene" : "Custom"}</Badge>;
    if (src === "consensus") return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{de ? "Konsens" : "Consensus"}</Badge>;
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{de ? "Engine" : "Engine"}</Badge>;
  };

  // Reflect the user's last-built portfolio (published by BuildPortfolio
  // through `setLastAllocation`) so the Methodology correlation matrix can
  // mark which rows are actually held — same UX as PortfolioMetrics. Falls
  // back to the BENCHMARK (equity-only ACWI proxy) when the user has not
  // built a portfolio yet, so the matrix still renders as a pure reference.
  const [lastAlloc, setLastAlloc] = useState<AssetAllocation[] | null>(() => getLastAllocation() as AssetAllocation[] | null);
  useEffect(() => subscribeLastAllocation((a) => setLastAlloc(a as AssetAllocation[] | null)), []);

  const corrSourceAllocation: AssetAllocation[] = (lastAlloc && lastAlloc.length > 0)
    ? lastAlloc
    : BENCHMARK.map((b) => ({ assetClass: "Equity", region: regionFromKey(b.key), weight: b.weight * 100 }));
  const sampleCorr = buildCorrelationMatrix(corrSourceAllocation);
  const corrReflectsPortfolio = !!(lastAlloc && lastAlloc.length > 0);

  // ------------------------------------------------------ ETF bucket browser
  // The shared BucketTree expects a `CatalogSummary` (Record<key, entry>).
  // The local catalog from etfs.ts is shaped as Record<key, ETFRecord>; we
  // adapt it once on mount so the tree, the override-dialog "current" pane
  // and the per-leaf reset action all read from the same in-memory source
  // (no /api/admin/catalog roundtrip needed for the canonical view).
  const catalogSummary = useMemo<CatalogSummary>(() => {
    const cat = getCatalog();
    const out: CatalogSummary = {};
    for (const [k, v] of Object.entries(cat)) {
      out[k] = { ...v, key: k } as CatalogEntrySummary;
    }
    return out;
  }, []);
  const bucketGroups = useMemo(
    () => groupCatalogByAssetClass(catalogSummary),
    [catalogSummary],
  );
  const [bucketsExpanded, setBucketsExpanded] = useState<Set<string>>(
    () => new Set(),
  );
  const [etfOverrides, setEtfOverrides] = useState<Record<string, ETFRecord>>(
    () => getETFOverrides(),
  );
  // Subscribe so the badge / reset button re-render the moment the dialog
  // writes a new override (no manual refresh needed).
  useEffect(() => subscribeETFOverrides((all) => setEtfOverrides(all)), []);
  const etfOverrideCount = Object.keys(etfOverrides).length;
  const [dialogBucket, setDialogBucket] = useState<{ key: string; current: ETFRecord } | null>(
    null,
  );

  const openOverrideDialog = (leaf: BucketLeaf) => {
    const current = getCatalog()[leaf.key];
    if (!current) return;
    setDialogBucket({ key: leaf.key, current: etfOverrides[leaf.key] ?? current });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {de ? "Methodik & Datenquellen" : "Methodology & Data Sources"}
          </CardTitle>
          <CardDescription>
            {de
              ? "Vollständige Transparenz: Diese Anwendung ist absichtlich regelbasiert und offline. Hier ist jede Annahme, jede Formel und jede Quelle dokumentiert."
              : "Full transparency: this app is intentionally rule-based and offline. Every assumption, formula and source is documented below."}
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="outline">{de ? "Frontend-only" : "Frontend-only"}</Badge>
            <Badge variant="outline">{de ? "Keine Live-Marktdaten" : "No live market data"}</Badge>
            <Badge variant="outline">{de ? "Zuletzt geprüft" : "Last reviewed"}: {LAST_REVIEWED}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <Layers className="h-4 w-4" />
            <AlertTitle>{de ? "Regelbasiert, keine KI" : "Rule-based, not AI"}</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              {de
                ? "Der Portfolio-Vorschlag wird von einer vollständig deterministischen, regelbasierten Engine erzeugt — kein KI-/ML-Modell, kein LLM-Aufruf, kein probabilistischer Optimierer und keine Trainingsdaten. Bei identischen Eingaben liefert die App immer identische Ergebnisse, und jedes Gewicht lässt sich aus den Formeln und Konstanten unten von Hand nachvollziehen. Die einzige stochastische Komponente ist die optionale Monte-Carlo-Projektion in der Metrik-Ansicht — sie wird nicht zur Konstruktion verwendet."
                : "The portfolio proposal is produced by a fully deterministic, rule-based engine — no AI/ML model, no LLM call, no probabilistic optimiser, no training data. Identical inputs always yield identical outputs, and every weight can be re-derived by hand from the formulas and constants below. The only stochastic component is the optional Monte Carlo projection in the metrics view — it is not used to construct the portfolio."}
            </AlertDescription>
          </Alert>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{de ? "Keine Anlageberatung" : "Not investment advice"}</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              {de
                ? "Diese Anwendung dient ausschließlich zu Bildungs- und Demonstrationszwecken. Alle Renditen, Volatilitäten, Korrelationen und Stress-Szenarien sind statische, regelbasierte Schätzungen – sie spiegeln keine Live-Marktdaten wider und garantieren keine zukünftigen Ergebnisse."
                : "This application is for educational and illustration purposes only. All returns, volatilities, correlations and stress scenarios are static, rule-based estimates — they do not reflect live market data and do not guarantee future results."}
            </AlertDescription>
          </Alert>

          {/* ---------- What is editable here ---------- */}
          <div className="rounded-md border bg-primary/5 p-3 space-y-2" data-testid="editable-overview">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">
                {de ? "Live editierbar in dieser Ansicht" : "Live-editable in this view"}
              </span>
              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {de ? "Eigene Werte" : "Custom values"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {de
                ? "Die folgenden drei Abschnitte unten enthalten Live-editierbare Eingaben. Eigene Werte werden lokal in Ihrem Browser (localStorage) gespeichert und überschreiben die Defaults in der gesamten App. Klappen Sie den jeweiligen Abschnitt auf, um die Felder zu sehen."
                : "The three sections listed below contain live-editable inputs. Custom values are stored locally in your browser (localStorage) and override the defaults across the entire app. Expand the section in question to see the fields."}
            </p>
            <ul className="text-xs space-y-1 pl-1">
              <li className="flex items-start gap-2">
                <Pencil className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <span>
                  <span className="font-semibold">{de ? "Risikofreier Zinssatz (je Basiswährung)" : "Risk-Free Rate (per base currency)"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "Sharpe-Ratio, Alpha und Aktien-Sharpe-Tilt. Defaults: USD 4,25 % / EUR 2,50 % / GBP 4,00 % / CHF 0,50 %."
                      : "Sharpe Ratio, Alpha and equity Sharpe-tilt. Defaults: USD 4.25% / EUR 2.50% / GBP 4.00% / CHF 0.50%."}
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Pencil className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <span>
                  <span className="font-semibold">{de ? "Home-Bias-Multiplikatoren" : "Home-Bias Multipliers"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "im Abschnitt „Portfolio-Konstruktion\". Verstärkungsfaktor pro Basiswährung (USD / EUR / GBP / CHF), Bereich 0,0 – 5,0."
                      : "inside \"Portfolio Construction\". Amplification factor per base currency (USD / EUR / GBP / CHF), range 0.0 – 5.0."}
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Pencil className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <span>
                  <span className="font-semibold">{de ? "Kapitalmarktannahmen (CMAs)" : "Capital Market Assumptions (CMAs)"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "eigene erwartete Rendite μ und Volatilität σ je Anlageklasse."
                      : "custom expected return μ and volatility σ per asset class."}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={[]} className="space-y-3">
        <Section
          value="rf"
          icon={<Activity className="h-4 w-4" />}
          title={de ? "Risikofreier Zinssatz (je Basiswährung)" : "Risk-Free Rate (per base currency)"}
          editable
          editableLabel={de ? "Editierbar" : "Editable"}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Pro Basiswährung ein eigener risikofreier Zinssatz, weil die kurzfristigen Geldmarkt-Renditen je Region deutlich auseinanderlaufen (USD T-Bills, EUR ESTR, GBP SONIA, CHF SARON). Der Wert der jeweiligen Basiswährung des Portfolios fließt in Sharpe-Ratio, Alpha und in den Sharpe-Tilt-Schritt der Aktienregion-Konstruktion ein."
              : "One risk-free rate per base currency, because short-term money-market yields diverge meaningfully by region (USD T-Bills, EUR ESTR, GBP SONIA, CHF SARON). The value matching the portfolio's base currency feeds into Sharpe ratio, Alpha, and the Sharpe-tilt step of equity-region construction."}
          </p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-3" data-testid="rf-editor">
            <div className="flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {de ? "Risikofreie Zinssätze" : "Risk-free rates"}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {de ? "Bereich 0,00 – 20,00 %" : "range 0.00 – 20.00%"}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">{de ? "Währung" : "Currency"}</TableHead>
                    <TableHead className="w-[180px]">{de ? "Wert (%)" : "Value (%)"}</TableHead>
                    <TableHead className="text-right">{de ? "Default" : "Default"}</TableHead>
                    <TableHead className="text-right">{de ? "Status" : "Status"}</TableHead>
                    <TableHead className="text-right w-[120px]">{de ? "Aktion" : "Action"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RF_CURRENCIES.map((c) => {
                    const isOverride = rfOverrides[c] !== undefined;
                    const def = RF_DEFAULTS[c];
                    return (
                      <TableRow key={`rf-${c}`}>
                        <TableCell className="font-mono text-xs font-semibold">{c}</TableCell>
                        <TableCell>
                          <Input
                            id={`rf-${c}`}
                            type="text"
                            inputMode="decimal"
                            value={rfDraft[c]}
                            onChange={(e) => setRfDraft((d) => ({ ...d, [c]: e.target.value }))}
                            onBlur={() => applyRf(c)}
                            onKeyDown={(e) => { if (e.key === "Enter") applyRf(c); }}
                            className="h-8 w-28 font-mono text-sm"
                            data-testid={`input-rf-${c}`}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground font-mono">
                          {(def * 100).toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {isOverride
                            ? <Badge variant="default" className="text-[10px] px-1.5 py-0">{de ? "Eigene" : "Custom"}</Badge>
                            : <Badge variant="outline" className="text-[10px] px-1.5 py-0">{de ? "Default" : "Default"}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => resetRiskFreeRate(c)}
                            disabled={!isOverride}
                            data-testid={`button-rf-reset-${c}`}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            {de ? "Reset" : "Reset"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {de
                ? "Tipp: Sie können hier die Rendite einer kurzlaufenden Staatsanleihe / eines Geldmarktsatzes Ihrer Basiswährung eingeben (z. B. SARON für CHF, ESTR/EZB für EUR, SONIA für GBP, T-Bills für USD)."
                : "Tip: enter the yield of a short-term government bill / money-market rate in your base currency (e.g. SARON for CHF, ESTR/ECB for EUR, SONIA for GBP, T-Bills for USD)."}
            </p>
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{de ? "Bekannte Einschränkung" : "Known limitation"}</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              {de
                ? "Der RF wird je Basiswährung gewählt, aber die Kapitalmarkt-Annahmen (μ je Anlageklasse, siehe Abschnitt CMAs) sind währungs-nominal und werden nicht in die Basiswährung umgerechnet. In der Praxis ist die FX-Translation kleiner als die Streuung zwischen den LTCMA-Anbietern; bei größeren RF-Spreads (z. B. CHF gegen USD) führt das jedoch zu leicht unterschiedlichen Sharpe-Werten als bei einer streng FX-konsistenten Berechnung."
                : "RF is selected per base currency, but the capital-market assumptions (μ per asset class — see CMAs section) are currency-nominal and are not FX-translated into the base currency. In practice the FX translation is smaller than the dispersion across LTCMA providers; with larger RF spreads (e.g. CHF vs. USD) this still produces slightly different Sharpe values than a strictly FX-consistent calculation would."}
            </AlertDescription>
          </Alert>
        </Section>

        <Section
          value="data-refresh"
          icon={<RefreshCw className="h-4 w-4" />}
          title={de ? "Datenpflege & Aktualität (Snapshot-Build)" : "Data Refresh & Freshness (snapshot build)"}
        >
          <p className="text-sm text-muted-foreground leading-relaxed">
            {de
              ? "Wie und wie oft die ETF-Stammdaten aktualisiert werden — und welche Werte hand-kuratiert bleiben."
              : "How and how often the ETF reference data is refreshed — and which values stay hand-curated."}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {de
              ? "Die App ist bewusst frontend-only und ruft zur Laufzeit keine fremden Server. Stattdessen aktualisieren drei automatische Snapshot-Builds die ETF-Stammdaten in unterschiedlicher Frequenz, je nachdem wie oft sich der jeweilige Wert in der Praxis bewegt. Ein Skript holt die Daten von justETF, schreibt sie als JSON ins Repository und der nächste Build backt den frischen Stand ins Bundle — im Browser des Nutzers wird also weiterhin keine Live-Verbindung benötigt, er bekommt aber stets die zuletzt geprüften Werte."
              : "The app is intentionally frontend-only and makes no remote calls at runtime. Three automatic snapshot builds refresh the ETF reference data instead, each at a different cadence depending on how often the underlying value actually moves in practice. A script pulls the data from justETF, writes it as JSON into the repository, and the next build bakes the fresh snapshot into the bundle — the user's browser still never makes a live call, but always sees the most recently verified values."}
          </p>
          <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed space-y-2">
            <div><span className="font-semibold">{de ? "Quelle" : "Source"}:</span> justetf.com (public ETF profile pages)</div>
            <div className="border-t pt-2">
              <div className="font-semibold mb-0.5">{de ? "1) Wöchentlich — Stammdaten" : "1) Weekly — core fund metadata"}</div>
              <div>{de ? "Sonntags 03:00 UTC · " : "Sundays 03:00 UTC · "}<code className="font-mono">refresh-justetf.mjs --mode=core</code> · <code className="font-mono">.github/workflows/refresh-data.yml</code></div>
              <div className="text-muted-foreground">
                {de
                  ? "Aktualisierte Felder: TER (Basispunkte), Fondsgröße (Mio. EUR), Auflagedatum (ISO), Ertragsverwendung (thesaurierend / ausschüttend), Replikationsmethode (physisch / physisch (Sampling) / synthetisch). Schreibt nach src/data/etfs.overrides.json."
                  : "Refreshed fields: TER (basis points), fund size (EUR millions), inception date (ISO), distribution policy (accumulating / distributing), replication method (physical / physical (sampled) / synthetic). Writes to src/data/etfs.overrides.json."}
              </div>
            </div>
            <div className="border-t pt-2">
              <div className="font-semibold mb-0.5">{de ? "2) Nächtlich — Notierungen je Börse" : "2) Nightly — per-exchange listings"}</div>
              <div>{de ? "Täglich 02:00 UTC · " : "Daily 02:00 UTC · "}<code className="font-mono">refresh-justetf.mjs --mode=listings</code> · <code className="font-mono">.github/workflows/refresh-listings.yml</code></div>
              <div className="text-muted-foreground">
                {de
                  ? "Aktualisierter Wert: Ticker-Map je Börse (LSE / XETRA / SIX / Euronext). Bei mehreren Share-Klassen pro Börse wird die Notierung in der primären Fondswährung bevorzugt (z. B. an LSE der USD-Ticker statt GBX). Schreibt ebenfalls nach src/data/etfs.overrides.json."
                  : "Refreshed value: per-exchange ticker map (LSE / XETRA / SIX / Euronext). When several share classes trade on the same venue, the listing in the fund's primary currency is preferred (e.g. on LSE the USD ticker rather than GBX). Also writes to src/data/etfs.overrides.json."}
              </div>
            </div>
            <div className="border-t pt-2">
              <div className="font-semibold mb-0.5">{de ? "3) Monatlich — Top-10 Holdings" : "3) Monthly — top-10 holdings"}</div>
              <div>{de ? "Am 1. des Monats, 04:00 UTC · " : "1st of month, 04:00 UTC · "}<code className="font-mono">refresh-lookthrough.mjs</code> · <code className="font-mono">.github/workflows/refresh-lookthrough.yml</code></div>
              <div className="text-muted-foreground">
                {de
                  ? "Aktualisierter Wert: Top-10 Einzelwerte mit Gewichten je Aktien-ETF (Name, Anteil in %), plus eine ISIN-genaue Stichtag-Markierung pro Datensatz. Schreibt nach src/data/lookthrough.overrides.json. Nicht-Aktien-ETFs (Gold, Krypto) werden übersprungen."
                  : "Refreshed value: top-10 holdings with weights for each equity ETF (name, weight in %), plus a per-ISIN as-of stamp on every record. Writes to src/data/lookthrough.overrides.json. Non-equity ETFs (gold, crypto) are skipped."}
              </div>
            </div>
            <div className="border-t pt-2">
              <div className="font-semibold mb-0.5">{de ? "4) Monatlich — Länder-, Sektor- & Währungs-Aufteilung (Look-Through)" : "4) Monthly — country, sector & currency breakdown (look-through)"}</div>
              <div>{de ? "Am 1. des Monats, 04:00 UTC · " : "1st of month, 04:00 UTC · "}<code className="font-mono">refresh-lookthrough.mjs</code> · <code className="font-mono">.github/workflows/refresh-lookthrough.yml</code></div>
              <div className="text-muted-foreground">
                {de
                  ? "Aktualisierte Werte je Aktien-ETF: Länder-Aufteilung, Sektor-Aufteilung und Währungs-Aufteilung, plus ein gemeinsamer ISIN-genauer Stichtag (breakdownsAsOf). Länder & Sektoren werden direkt aus den justETF-Tabellen geholt — zuerst aus dem statischen Profil-HTML (das genügt bei thematischen / Einzel-Sektor-ETFs); sobald justETF einen „Show more“-Link rendert, zusätzlich aus dem Wicket-Ajax-Endpoint loadMoreCountries / loadMoreSectors mit dem Session-Cookie aus dem Profilseiten-GET, damit die volle Tabelle erfasst wird. Die Währungs-Aufteilung wird im Refresh-Skript aus der frisch geholten Länder-Aufteilung über eine Land→Lokalwährungs-Tabelle umgebucht (justETF veröffentlicht keine eigene Währungstabelle); für währungsgesicherte Anteilsklassen (HEDGED_ISINS) bleibt die kuratierte Hedge-Währungskarte stehen. Schreibt in dieselbe src/data/lookthrough.overrides.json wie die Top-10-Holdings."
                  : "Refreshed values per equity ETF: country breakdown, sector breakdown and currency breakdown, sharing a single per-ISIN as-of stamp (breakdownsAsOf). Country and sector are scraped straight from the justETF tables — the static profile HTML first (sufficient for thematic / single-sector ETFs); when justETF renders a “Show more” link, the Wicket Ajax loadMoreCountries / loadMoreSectors endpoint is also called using the session cookie captured from the profile-page GET, so the full table is captured. The currency breakdown is re-bucketed inside the refresh script from the just-refreshed country map via a country → local-listing-currency table (justETF doesn't publish a per-ETF currency table). For currency-hedged share classes (HEDGED_ISINS) the curated hedge-currency map is left in place. Writes into the same src/data/lookthrough.overrides.json as the top-10 holdings."}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Hand-kuratiert (von keinem Snapshot überschrieben) bleiben: Default-Börse pro ETF, redaktioneller Kommentar, sowie die Währungs-Aufteilung der währungsgesicherten Anteilsklassen (HEDGED_ISINS) — dort entspricht die FX-Belastung nach Hedging der Anteilsklassen-Währung, nicht dem Länder-Mix. Bei nicht in der Refresh-Liste enthaltenen ISINs (z. B. Gold/Krypto, Anleihen-ETFs ohne Aktien-Look-Through) gilt der Stichtag Q4 2024."
              : "Curated by hand (not overwritten by any snapshot): default exchange per ETF, editorial comment, and the currency breakdown for the currency-hedged share classes (HEDGED_ISINS) — there the post-hedging FX exposure is the share-class currency, not the underlying country mix. For ISINs that aren't in the refresh list (e.g. gold / crypto, bond ETFs without equity look-through) the Q4 2024 reference date applies."}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Auch nicht automatisiert: die Kapitalmarkt-Annahmen (langfristige erwartete Renditen, Volatilitäten, Korrelationen) und die Stress-Szenarien. Diese stammen aus den öffentlich publizierten Long-Term Capital Market Assumptions großer Asset-Manager und werden bewusst stabil gehalten, damit Vergleichsanalysen über die Zeit konsistent bleiben."
              : "Also not automated: the capital market assumptions (long-term expected returns, volatilities, correlations) and the stress scenarios. These are drawn from the publicly published Long-Term Capital Market Assumptions of major asset managers and are deliberately kept stable so that comparison analyses stay consistent over time."}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Bei Standardauslieferung sind beide Snapshot-Dateien leer — die App nutzt dann die im Code hinterlegten Default-Werte. Sobald die Refresh-Jobs erstmals liefen, werden die geholten Felder per ISIN auf die Default-Werte gelegt; alles andere bleibt deterministisch. Schlägt ein einzelner Scrape-Lauf fehl (z. B. justETF ändert das Markup), bleibt der zuletzt erfolgreiche Wert stehen — es wird kein Müll geschrieben."
              : "On a fresh checkout both snapshot files are empty — the app then uses the in-code default values. Once the refresh jobs have run at least once, the fetched fields override the defaults per ISIN; everything else stays deterministic. If a single scrape run fails (e.g. justETF changes its markup), the last successful value is preserved — no junk is ever written."}
          </p>
        </Section>

        <Section
          value="construction"
          icon={<Layers className="h-4 w-4" />}
          title={de ? "Portfolio-Konstruktion" : "Portfolio Construction"}
          editable
          editableLabel={de ? "Home-Bias editierbar" : "Home-bias editable"}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Die regionalen Aktiengewichte sind nicht hartkodiert. Basis ist das globale Marktportfolio (annähernd MSCI-ACWI-Anteile) — die kanonische 'neutrale' Allokation der modernen Portfoliotheorie. Darauf werden dokumentierte Aktiv-Tilts angewandt: Sharpe-Aufschlag, Heimatmarkt-Bias, Horizont- und Themen-Tilt, sowie eine Konzentrationsobergrenze."
              : "Regional equity weights are not hard-coded. The baseline is the global market portfolio (approximate MSCI ACWI shares) — the canonical 'neutral' allocation in modern portfolio theory. Documented active tilts are then applied: Sharpe overlay, home-bias, horizon and theme tilts, and a concentration cap."}
          </p>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Region" : "Region"}</TableHead>
                  <TableHead className="text-right">{de ? "Anker (USD/EUR/GBP)" : "Anchor (USD/EUR/GBP)"}</TableHead>
                  <TableHead className="text-right">{de ? "Anker (CHF)" : "Anchor (CHF)"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell className="text-xs">USA</TableCell><TableCell className="text-right font-mono text-xs">60%</TableCell><TableCell className="text-right font-mono text-xs">60%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Europa" : "Europe"}</TableCell><TableCell className="text-right font-mono text-xs">13%</TableCell><TableCell className="text-right font-mono text-xs">10%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Schweiz" : "Switzerland"}</TableCell><TableCell className="text-right font-mono text-xs">—</TableCell><TableCell className="text-right font-mono text-xs">4%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">Japan</TableCell><TableCell className="text-right font-mono text-xs">5%</TableCell><TableCell className="text-right font-mono text-xs">5%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Schwellenländer" : "Emerging Markets"}</TableCell><TableCell className="text-right font-mono text-xs">11%</TableCell><TableCell className="text-right font-mono text-xs">11%</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          <ol className="text-sm space-y-2 list-decimal pl-5">
            <li>
              <span className="font-semibold">{de ? "Marktkapitalisierungs-Anker" : "Market-cap anchor"}</span>{" — "}
              {de
                ? "Ausgangsgewichte folgen dem globalen Marktportfolio (MSCI-ACWI-Proxy oben). In CHF-Portfolios wird der Schweiz-Anteil aus Europa herausgelöst."
                : "Starting weights follow the global market portfolio (MSCI ACWI proxy above). For CHF portfolios, the Switzerland share is carved out of Europe."}
            </li>
            <li>
              <span className="font-semibold">{de ? "Sharpe-Tilt (gedämpft)" : "Sharpe tilt (damped)"}</span>{" — "}
              {de
                ? "Multiplikator (Sharpe / 0,25)^0,4 begünstigt Märkte mit besserer risikoadjustierter Renditeerwartung, ohne die Anker-Allokation auszuhebeln."
                : "Multiplier (Sharpe / 0.25)^0.4 favours markets with better risk-adjusted expected return without overriding the anchor allocation."}
            </li>
            <li>
              <span className="font-semibold">{de ? "Heimatmarkt-Bias" : "Home-bias overlay"}</span>{" — "}
              {de
                ? "Verstärkt die heimische Aktien-Region je Basiswährung. Multiplikatoren in der Tabelle unten, je Währung live editierbar; Änderungen wirken beim nächsten Klick auf „Portfolio generieren“."
                : "Amplifies the home equity region per base currency. Multipliers in the table below, live-editable per currency; changes take effect the next time you click \"Generate Portfolio\"."}
            </li>
            <li>
              <span className="font-semibold">{de ? "Horizont- & Themen-Tilts" : "Horizon & theme tilts"}</span>{" — "}
              {de
                ? "Lange Anlagehorizonte erhöhen EM, das Nachhaltigkeits-Thema dämpft USA (exakte Faktoren in der Tabelle unten)."
                : "Long horizons lift EM, the sustainability theme dampens USA (exact factors in the table below)."}
            </li>
            <li>
              <span className="font-semibold">{de ? "Konzentrationsgrenze" : "Concentration cap"}</span>{" — "}
              {de
                ? "Pro Aktien-Region greift eine Obergrenze; Überschuss wird proportional auf die übrigen Regionen verteilt."
                : "A per-region cap applies on the equity sleeve; excess is redistributed proportionally to the other regions."}
            </li>
          </ol>
          <Formula
            label={de ? "Roh-Gewicht je Region" : "Raw weight per region"}
            expr="rawᵢ = anchorᵢ · ((Sharpeᵢ/0.25)^0.4) · home · horizon · theme  →  normalize  →  cap at 65%"
          />
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Overlay-Konstante" : "Overlay constant"}</TableHead>
                  <TableHead className="text-right">{de ? "Wert" : "Value"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {HB_CURRENCIES.map((c) => {
                  const live = resolvedHomeBias(c);
                  const isOverride = hbOverrides[c] !== undefined;
                  const region = de ? HB_REGION_LABEL_DE[c] : HB_REGION_LABEL[c];
                  return (
                    <TableRow key={`hb-${c}`}>
                      <TableCell className="text-xs">
                        {de ? "Home-Bias" : "Home tilt"} {c} → {region}
                        {isOverride && (
                          <Badge variant="default" className="ml-2 text-[10px] px-1.5 py-0">
                            {de ? "Eigene" : "Custom"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">× {live.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow><TableCell className="text-xs">Long-horizon EM tilt (h ≥ 10)</TableCell><TableCell className="text-right font-mono text-xs">× 1.3</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">Sustainability theme on USA</TableCell><TableCell className="text-right font-mono text-xs">× 0.85</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Konzentrationsgrenze pro Region" : "Concentration cap per region"}</TableCell><TableCell className="text-right font-mono text-xs">≤ 65%</TableCell></TableRow>
                <TableRow>
                  <TableCell className="text-xs">
                    {de ? "Risikofreier Zins (Sharpe-Tilt, je Basiswährung)" : "Risk-free rate (Sharpe tilt, per base currency)"}
                    <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      {de
                        ? "Verwendet je Basiswährung denselben oben editierbaren RF wie die Report-Kennzahlen. Eine Änderung verschiebt die Bucket-Gewichte beim nächsten Klick auf „Portfolio generieren\u201C."
                        : "Uses, per base currency, the same editable RF as the report metrics. Changing it shifts the bucket weights on the next \"Generate Portfolio\" click."}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs align-top">
                    {RF_CURRENCIES.map((c) => (
                      <div key={`construction-rf-${c}`}>{c} {(rfRates[c] * 100).toFixed(2)}%</div>
                    ))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Defensiv-Sleeve (Cash & Anleihen), Satelliten-Sleeves (REIT 6 %, Krypto 1–3 %, Thematik 3–5 %, Gold ≤ 5 %) und Risikoobergrenzen sind weiterhin regelbasiert wie im übrigen Methodik-Dokument beschrieben."
              : "The defensive sleeve (cash & bonds), satellite sleeves (REIT 6%, Crypto 1–3%, Thematic 3–5%, Gold ≤ 5%) and risk caps remain rule-based as documented in the rest of this methodology."}
          </p>

          {/* ---------- Live home-bias multiplier editor ---------- */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-3" data-testid="home-bias-editor">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {de ? "Home-Bias-Multiplikatoren" : "Home-bias multipliers"}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {de ? "Bereich 0,0 – 5,0" : "range 0.0 – 5.0"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Pro Basiswährung den Verstärkungsfaktor auf die heimische Aktien-Region setzen. Änderungen wirken beim nächsten Klick auf „Portfolio generieren“."
                : "Set the amplification factor on the home equity region per base currency. Changes take effect the next time you click \"Generate Portfolio\"."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {HB_CURRENCIES.map((c) => {
                const isOverride = hbOverrides[c] !== undefined;
                const region = de ? HB_REGION_LABEL_DE[c] : HB_REGION_LABEL[c];
                const def = HOME_BIAS_DEFAULTS[c];
                return (
                  <div key={`hb-edit-${c}`} className="space-y-1">
                    <Label htmlFor={`hb-${c}`} className="text-xs flex items-center gap-1.5">
                      <span className="font-mono">{c}</span>
                      <span className="text-muted-foreground">→ {region}</span>
                      {isOverride && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          {de ? "Eigene" : "Custom"}
                        </Badge>
                      )}
                    </Label>
                    <Input
                      id={`hb-${c}`}
                      type="text"
                      inputMode="decimal"
                      value={hbDraft[c]}
                      onChange={(e) => setHbDraft((d) => ({ ...d, [c]: e.target.value }))}
                      className="h-8 font-mono text-sm"
                      data-testid={`input-home-bias-${c}`}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {de ? "Default" : "default"} × {def.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={applyHbDraft} data-testid="button-home-bias-apply">
                {de ? "Übernehmen" : "Apply"}
              </Button>
              <Button size="sm" variant="outline" onClick={resetHb} data-testid="button-home-bias-reset">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {de ? "Auf Defaults zurücksetzen" : "Reset to defaults"}
              </Button>
              <span className="text-[10px] text-muted-foreground">
                {de
                  ? "Hinweis: Wirkung erst nach erneutem „Portfolio generieren\"."
                  : "Note: takes effect after re-running \"Generate Portfolio\"."}
              </span>
            </div>
          </div>
        </Section>

        <Section
          value="cma"
          icon={<Database className="h-4 w-4" />}
          title={de ? "Kapitalmarktannahmen (CMAs)" : "Capital Market Assumptions (CMAs)"}
          editable
          editableLabel={de ? "μ / σ editierbar" : "μ / σ editable"}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Langfristige erwartete Renditen und Volatilitäten je Anlageklasse. Bewusst konservativ und stabil über die Zeit. Diese Werte stammen NICHT aus Live-Daten – sie sind handgepflegte Konsens-Schätzungen aus öffentlich publizierten Long-Term Capital Market Assumptions großer Asset Manager."
              : "Long-run expected returns and volatilities per asset class. Deliberately conservative and stable over time. These values are NOT live — they are hand-curated consensus estimates drawn from publicly published Long-Term Capital Market Assumptions of major asset managers."}
          </p>
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1.5">
            <div className="font-semibold uppercase tracking-wider text-[10px] text-primary/80">
              {de ? "Wo diese Werte im Tool verwendet werden" : "Where these values are used in the tool"}
            </div>
            <ul className="space-y-1 list-disc pl-4 text-muted-foreground">
              <li>{de
                ? <><span className="font-medium text-foreground">Portfolio-Konstruktion (Build-Tab):</span> μ und σ jeder Anlageklasse speisen die Sharpe-Ratio, mit der die Engine Bucket-Gewichte priorisiert.</>
                : <><span className="font-medium text-foreground">Portfolio construction (Build tab):</span> each asset class's μ and σ feed the Sharpe ratio that the engine uses to prioritise bucket weights.</>}</li>
              <li>{de
                ? <><span className="font-medium text-foreground">Risiko- & Performance-Kennzahlen (Report-Tab):</span> erwartete Portfolio-Rendite Σᵢ wᵢ·μᵢ und alle σₚ-abgeleiteten Kennzahlen (Sharpe, Beta, Alpha, Tracking Error) — vollständige Formeln im Abschnitt „Formeln“ weiter unten.</>
                : <><span className="font-medium text-foreground">Risk & Performance Metrics (Report tab):</span> expected portfolio return Σᵢ wᵢ·μᵢ and every σₚ-derived metric (Sharpe, beta, alpha, tracking error) — full formulas in the "Formulas" section below.</>}</li>
              <li>{de
                ? <><span className="font-medium text-foreground">Monte-Carlo-Simulation:</span> μ ist der Drift, σ fließt — über die Korrelationsmatrix — in die Portfolio-σₚ. FX-Hedging beeinflusst σ separat (Details: Abschnitt „Währungs-Hedging“).</>
                : <><span className="font-medium text-foreground">Monte Carlo simulation:</span> μ is the drift; σ feeds — via the correlation matrix — the portfolio σₚ. FX hedging affects σ separately (details: "Currency Hedging" section).</>}</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {de ? "Hauptquellen (öffentlich)" : "Primary sources (public)"}
            </div>
            <ul className="text-xs space-y-1">
              <li className="flex items-center gap-2"><ExternalLink className="h-3 w-3" /> BlackRock Investment Institute — Capital Market Assumptions</li>
              <li className="flex items-center gap-2"><ExternalLink className="h-3 w-3" /> J.P. Morgan Asset Management — Long-Term Capital Market Assumptions</li>
              <li className="flex items-center gap-2"><ExternalLink className="h-3 w-3" /> Vanguard — Capital Markets Model & Investment Outlook</li>
              <li className="flex items-center gap-2"><ExternalLink className="h-3 w-3" /> Schroders, Robeco, AQR — Expected Returns publications</li>
            </ul>
          </div>
          {/* ---------- Multi-provider Consensus status (Option A) ---------- */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="cma-consensus-status">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{de ? "Anbieter-Konsens" : "Multi-provider consensus"}</span>
              {consensus.hasConsensus ? (
                <>
                  <Badge variant="secondary" className="text-[10px]">{de ? "geladen" : "loaded"}</Badge>
                  {consensus.lastReviewed && (
                    <span className="text-xs text-muted-foreground">
                      {de ? "Stand:" : "as of:"} {consensus.lastReviewed}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    · {de ? "Quellen" : "providers"}: {consensus.providers.length}
                  </span>
                </>
              ) : (
                <Badge variant="outline" className="text-[10px]">{de ? "leer – Engine-Defaults aktiv" : "empty — engine defaults active"}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {consensus.hasConsensus
                ? (de
                    ? "Die unten angezeigten μ und σ stammen aus dem gemittelten Konsens der gelisteten Anbieter, sofern keine eigenen Werte gesetzt sind."
                    : "The μ and σ shown below are drawn from the averaged consensus of the listed providers unless you have set your own values.")
                : (de
                    ? "Aktuell sind keine Konsens-Werte hinterlegt. Die Engine verwendet die handgepflegten Default-Werte. Wartung erfolgt jährlich aus den öffentlich publizierten LTCMA-Reports der oben gelisteten Anbieter (siehe DOCUMENTATION.md §5.3)."
                    : "No consensus values are loaded right now. The engine uses the hand-curated defaults. Maintenance happens yearly from the publicly published LTCMA reports of the providers listed above (see DOCUMENTATION.md §5.3).")}
            </p>
            {consensus.hasConsensus && consensus.providers.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold">{de ? "Eingeflossene Anbieter:" : "Sources mixed in:"}</span>{" "}
                {consensus.providers.join(" · ")}
              </div>
            )}
          </div>

          {/* ---------- Editable CMA table (Option B) ---------- */}
          <div className="rounded-md border overflow-x-auto" data-testid="cma-editor">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Anlageklasse" : "Asset Class"}</TableHead>
                  <TableHead className="text-right">{de ? "Aktiv μ" : "Active μ"}</TableHead>
                  <TableHead className="text-right">{de ? "Aktiv σ" : "Active σ"}</TableHead>
                  <TableHead className="w-[120px]">{de ? "Eigene μ %" : "Custom μ %"}</TableHead>
                  <TableHead className="w-[120px]">{de ? "Eigene σ %" : "Custom σ %"}</TableHead>
                  <TableHead>{de ? "Quelle" : "Source"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(CMA) as AssetKey[]).map((k) => {
                  const seed = getCMASeed(k);
                  const src = cmaSources[k];
                  return (
                    <TableRow key={k}>
                      <TableCell className="font-medium text-xs">
                        <div>{CMA[k].label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {de ? "Seed" : "Seed"}: {fmtPct(seed.expReturn)}% / {fmtPct(seed.vol, 1)}%
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtPct(CMA[k].expReturn)}%</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtPct(CMA[k].vol, 1)}%</TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={fmtPct(CMA[k].expReturn)}
                          value={cmaDraft[k].mu}
                          onChange={(e) => setCmaDraft((d) => ({ ...d, [k]: { ...d[k], mu: e.target.value } }))}
                          className="h-7 text-xs font-mono w-full"
                          data-testid={`cma-mu-${k}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={fmtPct(CMA[k].vol, 1)}
                          value={cmaDraft[k].sigma}
                          onChange={(e) => setCmaDraft((d) => ({ ...d, [k]: { ...d[k], sigma: e.target.value } }))}
                          className="h-7 text-xs font-mono w-full"
                          data-testid={`cma-sigma-${k}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] text-muted-foreground">μ</span>{sourceBadge(src.expReturnSource)}
                          <span className="text-[10px] text-muted-foreground ml-1">σ</span>{sourceBadge(src.volSource)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {de
                ? "Lass die Felder leer, um den Konsens- bzw. Engine-Wert zu nutzen. Eigene Werte werden lokal in deinem Browser gespeichert (localStorage) und überschreiben die Defaults überall in der App."
                : "Leave fields empty to use the consensus or engine value. Custom values are stored locally in your browser (localStorage) and override the defaults everywhere in the app."}
            </p>
            <div className="flex gap-2">
              {userOverrideCount > 0 && (
                <Badge variant="default" className="text-[10px]" data-testid="cma-override-count">
                  {userOverrideCount} {de ? "Override(s) aktiv" : "override(s) active"}
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={resetCma} disabled={userOverrideCount === 0} data-testid="cma-reset">
                <RotateCcw className="h-3 w-3 mr-1" />
                {de ? "Zurücksetzen" : "Reset"}
              </Button>
              <Button size="sm" onClick={applyCmaDraft} data-testid="cma-apply">
                {de ? "Übernehmen" : "Apply"}
              </Button>
            </div>
          </div>

          {/* ---------- Per-asset notes (collapsed in accordion to save space) ---------- */}
          <Accordion type="single" collapsible>
            <AccordionItem value="cma-notes">
              <AccordionTrigger className="text-xs">{de ? "Anmerkungen je Anlageklasse" : "Per asset class notes"}</AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{de ? "Anlageklasse" : "Asset Class"}</TableHead>
                        <TableHead>{de ? "Anmerkung" : "Note"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(Object.keys(CMA) as AssetKey[]).map((k) => (
                        <TableRow key={k}>
                          <TableCell className="font-medium text-xs">{CMA[k].label}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{noteFor(k, de)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        <Section value="corr" icon={<GitCompare className="h-4 w-4" />} title={de ? "Korrelationsmatrix" : "Correlation Matrix"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Paarweise Langfrist-Korrelationen ρᵢⱼ zwischen Anlageklassen, statisch hinterlegt. Die Diversifikationseffekte im Tool entstehen ausschließlich durch die Off-Diagonal-Werte unter 1,0. In Liquiditätskrisen tendieren reale Korrelationen gegen 1 – das spiegelt diese Matrix nicht wider, der Stress-Test schon."
              : "Pairwise long-run correlations ρᵢⱼ between asset classes, stored statically. Every diversification effect in the tool comes from the off-diagonal cells being below 1.0. In liquidity crises real-world correlations rise toward 1 — this matrix does not reflect that, the stress test does."}
          </p>
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1.5">
            <div className="font-semibold uppercase tracking-wider text-[10px] text-primary/80">
              {de ? "Wo diese Matrix im Tool verwendet wird" : "Where this matrix is used in the tool"}
            </div>
            <ul className="space-y-1 list-disc pl-4 text-muted-foreground">
              <li>{de
                ? <><span className="font-medium text-foreground">Report-Tab & Monte-Carlo:</span> die Off-Diagonal-Werte unter 1,0 sind die einzige Quelle des Diversifikationseffekts. Sie speisen σₚ und damit jede σₚ-abgeleitete Kennzahl sowie die GBM-Pfade (Formel im Abschnitt „Formeln“).</>
                : <><span className="font-medium text-foreground">Report tab & Monte Carlo:</span> the off-diagonal values below 1.0 are the sole source of the diversification effect. They feed σₚ — and therefore every σₚ-derived metric and the GBM paths (formula in the "Formulas" section).</>}</li>
              <li>{de
                ? <><span className="font-medium text-foreground">Was diese Matrix NICHT antreibt:</span> die Bucket-Gewichte selbst (Construction-Engine nutzt nur μ, σ, Sharpe), die Stress-Szenarien (eigene Schock-Tabelle) und die FX-Hedge-Option (eigene Sektion).</>
                : <><span className="font-medium text-foreground">What this matrix does NOT drive:</span> the bucket weights themselves (the construction engine only uses each class's μ, σ and Sharpe), the stress scenarios (own shock table), and the FX-hedge option (own section).</>}</li>
            </ul>
          </div>
          <div className="text-xs text-muted-foreground">
            {de ? "Quelle" : "Source"}: {de ? "Empirische Schätzungen aus typischen Marktphasen 2000–2024 (MSCI, Bloomberg, FTSE Russell Index-Daten)." : "Empirical estimates from typical 2000–2024 regime data (MSCI, Bloomberg, FTSE Russell index series)."}
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  {sampleCorr.labels.map((l, idx) => (
                    <TableHead
                      key={l}
                      className={`text-right text-[10px] uppercase ${corrReflectsPortfolio && sampleCorr.held[idx] ? "text-foreground font-semibold" : "text-muted-foreground/70"}`}
                    >
                      {l}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleCorr.matrix.map((row, i) => (
                  <TableRow
                    key={i}
                    data-held={corrReflectsPortfolio && sampleCorr.held[i] ? "true" : "false"}
                    className={corrReflectsPortfolio && !sampleCorr.held[i] ? "opacity-60" : ""}
                  >
                    <TableCell className={`text-xs ${corrReflectsPortfolio && sampleCorr.held[i] ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                      {sampleCorr.labels[i]}
                      {corrReflectsPortfolio && sampleCorr.held[i] && <span className="ml-1 text-[9px] text-primary/80 align-top">●</span>}
                    </TableCell>
                    {row.map((v, j) => (
                      <TableCell key={j} className="text-right font-mono text-xs">{v.toFixed(2)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {corrReflectsPortfolio
              ? <><span className="text-primary/80">●</span> {de ? "Markierte Zeilen/Spalten sind die in Ihrem aktuellen Portfolio (Tab Build) tatsächlich gehaltenen Anlageklassen." : "Marked rows/columns are the asset classes actually held in your current portfolio (Build tab)."}</>
              : (de ? "Hinweis: Sobald Sie im Tab Build ein Portfolio erzeugen, werden die tatsächlich gehaltenen Anlageklassen hier hervorgehoben." : "Note: once you build a portfolio in the Build tab, the asset classes actually held will be highlighted here.")}
          </p>
        </Section>

        <Section value="bench" icon={<Layers className="h-4 w-4" />} title={de ? "Benchmark (MSCI ACWI Proxy)" : "Benchmark (MSCI ACWI Proxy)"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Beta, Alpha, Tracking Error und Outperformance werden gegen einen statischen MSCI ACWI Proxy gemessen. Die Gewichte spiegeln grobe regionale Anteile des Index Mitte 2024."
              : "Beta, Alpha, Tracking Error and Outperformance are measured against a static MSCI ACWI proxy. Weights reflect approximate regional shares of the index in mid-2024."}
          </p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Region" : "Region"}</TableHead>
                  <TableHead className="text-right">{de ? "Gewicht" : "Weight"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BENCHMARK.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell className="text-xs">{regionLabel(b.key, de)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{(b.weight * 100).toFixed(0)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {de ? "Quelle" : "Source"}: MSCI ACWI Index Factsheet (msci.com), {de ? "öffentlich zugänglich" : "publicly available"}.
          </p>
        </Section>

        <Section value="stress" icon={<ShieldQuestion className="h-4 w-4" />} title={de ? "Stress-Test-Szenarien" : "Stress Test Scenarios"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Historische Drawdowns je Anlageklasse aus drei prägenden Krisen. Werte sind handgepflegte, abgerundete Schock-Vektoren basierend auf Index-Verläufen vom Hoch zum Tief."
              : "Historical drawdowns per asset class from three formative crises. Values are hand-curated, rounded shock vectors based on peak-to-trough index moves."}
          </p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Szenario" : "Scenario"}</TableHead>
                  <TableHead>{de ? "Quelle / Indizes" : "Source / Indices"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SCENARIOS.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="text-xs font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{scenarioSource(s.name, de)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section value="mc" icon={<Calculator className="h-4 w-4" />} title={de ? "Monte-Carlo-Simulation" : "Monte Carlo Simulation"}>
          <ul className="text-sm space-y-2 list-disc pl-5">
            <li>{de ? "Verteilung: log-normale jährliche Renditen pro Anlageklasse, gezogen aus der CMA-Tabelle (μ und σ wie oben)." : "Distribution: log-normal annual returns per asset class, drawn from the CMA table above (μ and σ as listed)."}</li>
            <li>{de ? "Korrelation: die Portfolio-Volatilität σₚ wird vorab aus der vollständigen Korrelationsmatrix berechnet (Formel im Abschnitt „Formeln“); anschließend wird das Portfolio als Ganzes simuliert (eine Gauß-Ziehung pro Jahr)." : "Correlation: portfolio volatility σₚ is computed up front from the full correlation matrix (formula in the \"Formulas\" section); the portfolio is then simulated as a single asset (one Gaussian draw per year)."}</li>
            <li>{de ? "Pfade: 2.000 unabhängige Pfade über den Anlagehorizont des Nutzers." : "Paths: 2,000 independent paths over the user's chosen horizon."}</li>
            <li>{de ? "Ausgewiesen: Median, P10, P90, Wahrscheinlichkeit eines Verlusts." : "Reported: median, P10, P90, probability of loss."}</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Limitierung: ohne Tail-Korrelationen, ohne Inflations-/Steuermodell, ohne Sequence-of-Returns-Pfade über Cash-Flows."
              : "Limitations: no tail correlations, no inflation/tax model, no cash-flow sequence-of-returns modelling."}
          </p>
        </Section>

        <Section value="hedging" icon={<Coins className="h-4 w-4" />} title={de ? "Währungs-Hedging — was der Schalter wirklich tut" : "Currency Hedging — what the toggle actually does"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Der Hedging-Schalter im Portfolio-Builder greift an vier Stellen gleichzeitig in die Berechnung ein. Er wirkt nur, wenn die Basiswährung nicht USD ist (USD-Anleger gelten in US-Equity per Definition als „home“)."
              : "The hedging toggle in the portfolio builder feeds four downstream calculations at once. It only fires when the base currency is non-USD (a USD investor in US equity is by definition already \"home\")."}
          </p>
          <ul className="text-sm space-y-2 list-disc pl-5">
            <li>
              {de
                ? <><span className="font-medium text-foreground">Monte-Carlo-Simulation:</span> für Aktien-Buckets, deren Region nicht der Basiswährung entspricht, wird σ um −3 Prozentpunkte gesenkt (Emerging Markets: −2 pp), mit Untergrenze 5 %. μ bleibt unverändert. Effekt: schmalerer Fan, niedrigeres VaR/MaxDD, gleicher Median. Bonds, Gold, REITs und Crypto bleiben in der MC unangetastet — die σ-Reduktion gilt nur für equity_*-Buckets.</>
                : <><span className="font-medium text-foreground">Monte Carlo simulation:</span> for equity buckets whose region differs from the base currency, σ is cut by 3 percentage points (emerging markets: 2 pp), with a 5% floor. μ stays unchanged. Effect: tighter fan, lower VaR/MaxDD, same median. Bonds, gold, REITs and crypto are not touched in the MC — the σ cut only applies to equity_* buckets.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Gebühren-Schätzer:</span> +15 Basispunkte TER pauschal auf jede hedgebare Anlageklasse (Equity, Fixed Income, Real Estate). Cash, Commodities und Digital Assets bekommen keinen Aufschlag. Diese Mehrkosten erscheinen direkt im Fee-Estimator und in der Rendite-nach-Kosten-Projektion.</>
                : <><span className="font-medium text-foreground">Fee estimator:</span> a flat +15 bps TER is added to every hedgeable asset class (Equity, Fixed Income, Real Estate). Cash, commodities and digital assets get no surcharge. The extra cost shows up directly in the fee estimator and in the after-fee return projection.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">ETF-Empfehlungen:</span> die Bucket→ETF-Logik schwenkt auf hedged Share Classes um — z. B. iShares S&P 500 EUR Hedged statt der unhedged USD-Variante, oder iShares Global Aggregate Bond CHF Hedged statt der unhedged Global-Aggregate. Die Logik nutzt explizit die Bucket-Schlüssel Equity-USA-EUR/CHF/GBP und FixedIncome-Global-EUR/CHF/GBP, fällt aber sauber auf die unhedged Variante zurück, falls für eine Basiswährung keine hedged Anteilsklasse im Katalog ist.</>
                : <><span className="font-medium text-foreground">ETF recommendations:</span> the bucket→ETF mapping switches to hedged share classes — e.g. \"iShares S&P 500 EUR Hedged\" instead of the unhedged USD version, or \"iShares Global Aggregate Bond CHF Hedged\" instead of the unhedged Global Aggregate. It explicitly looks up the bucket keys Equity-USA-EUR/CHF/GBP and FixedIncome-Global-EUR/CHF/GBP, but falls back cleanly to the unhedged variant if a hedged share class is not in the catalog for the chosen base currency.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Risiko-/Diversifikations-Hinweise:</span> der Warntext „Currency Risk: Unhedged foreign equity exposure…" und der Diversifikations-Hinweis „Unhedged equities can act as a diversifier…" werden ausgeblendet, sobald Hedging an ist — beide werden durch den Schalter gegenstandslos.</>
                : <><span className="font-medium text-foreground">Risk / diversification copy:</span> the \"Currency Risk: Unhedged foreign equity exposure…\" warning and the \"Unhedged equities can act as a diversifier…\" hint both disappear once hedging is on — the toggle makes both points moot.</>}
            </li>
          </ul>
          <p className="text-sm text-muted-foreground pt-2">
            {de ? "Was der Schalter bewusst NICHT tut:" : "What the toggle deliberately does NOT do:"}
          </p>
          <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
            <li>{de ? "μ (Erwartungsrendite) wird nicht reduziert — die Hedging-Kosten schlagen ausschließlich über die +15-bp-TER durch, nicht über eine niedrigere CMA-Annahme." : "μ (expected return) is not reduced — the hedging cost only flows through the +15 bp TER, not through a lower CMA assumption."}</li>
            <li>{de ? "Korrelationen werden nicht angepasst (nur die Diagonal-Vola der betroffenen Equity-Buckets)." : "Correlations are not adjusted (only the diagonal vol of the affected equity buckets)."}</li>
            <li>{de ? "Bei Basiswährung USD passiert nichts — der Schalter wird wirkungslos." : "When the base currency is USD, the toggle is a no-op."}</li>
            <li>{de ? "Look-Through-Daten ändern sich nicht (gleicher Underlying-Basket; nur die FX-Exposition der hedged Anteilsklassen wird in der Look-Through-Währungstabelle bewusst auf die Anteilsklassen-Währung gemappt — siehe Abschnitt zur Look-Through-Datenpflege)." : "Look-through data does not change (same underlying basket; only the FX exposure of hedged share classes is intentionally mapped to the share-class currency in the look-through currency table — see the look-through data maintenance section)."}</li>
          </ul>
        </Section>

        <Section value="formulas" icon={<Calculator className="h-4 w-4" />} title={de ? "Formeln" : "Formulas"}>
          <div className="space-y-3 text-sm">
            <Formula label="Expected Return" expr="E[Rₚ] = Σᵢ wᵢ · μᵢ" />
            <Formula label="Volatility" expr="σₚ = √(Σᵢ Σⱼ wᵢ wⱼ σᵢ σⱼ ρᵢⱼ)" />
            <Formula label="Sharpe Ratio" expr="(E[Rₚ] − Rf) / σₚ" />
            <Formula label="Beta vs benchmark" expr="βₚ = Cov(Rₚ, R_b) / Var(R_b)" />
            <Formula label="Alpha (Jensen)" expr="αₚ = E[Rₚ] − [Rf + βₚ · (E[R_b] − Rf)]" />
            <Formula label="Tracking Error" expr="TE = √(σₚ² + σ_b² − 2·Cov(Rₚ, R_b))" />
            <Formula label="Max Drawdown (heuristic)" expr="MDD ≈ −min(0.85, (1.8 + 1.4 · equityShare) · σₚ)" />
          </div>
        </Section>

        <Section
          value="etfs"
          icon={<Building2 className="h-4 w-4" />}
          title={de ? "ETF-Katalog" : "ETF Catalog"}
          editable
          editableLabel={de ? "Lokal überschreibbar" : "Locally overridable"}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Reale UCITS-ETFs der Emittenten iShares, SPDR, Invesco, UBS und CoinShares mit ISIN, Tickern je Börse, Domizil, Replikationsmethode, Ausschüttungspolitik, Fondswährung, TER, Fondsvolumen, Auflagedatum und einer kurzen redaktionellen Auswahlbegründung."
              : "Real UCITS ETFs from the issuers iShares, SPDR, Invesco, UBS and CoinShares with ISIN, per-exchange tickers, domicile, replication method, distribution policy, fund currency, TER, fund size, inception date and a short editorial rationale for why the fund was picked."}
          </p>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Hybrider Pflegemodus: Werte, die sich häufig bewegen, werden automatisch aus justETF aktualisiert (TER, AUM, Auflagedatum, Ausschüttung, Replikation – wöchentlich; Listings je Börse – täglich; Look-Through-Daten und Top-10-Holdings – monatlich). Werte, die redaktionelle Entscheidungen darstellen (Fondsauswahl je Anlageklasse, Standardbörse, Auswahlbegründung, Hedge-Währung), bleiben in Code gepflegt. Details siehe Abschnitt „Datenpflege & Aktualität (Snapshot-Build)“ oben."
              : "Hybrid maintenance mode: values that move regularly are refreshed automatically from justETF (TER, AUM, inception, distribution and replication — weekly; per-exchange listings — daily; look-through breakdowns and top-10 holdings — monthly). Values that represent editorial decisions (which fund to use per asset class, the default exchange, the selection rationale, and the hedge-currency mapping) stay curated in code. See the \"Data Refresh & Freshness (snapshot build)\" section above for the full schedule."}
          </p>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>{de ? "Quelle" : "Source"}: {de ? "Offizielle Emittenten-Factsheets (für die kuratierten Felder) und justETF (für alle automatisch aktualisierten Felder; öffentlich, indikativ)." : "Issuer official factsheets (for the curated fields) and justETF (for every automatically refreshed field; public, indicative)."}</div>
            <div className="text-amber-700 dark:text-amber-400">
              {de
                ? "Wichtig: Auch die automatischen Snapshots sind nur so frisch wie der letzte erfolgreiche Refresh-Lauf. Vor jedem Kauf bitte die Live-Daten beim Emittenten oder Broker prüfen — insbesondere TER, Listings und Verfügbarkeit in Ihrer Jurisdiktion."
                : "Important: even the automatic snapshots are only as fresh as the last successful refresh run. Always verify live data with the issuer or broker before any purchase — especially TER, listings and availability in your jurisdiction."}
            </div>
          </div>
          <p className="text-sm text-muted-foreground pt-2">
            {de
              ? "Vollständige Übersicht aller Allokations-Buckets der Engine, gruppiert nach Anlageklasse. Pro Bucket zeigt der Baum den aktuell hinterlegten ETF (Name + Katalog-Schlüssel). Über „Ersetzen“ können Sie eine eigene ISIN eintragen, mit den Live-Daten von justETF vergleichen und den Bucket lokal in Ihrem Browser umstellen — die Empfehlungs-Liste, die Gebühren-Berechnung (TER) und der Look-Through-Tab übernehmen den Wechsel sofort. Die Monte-Carlo-Simulation rechnet bewusst auf Asset-Class-Ebene (μ/σ aus den CMA-Annahmen je Bucket) und ändert sich daher nicht, wenn Sie innerhalb desselben Buckets einen anderen ETF wählen."
              : "Full view of every allocation bucket the engine knows about, grouped by asset class. Each leaf shows the currently selected ETF (name + catalog key). The Override button lets you type a new ISIN, compare it side-by-side with the live justETF data and swap the bucket locally in your browser — the recommendation list, the fee calculation (TER) and the look-through tab reflect the change immediately. The Monte Carlo simulation deliberately runs at the asset-class level (μ/σ from the CMA assumptions per bucket), so it does not move when you swap one ETF for another within the same bucket."}
          </p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-3" data-testid="etf-buckets-panel">
            <div className="flex flex-wrap items-center gap-2">
              <Replace className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {de ? "Bucket-Baum" : "Bucket tree"}
              </span>
              {etfOverrideCount > 0 && (
                <Badge variant="default" className="text-[10px]" data-testid="badge-override-count">
                  {etfOverrideCount} {de ? "Override(s) aktiv" : "override(s) active"}
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                <BucketTreeBulkToggle
                  groups={bucketGroups}
                  expanded={bucketsExpanded}
                  onChange={setBucketsExpanded}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => clearAllETFOverrides()}
                  disabled={etfOverrideCount === 0}
                  data-testid="button-reset-all-overrides"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {de ? "Alle zurücksetzen" : "Reset all"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Vor jedem realen Kauf bitte ISIN, TER und Verfügbarkeit beim Broker verifizieren."
                : "Always re-verify ISIN, TER and broker availability before any real-world purchase."}
            </p>
            <BucketTree
              groups={bucketGroups}
              expanded={bucketsExpanded}
              onToggleClass={(ac) =>
                setBucketsExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(ac)) {
                    next.delete(ac);
                  } else {
                    next.add(ac);
                  }
                  return next;
                })
              }
              renderLeafBadge={(leaf) =>
                etfOverrides[leaf.key] ? (
                  <Badge
                    variant="default"
                    className="ml-2 text-[10px] px-1.5 py-0"
                    data-testid={`badge-overridden-${leaf.key}`}
                  >
                    {de ? "Eigene" : "Overridden"}
                  </Badge>
                ) : null
              }
              renderLeafAction={(leaf) => (
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => openOverrideDialog(leaf)}
                    data-testid={`button-override-${leaf.key}`}
                  >
                    {de ? "Ersetzen" : "Override"}
                  </Button>
                  {etfOverrides[leaf.key] && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => clearETFOverride(leaf.key)}
                      data-testid={`button-reset-${leaf.key}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </span>
              )}
            />
          </div>
        </Section>

        <Section value="limits" icon={<AlertTriangle className="h-4 w-4" />} title={de ? "Was diese App NICHT tut" : "What this app does NOT do"}>
          <ul className="text-sm space-y-2 list-disc pl-5">
            <li>{de ? "Kein Live-Marktdaten-Feed (Kurse, NAVs, Renditen, Volatilitäten)." : "No live market data feed (prices, NAVs, yields, volatilities)."}</li>
            <li>{de ? "Keine personenbezogene Anlageberatung – ignoriert Steuern, Liquiditätsbedarf, Erbsituation, persönliche Risikotragfähigkeit im engeren Sinne." : "No personalised investment advice — ignores taxes, liquidity needs, estate situation, true personal risk capacity."}</li>
            <li>{de ? "Keine Garantie für die Verfügbarkeit oder Eignung der gezeigten ETFs in Ihrer Jurisdiktion." : "No guarantee that listed ETFs are available or suitable in your jurisdiction."}</li>
            <li>{de ? "Keine dynamische Allokation, kein Rebalancing-Tracking, keine Cash-Flow-Modelle." : "No dynamic allocation, no rebalancing tracking, no cash-flow modelling."}</li>
          </ul>
        </Section>
      </Accordion>

      {dialogBucket && (
        <EtfOverrideDialog
          open={!!dialogBucket}
          onOpenChange={(o) => {
            if (!o) setDialogBucket(null);
          }}
          bucketKey={dialogBucket.key}
          current={dialogBucket.current}
          de={de}
        />
      )}
    </div>
  );
}

function Section({ value, icon, title, children, editable, editableLabel }: { value: string; icon: React.ReactNode; title: string; children: React.ReactNode; editable?: boolean; editableLabel?: string }) {
  return (
    <AccordionItem value={value} className="border rounded-lg bg-card data-[state=open]:shadow-sm" data-testid={`methodology-section-${value}`}>
      <AccordionTrigger className="px-4 hover:no-underline">
        <span className="flex items-center gap-2 text-sm font-semibold flex-1 text-left">
          {icon}
          {title}
          {editable && (
            <Badge
              variant="default"
              className="ml-1 text-[10px] px-1.5 py-0 gap-1 inline-flex items-center"
              data-testid={`badge-editable-${value}`}
            >
              <Pencil className="h-2.5 w-2.5" />
              {editableLabel ?? "Editable"}
            </Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

function Formula({ label, expr }: { label: string; expr: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-1">{expr}</div>
    </div>
  );
}

function noteFor(k: string, de: boolean): string {
  const en: Record<string, string> = {
    equity_us: "S&P 500 / MSCI USA proxy",
    equity_eu: "MSCI Europe proxy",
    equity_ch: "SPI / MSCI Switzerland proxy",
    equity_jp: "MSCI Japan proxy",
    equity_em: "MSCI Emerging Markets proxy",
    equity_thematic: "Concentrated thematic basket",
    bonds: "Bloomberg Global Aggregate proxy",
    cash: "Money market, currency-dependent",
    gold: "Spot gold (USD)",
    reits: "FTSE EPRA NAREIT Developed proxy",
    crypto: "BTC-heavy basket, illustrative only",
  };
  const dee: Record<string, string> = {
    equity_us: "S&P 500 / MSCI USA-Proxy",
    equity_eu: "MSCI Europe-Proxy",
    equity_ch: "SPI / MSCI Schweiz-Proxy",
    equity_jp: "MSCI Japan-Proxy",
    equity_em: "MSCI Emerging Markets-Proxy",
    equity_thematic: "Konzentrierter thematischer Korb",
    bonds: "Bloomberg Global Aggregate-Proxy",
    cash: "Geldmarkt, währungsabhängig",
    gold: "Gold-Spot (USD)",
    reits: "FTSE EPRA NAREIT Developed-Proxy",
    crypto: "BTC-lastiger Korb, rein illustrativ",
  };
  return (de ? dee : en)[k] ?? "";
}

function regionFromKey(k: string): string {
  if (k === "equity_us") return "USA";
  if (k === "equity_eu") return "Europe";
  if (k === "equity_ch") return "Switzerland";
  if (k === "equity_jp") return "Japan";
  if (k === "equity_em") return "EM";
  return "USA";
}

function regionLabel(k: string, de: boolean): string {
  if (k === "equity_us") return de ? "USA" : "United States";
  if (k === "equity_eu") return de ? "Europa (ex CH)" : "Europe (ex CH)";
  if (k === "equity_ch") return de ? "Schweiz" : "Switzerland";
  if (k === "equity_jp") return de ? "Japan" : "Japan";
  if (k === "equity_em") return de ? "Schwellenländer" : "Emerging Markets";
  return k;
}

function scenarioSource(name: string, de: boolean): string {
  if (name.includes("2008")) return de ? "S&P 500, MSCI EAFE, MSCI EM, Bloomberg Aggregate (Sept 2008 – März 2009)" : "S&P 500, MSCI EAFE, MSCI EM, Bloomberg Aggregate (Sept 2008 – Mar 2009)";
  if (name.includes("COVID")) return de ? "Globale Indizes, Hoch 19. Feb 2020 – Tief 23. März 2020" : "Global indices, peak 19 Feb 2020 – trough 23 Mar 2020";
  if (name.includes("2022")) return de ? "60/40-Portfolios, Anleihen-Drawdown 2022 (US 10y +250 bps)" : "60/40 portfolios, 2022 bond drawdown (US 10y +250 bps)";
  return "—";
}
