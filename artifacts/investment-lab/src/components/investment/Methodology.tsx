import { useEffect, useState } from "react";
import { BookOpen, Database, Calculator, AlertTriangle, ExternalLink, RotateCcw, ShieldQuestion, Layers, Activity, GitCompare, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CMA, BENCHMARK, buildCorrelationMatrix } from "@/lib/metrics";
import { SCENARIOS } from "@/lib/scenarios";
import { getRiskFreeRate, setRiskFreeRate, resetRiskFreeRate, subscribeRiskFreeRate, RF_DEFAULT_RATE } from "@/lib/settings";
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

  // Build a representative correlation matrix using benchmark assets
  const sampleCorr = buildCorrelationMatrix(
    BENCHMARK.map((b) => ({ assetClass: "Equity", region: regionFromKey(b.key), weight: b.weight * 100 }))
  );

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
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{de ? "Keine Anlageberatung" : "Not investment advice"}</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              {de
                ? "Diese Anwendung dient ausschließlich zu Bildungs- und Demonstrationszwecken. Alle Renditen, Volatilitäten, Korrelationen und Stress-Szenarien sind statische, regelbasierte Schätzungen – sie spiegeln keine Live-Marktdaten wider und garantieren keine zukünftigen Ergebnisse."
                : "This application is for educational and illustration purposes only. All returns, volatilities, correlations and stress scenarios are static, rule-based estimates — they do not reflect live market data and do not guarantee future results."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            {de ? "Risikofreier Zinssatz (live einstellbar)" : "Risk-Free Rate (live editable)"}
          </CardTitle>
          <CardDescription>
            {de
              ? "Dies ist die einzige Eingabe, die sich nach aktuellen Marktbedingungen richtet. Sie fließt in Sharpe-Ratio und Alpha ein. Standard 2,50 % entspricht einem typischen Korridor für kurzlaufende EUR/USD-Geldmarktsätze nach 2024."
              : "This is the one input tied to current market conditions. It feeds into Sharpe Ratio and Alpha. Default 2.50% reflects a typical post-2024 short-term EUR/USD money market envelope."}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            {de
              ? "Tipp: Sie können hier die Rendite einer 3-Monats-Staatsanleihe Ihrer Basiswährung eingeben (z. B. SARON für CHF, ESTR/EZB für EUR, T-Bills für USD). Der Wert wird lokal gespeichert."
              : "Tip: enter the yield of a 3-month government bill in your base currency (e.g. SARON for CHF, ESTR/ECB for EUR, T-Bills for USD). The value is stored locally on your device."}
          </p>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={["cma"]} className="space-y-3">
        <Section value="cma" icon={<Database className="h-4 w-4" />} title={de ? "Kapitalmarktannahmen (CMAs)" : "Capital Market Assumptions (CMAs)"}>
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
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Anlageklasse" : "Asset Class"}</TableHead>
                  <TableHead className="text-right">{de ? "Erw. Rendite p.a." : "Expected Return p.a."}</TableHead>
                  <TableHead className="text-right">{de ? "Volatilität p.a." : "Volatility p.a."}</TableHead>
                  <TableHead>{de ? "Anmerkung" : "Note"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(CMA) as Array<keyof typeof CMA>).map((k) => (
                  <TableRow key={k}>
                    <TableCell className="font-medium text-xs">{CMA[k].label}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{(CMA[k].expReturn * 100).toFixed(2)}%</TableCell>
                    <TableCell className="text-right font-mono text-xs">{(CMA[k].vol * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{noteFor(k, de)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
                  {sampleCorr.labels.map((l) => (
                    <TableHead key={l} className="text-right text-[10px] uppercase">{l}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleCorr.matrix.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-xs">{sampleCorr.labels[i]}</TableCell>
                    {row.map((v, j) => (
                      <TableCell key={j} className="text-right font-mono text-xs">{v.toFixed(2)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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

function Section({ value, icon, title, children }: { value: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={value} className="border rounded-lg bg-card data-[state=open]:shadow-sm">
      <AccordionTrigger className="px-4 hover:no-underline">
        <span className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</span>
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
