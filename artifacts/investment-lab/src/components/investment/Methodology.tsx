import { useEffect, useState } from "react";
import { BookOpen, Database, Calculator, AlertTriangle, ExternalLink, RotateCcw, ShieldQuestion, Layers, Activity, GitCompare, Building2, RefreshCw, Pencil } from "lucide-react";
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
import { getRiskFreeRate, setRiskFreeRate, resetRiskFreeRate, subscribeRiskFreeRate, RF_DEFAULT_RATE, getCMAOverrides, setCMAOverrides, resetCMAOverrides, subscribeCMAOverrides, CMAUserOverrides, getHomeBiasOverrides, setHomeBiasOverrides, resetHomeBiasOverrides, subscribeHomeBiasOverrides, resolvedHomeBias, HOME_BIAS_DEFAULTS, HomeBiasCurrency, getLastAllocation, subscribeLastAllocation } from "@/lib/settings";
import type { AssetAllocation } from "@/lib/types";
import { useT } from "@/lib/i18n";

const LAST_REVIEWED = "Q2 2026";

export function Methodology() {
  const { lang } = useT();
  const de = lang === "de";

  const [rf, setRf] = useState<number>(() => getRiskFreeRate());
  const [rfInput, setRfInput] = useState<string>(() => (getRiskFreeRate() * 100).toFixed(2));
  useEffect(() => subscribeRiskFreeRate((v) => { setRf(v); setRfInput((v * 100).toFixed(2)); }), []);

  const applyRf = () => {
    const v = parseFloat(rfInput.replace(",", "."));
    if (Number.isFinite(v) && v >= 0 && v <= 20) setRiskFreeRate(v / 100);
  };

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
      const mu = parseFloat(d.mu.replace(",", "."));
      const sg = parseFloat(d.sigma.replace(",", "."));
      if (Number.isFinite(mu)) entry.expReturn = mu / 100;
      if (Number.isFinite(sg) && sg >= 0) entry.vol = sg / 100;
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
      const raw = hbDraft[c].replace(",", ".").trim();
      if (raw === "") continue;
      const v = parseFloat(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 5) next[c] = v;
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
                  <span className="font-semibold">{de ? "Risikofreier Zinssatz" : "Risk-Free Rate"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "Sharpe-Ratio und Alpha. Default 2,50 %."
                      : "Sharpe Ratio and Alpha. Default 2.50%."}
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
          title={de ? "Risikofreier Zinssatz" : "Risk-Free Rate"}
          editable
          editableLabel={de ? "Editierbar" : "Editable"}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Dies ist die einzige Eingabe, die sich nach aktuellen Marktbedingungen richtet. Sie fließt in Sharpe-Ratio und Alpha ein. Standard 2,50 % entspricht einem typischen Korridor für kurzlaufende EUR/USD-Geldmarktsätze nach 2024."
              : "This is the one input tied to current market conditions. It feeds into Sharpe Ratio and Alpha. Default 2.50% reflects a typical post-2024 short-term EUR/USD money market envelope."}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rf-input" className="text-xs">{de ? "Aktueller Wert (%)" : "Current value (%)"}</Label>
              <Input
                id="rf-input"
                type="number"
                step="0.05"
                min="0"
                max="20"
                value={rfInput}
                onChange={(e) => setRfInput(e.target.value)}
                onBlur={applyRf}
                onKeyDown={(e) => { if (e.key === "Enter") applyRf(); }}
                className="w-32 font-mono"
              />
            </div>
            <Button onClick={applyRf} size="sm">{de ? "Übernehmen" : "Apply"}</Button>
            <Button variant="outline" size="sm" onClick={() => resetRiskFreeRate()}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {de ? "Zurücksetzen" : "Reset to default"} ({(RF_DEFAULT_RATE * 100).toFixed(2)}%)
            </Button>
            <div className="text-xs text-muted-foreground">
              {de ? "Aktuell verwendet" : "Currently used"}: <span className="font-mono font-semibold text-foreground">{(rf * 100).toFixed(2)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Tipp: Sie können hier die Rendite einer 3-Monats-Staatsanleihe Ihrer Basiswährung eingeben (z. B. SARON für CHF, ESTR/EZB für EUR, T-Bills für USD). Der Wert wird lokal gespeichert."
              : "Tip: enter the yield of a 3-month government bill in your base currency (e.g. SARON for CHF, ESTR/ECB for EUR, T-Bills for USD). The value is stored locally on your device."}
          </p>
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
              ? "Die App ist bewusst frontend-only und ruft zur Laufzeit keine fremden Server. Die Stammdaten der ETFs (TER, Name, Domizil, Währung) werden stattdessen über einen nächtlichen Snapshot-Build aktualisiert: ein Skript holt die Werte einmal pro Tag von justETF, schreibt sie als JSON ins Repository und der nächste Build backt den frischen Stand ins Bundle. Im Browser des Nutzers wird also weiterhin keine Live-Verbindung benötigt — er bekommt aber stets die zuletzt nachts geprüften Werte."
              : "The app is intentionally frontend-only and makes no remote calls at runtime. ETF reference data (TER, name, domicile, currency) is refreshed via a nightly snapshot build instead: a script pulls the values once per day from justETF, writes them as JSON into the repository, and the next build bakes the fresh snapshot into the bundle. The user's browser still never makes a live call — but it always sees the most recently nightly-verified values."}
          </p>
          <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed space-y-1">
            <div><span className="font-semibold">{de ? "Quelle" : "Source"}:</span> justetf.com (public ETF profile pages)</div>
            <div><span className="font-semibold">{de ? "Skript" : "Script"}:</span> <code className="font-mono">artifacts/investment-lab/scripts/refresh-justetf.mjs</code></div>
            <div><span className="font-semibold">{de ? "Snapshot-Datei" : "Snapshot file"}:</span> <code className="font-mono">src/data/etfs.overrides.json</code></div>
            <div><span className="font-semibold">{de ? "Zeitplan" : "Schedule"}:</span> {de ? "täglich 03:00 UTC via GitHub Action " : "daily at 03:00 UTC via GitHub Action "}<code className="font-mono">.github/workflows/refresh-data.yml</code></div>
            <div><span className="font-semibold">{de ? "Aktualisierte Felder" : "Refreshed fields"}:</span> {de ? "TER (Gesamtkostenquote in Basispunkten)" : "TER (Total Expense Ratio, in basis points)"}</div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Hand-kuratiert (vom Snapshot nicht überschrieben) bleiben: Replikationsmethode (physisch / sampled / synthetisch), Notierungen je Börse (LSE / XETRA / SIX), Default-Börse, Ausschüttungsart, redaktioneller Kommentar sowie alle Look-Through-Profile (Geo-/Sektor-/Währungs-/Top-Holdings-Aufteilung pro ISIN, Stichtag Q4 2024). Diese Werte ändern sich selten und werden bei jeder ETF-Aufnahme bewusst gesetzt."
              : "Curated by hand (not overwritten by the snapshot): replication method (physical / sampled / synthetic), per-exchange listings (LSE / XETRA / SIX), default exchange, distribution type, editorial comment, and all look-through profiles (geo / sector / currency / top-holdings breakdown per ISIN, reference date Q4 2024). These values change rarely and are set deliberately when an ETF is added."}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Auch nicht automatisiert: die Kapitalmarkt-Annahmen (langfristige erwartete Renditen, Volatilitäten, Korrelationen) und die Stress-Szenarien. Diese stammen aus den öffentlich publizierten Long-Term Capital Market Assumptions großer Asset-Manager und werden bewusst stabil gehalten, damit Vergleichsanalysen über die Zeit konsistent bleiben."
              : "Also not automated: the capital market assumptions (long-term expected returns, volatilities, correlations) and the stress scenarios. These are drawn from the publicly published Long-Term Capital Market Assumptions of major asset managers and are deliberately kept stable so that comparison analyses stay consistent over time."}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {de
              ? "Bei Standardauslieferung ist die Snapshot-Datei leer — die App nutzt dann die im Code hinterlegten Default-Werte. Sobald das Refresh-Skript einmal lief, werden die geholten Felder per ISIN auf die Default-Werte gelegt; alles andere bleibt deterministisch."
              : "On a fresh checkout the snapshot file is empty — the app then uses the in-code default values. Once the refresh script has run at least once, the fetched fields override the defaults per ISIN; everything else stays deterministic."}
          </p>
        </Section>

        <Section
          value="construction"
          icon={<Layers className="h-4 w-4" />}
          title={de ? "Portfolio-Konstruktion (regelbasiert, nicht starr)" : "Portfolio Construction (rule-based, not fixed)"}
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
              <span className="font-semibold">{de ? "Heimatmarkt-Bias (live editierbar)" : "Home-bias overlay (live editable)"}</span>{" — "}
              {de
                ? `Defaults: EUR/GBP ×${HOME_BIAS_DEFAULTS.EUR.toFixed(1)} auf Europa, CHF ×${HOME_BIAS_DEFAULTS.CHF.toFixed(1)} auf die Schweiz, USD ×${HOME_BIAS_DEFAULTS.USD.toFixed(1)} (USA-Anker bereits dominant). Multiplikatoren unten je Währung anpassbar; Änderungen wirken beim nächsten Klick auf „Portfolio generieren“.`
                : `Defaults: EUR/GBP ×${HOME_BIAS_DEFAULTS.EUR.toFixed(1)} on Europe, CHF ×${HOME_BIAS_DEFAULTS.CHF.toFixed(1)} on Switzerland, USD ×${HOME_BIAS_DEFAULTS.USD.toFixed(1)} (USA anchor already dominant). Multipliers can be edited per currency below; changes take effect the next time you click "Generate Portfolio".`}
            </li>
            <li>
              <span className="font-semibold">{de ? "Horizont- & Themen-Tilts" : "Horizon & theme tilts"}</span>{" — "}
              {de
                ? "Anlagehorizont ≥ 10 Jahre erhöht EM um Faktor 1,3. Nachhaltigkeits-Thema dämpft USA um Faktor 0,85."
                : "Horizon ≥ 10 years lifts EM by ×1.3. Sustainability theme dampens USA by ×0.85."}
            </li>
            <li>
              <span className="font-semibold">{de ? "Konzentrationsgrenze" : "Concentration cap"}</span>{" — "}
              {de
                ? "Keine Aktien-Region darf 65 % des Aktien-Sleeves überschreiten. Überschuss wird proportional auf die übrigen Regionen verteilt."
                : "No equity region may exceed 65% of the equity sleeve. Excess is redistributed proportionally to the other regions."}
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
                <TableRow><TableCell className="text-xs">{de ? "Referenz-Risikofreier Zins (nur Konstruktion)" : "Reference risk-free rate (construction only)"}</TableCell><TableCell className="text-right font-mono text-xs">2.50%</TableCell></TableRow>
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
                {de ? "Home-Bias-Multiplikatoren (live editierbar)" : "Home-bias multipliers (live editable)"}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {de ? "Bereich 0,0 – 5,0" : "range 0.0 – 5.0"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Pro Basiswährung den Verstärkungsfaktor auf die heimische Aktien-Region setzen. Werte werden lokal in Ihrem Browser gespeichert; Änderungen wirken beim nächsten Klick auf „Portfolio generieren“."
                : "Set the amplification factor on the home equity region per base currency. Values are stored locally in your browser; changes take effect the next time you click \"Generate Portfolio\"."}
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
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={5}
                      step={0.1}
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
                          type="number"
                          step="0.1"
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
                          type="number"
                          step="0.1"
                          min="0"
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
              ? "Paarweise Langfrist-Korrelationen, statisch hinterlegt. In Liquiditätskrisen tendieren reale Korrelationen gegen 1 – das spiegelt diese Matrix nicht wider, der Stress-Test schon."
              : "Pairwise long-run correlations, stored statically. In liquidity crises real-world correlations rise toward 1 — this matrix does not reflect that, the stress test does."}
          </p>
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
            <li>{de ? "Korrelation: vereinfachte unabhängige Ziehungen pro Anlageklasse, anschließend gewichtet aggregiert." : "Correlation: simplified independent draws per asset class, then weighted to portfolio level."}</li>
            <li>{de ? "Pfade: 1.000 unabhängige Pfade über den Anlagehorizont des Nutzers." : "Paths: 1,000 independent paths over the user's chosen horizon."}</li>
            <li>{de ? "Ausgewiesen: Median, P10, P90, Wahrscheinlichkeit eines Verlusts." : "Reported: median, P10, P90, probability of loss."}</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Limitierung: ohne Tail-Korrelationen, ohne Inflations-/Steuermodell, ohne Sequence-of-Returns-Pfade über Cash-Flows."
              : "Limitations: no tail correlations, no inflation/tax model, no cash-flow sequence-of-returns modelling."}
          </p>
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

        <Section value="etfs" icon={<Building2 className="h-4 w-4" />} title={de ? "ETF-Katalog" : "ETF Catalog"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Reale UCITS-ETFs (z. B. iShares, Vanguard, Xtrackers, Amundi, Invesco) mit ISIN, Ticker, Börse, Domizil, Replikationsmethode und TER. Manuell gepflegt."
              : "Real UCITS ETFs (e.g. iShares, Vanguard, Xtrackers, Amundi, Invesco) with ISIN, ticker, exchange, domicile, replication method and TER. Manually curated."}
          </p>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>{de ? "Quelle" : "Source"}: {de ? "Offizielle Emittenten-Factsheets und justETF-Katalog (öffentlich, indikativ)." : "Issuer official factsheets and the justETF catalog (public, indicative)."}</div>
            <div>{de ? "Zuletzt geprüft" : "Last reviewed"}: {LAST_REVIEWED}</div>
            <div className="text-amber-700 dark:text-amber-400">
              {de
                ? "Wichtig: TERs, Listings und Domizile können sich ändern. Vor jedem Kauf bitte die Live-Daten beim Emittenten oder Broker prüfen."
                : "Important: TERs, listings and domiciles can change. Always verify live data with the issuer or broker before any purchase."}
            </div>
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
