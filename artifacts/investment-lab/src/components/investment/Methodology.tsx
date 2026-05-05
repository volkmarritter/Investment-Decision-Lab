import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Database, Calculator, AlertTriangle, ExternalLink, RotateCcw, ShieldQuestion, Layers, Activity, GitCompare, Building2, RefreshCw, Pencil, Replace, Coins, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CMA, BENCHMARK, buildCorrelationMatrix, getCMAConsensus, getCMASources, getCMASeed, applyCMALayers, AssetKey, CMA_BUILDING_BLOCKS, sumBuildingBlocks } from "@/lib/metrics";
import { SCENARIOS } from "@/lib/scenarios";
import { getRiskFreeRates, getRiskFreeRateOverrides, setRiskFreeRate, resetRiskFreeRate, resetAllRiskFreeRates, subscribeRiskFreeRate, RF_DEFAULTS, RFCurrency, getCMAOverrides, setCMAOverrides, resetCMAOverrides, resetCMAOverride, subscribeCMAOverrides, CMAUserOverrides, getHomeBiasOverrides, setHomeBiasOverrides, resetHomeBiasOverrides, resetHomeBiasOverride, subscribeHomeBiasOverrides, resolvedHomeBias, HOME_BIAS_DEFAULTS, HomeBiasCurrency, getLastAllocation, subscribeLastAllocation, getLastEtfImplementation, subscribeLastEtfImplementation } from "@/lib/settings";
import { getHomeAnchorPct } from "@/lib/portfolio";
import { getNeutralHomeCapWeightPct } from "@/lib/homebias";
import type { AssetAllocation, ETFImplementation } from "@/lib/types";
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

// Single source of truth for the per-section "What's new" version pills
// (Task #44). Adding a new section release or bumping a version is now a
// one-line change here — both the <Section> badge (long form) and the ToC
// entry (short form) read from this map, so the two surfaces can never drift
// apart again. To add a section: append a `<section-value>: { version, month }`
// row; to bump: edit the row in place. `version` is the short pill ("v1.7")
// and `month` is the human release tag ("May 2026"); the long form rendered
// next to the section title is derived as `${version} · ${month}`.
const SECTION_VERSIONS: Record<string, { version: string; month: string }> = {
  wht: { version: "v1.5", month: "Apr 2026" },
  "tail-realism": { version: "v1.6", month: "Apr 2026" },
  mc: { version: "v1.7", month: "Apr 2026" },
  "manual-isin": { version: "v1.8", month: "May 2026" },
};
const sectionVersionShort = (id: string): string | undefined =>
  SECTION_VERSIONS[id]?.version;
const sectionVersionLong = (id: string): string | undefined => {
  const v = SECTION_VERSIONS[id];
  return v ? `${v.version} · ${v.month}` : undefined;
};

// Allow-list of accordion section ids that hash routing (Task #43) is
// permitted to expand. Mirrors the `value=` props of every <Section> below
// — if you add a new <Section value="foo" …>, append "foo" here so deep
// links like `?tab=methodology#foo` light it up. Keeping this as an
// explicit set (rather than deriving from tocBlocks at runtime) means an
// arbitrary or stale fragment in the URL can't auto-open the wrong
// section, and it also documents the public surface of shareable links.
//
// Exported so InvestmentLab can fall back to the Methodology tab when the
// URL carries a valid section hash but no explicit `?tab=` parameter (so
// short-form links like `/#tail-realism` still work).
export const VALID_SECTION_IDS = new Set<string>([
  // Your settings
  "etf-catalog",
  "cma",
  "risk-free",
  "home-bias",
  // How results are calculated
  "corr",
  "lookthrough",
  "manual-isin",
  "hedging",
  "wht",
  "mc",
  "tail-realism",
  "stress",
  "formulas",
  // Reference & context
  "bench",
  "limits",
]);

export function Methodology() {
  const { lang, t } = useT();
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
    GBP: "United Kingdom",
    CHF: "Switzerland",
  };
  const HB_REGION_LABEL_DE: Record<HomeBiasCurrency, string> = {
    USD: "USA",
    EUR: "Europa",
    GBP: "Vereinigtes Königreich",
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
  // Mirror BuildPortfolio's etfImplementation so the reference matrix routes
  // exposures via look-through (UK/CH split out of the Europe ETF, etc.) — the
  // same way PortfolioMetrics does. Falls back to undefined when no portfolio
  // has been built, in which case buildCorrelationMatrix uses its row-region
  // routing (the BENCHMARK fallback case).
  const [lastEtfImpl, setLastEtfImpl] = useState<ETFImplementation[] | null>(
    () => getLastEtfImplementation() as ETFImplementation[] | null,
  );
  useEffect(
    () => subscribeLastEtfImplementation((i) => setLastEtfImpl(i as ETFImplementation[] | null)),
    [],
  );

  const corrSourceAllocation: AssetAllocation[] = (lastAlloc && lastAlloc.length > 0)
    ? lastAlloc
    : BENCHMARK.map((b) => ({ assetClass: "Equity", region: regionFromKey(b.key), weight: b.weight * 100 }));
  // Only pass etfImplementation when it pairs with the user's actual allocation;
  // pairing it with the BENCHMARK fallback would mis-route (the impl describes
  // the user's holdings, not the benchmark).
  const corrEtfImpl: ETFImplementation[] | undefined =
    lastAlloc && lastAlloc.length > 0 && lastEtfImpl && lastEtfImpl.length > 0
      ? lastEtfImpl
      : undefined;
  // baseCurrency left at the function default ("USD"): Methodology has no
  // direct access to the user's selected base currency, and the previous call
  // also used the default. Look-through routing of multi-country ETFs (the
  // 3rd arg) is independent of base currency, so this still correctly lights
  // up the UK/CH cells when a Europe ETF is held.
  const sampleCorr = buildCorrelationMatrix(corrSourceAllocation, undefined, corrEtfImpl);
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

  // ------------------------------------------------------------- Jump menu /
  // Controlled accordion state so the top-of-page Table of Contents and the
  // Editable Overview bullets can both open the matching section and scroll
  // it into view. The current section is also mirrored into the URL hash
  // (Task #43) so links like `/?tab=methodology#tail-realism` are
  // shareable, refresh-stable and survive browser back/forward.
  const [openSections, setOpenSections] = useState<string[]>([]);

  // Defer the scroll until the AccordionItem (and, on initial load, the
  // tab panel itself) has been rendered. A single requestAnimationFrame is
  // enough for in-page jumps, but on first paint the tab may flip from
  // hidden→visible in the same React commit as the section opens, and an
  // immediate scrollIntoView would target a still-hidden element. Two
  // back-to-back frames cover both cases reliably.
  const scrollToSection = (sectionValue: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`methodology-anchor-${sectionValue}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  const openAndScrollTo = (sectionValue: string) => {
    setOpenSections((prev) => (prev.includes(sectionValue) ? prev : [...prev, sectionValue]));
    // Push a new history entry so browser back/forward navigates between
    // sections. pushState (unlike `location.hash = "..."`) does not trigger
    // an automatic browser jump, so our smooth scroll wins. It also does
    // not fire `hashchange`, so the listener below won't double-handle it.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = sectionValue;
      if (url.hash !== window.location.hash) {
        window.history.pushState(null, "", url.toString());
      }
    }
    scrollToSection(sectionValue);
  };

  // Hash routing: read the URL hash on mount and on browser back/forward
  // so that loading `/?tab=methodology#tail-realism` (or navigating back
  // to it) opens the matching section and scrolls to it. Only known
  // section ids are honoured — unknown hashes are ignored so a stray `#`
  // or third-party tracker fragment can't expand a random accordion.
  useEffect(() => {
    const apply = () => {
      if (typeof window === "undefined") return;
      const id = window.location.hash.replace(/^#/, "");
      if (!id || !VALID_SECTION_IDS.has(id)) return;
      setOpenSections((prev) => (prev.includes(id) ? prev : [...prev, id]));
      scrollToSection(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Stable labels for the Table of Contents (mirrors the section titles
  // below so renaming them keeps the ToC in sync — keep this small map and
  // the Section invocations next to each other when refactoring).
  const tocBlocks = [
    {
      id: "settings",
      title: de ? "Deine Einstellungen" : "Your settings",
      items: [
        { value: "etf-catalog", label: de ? "ETF-Katalog & Overrides" : "ETF Catalog & Overrides", editable: true },
        { value: "cma", label: de ? "Kapitalmarktannahmen (CMAs)" : "Capital Market Assumptions (CMAs)", editable: true },
        { value: "risk-free", label: de ? "Risikofreier Zinssatz" : "Risk-Free Rates", editable: true },
        { value: "home-bias", label: de ? "Home-Bias-Multiplikatoren" : "Home-Bias Multipliers", editable: true },
      ],
    },
    {
      id: "calc",
      title: de ? "Wie Ergebnisse berechnet werden" : "How results are calculated",
      items: [
        { value: "corr", label: de ? "Korrelationsmatrix" : "Correlation Matrix" },
        { value: "lookthrough", label: de ? "Look-Through-Routing" : "Look-Through Routing" },
        { value: "manual-isin", label: de ? "Manuelle ETF-Eingabe" : "Manual ETF Entry", version: sectionVersionShort("manual-isin") },
        { value: "hedging", label: de ? "Währungs-Hedging" : "FX Hedging" },
        { value: "wht", label: de ? "Quellensteuer-Drag" : "Withholding-Tax Drag", version: sectionVersionShort("wht") },
        { value: "mc", label: de ? "Monte-Carlo-Simulation" : "Monte Carlo Simulation" },
        { value: "tail-realism", label: de ? "Tail-Realismus" : "Tail Realism", version: sectionVersionShort("tail-realism") },
        { value: "stress", label: de ? "Stress-Test-Szenarien" : "Stress Test Scenarios" },
        { value: "formulas", label: de ? "Formeln" : "Formulas" },
      ],
    },
    {
      id: "reference",
      title: de ? "Referenz & Kontext" : "Reference & context",
      items: [
        { value: "bench", label: de ? "Benchmark (MSCI ACWI Proxy)" : "Benchmark (MSCI ACWI Proxy)" },        { value: "limits", label: de ? "Was diese App NICHT tut" : "What this app does NOT do" },
      ],
    },
  ];

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
                <button
                  type="button"
                  onClick={() => openAndScrollTo("risk-free")}
                  className="text-left hover:underline focus:underline focus:outline-none rounded-sm"
                  data-testid="editable-overview-link-risk-free"
                >
                  <span className="font-semibold text-primary">{de ? "Risikofreier Zinssatz (je Basiswährung)" : "Risk-Free Rate (per base currency)"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "Sharpe-Ratio, Alpha und Aktien-Sharpe-Tilt. Defaults: USD 4,25 % / EUR 2,50 % / GBP 4,00 % / CHF 0,50 %."
                      : "Sharpe Ratio, Alpha and equity Sharpe-tilt. Defaults: USD 4.25% / EUR 2.50% / GBP 4.00% / CHF 0.50%."}
                  </span>
                </button>
              </li>
              <li className="flex items-start gap-2">
                <Pencil className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <button
                  type="button"
                  onClick={() => openAndScrollTo("home-bias")}
                  className="text-left hover:underline focus:underline focus:outline-none rounded-sm"
                  data-testid="editable-overview-link-home-bias"
                >
                  <span className="font-semibold text-primary">{de ? "Home-Bias-Multiplikatoren" : "Home-Bias Multipliers"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "Verstärkungsfaktor pro Basiswährung (USD / EUR / GBP / CHF), Bereich 0,0 – 5,0."
                      : "Amplification factor per base currency (USD / EUR / GBP / CHF), range 0.0 – 5.0."}
                  </span>
                </button>
              </li>
              <li className="flex items-start gap-2">
                <Pencil className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <button
                  type="button"
                  onClick={() => openAndScrollTo("cma")}
                  className="text-left hover:underline focus:underline focus:outline-none rounded-sm"
                  data-testid="editable-overview-link-cma"
                >
                  <span className="font-semibold text-primary">{de ? "Kapitalmarktannahmen (CMAs)" : "Capital Market Assumptions (CMAs)"}</span>
                  {" — "}
                  <span className="text-muted-foreground">
                    {de
                      ? "eigene erwartete Rendite μ und Volatilität σ je Anlageklasse."
                      : "custom expected return μ and volatility σ per asset class."}
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <WhatsNewPanel
        sectionVersions={SECTION_VERSIONS}
        sectionLabels={(() => {
          // Flatten tocBlocks → { value: label } so the panel can render
          // the human-readable section title next to each version pill
          // without re-declaring the labels (renaming a section in
          // tocBlocks automatically updates the panel too).
          const map: Record<string, string> = {};
          for (const block of tocBlocks) {
            for (const item of block.items) map[item.value] = item.label;
          }
          // Overrides — when a release's headline is a *change* to the
          // section rather than the section itself, the panel reads
          // better with a verb-y label ("Monte Carlo simulation with
          // look-through") than the bare section title ("Monte Carlo
          // Simulation"). The ToC / JumpMenu still use the plain title.
          map["mc"] = de
            ? "Monte-Carlo-Simulation mit Look-Through"
            : "Monte Carlo simulation with look-through";
          map["manual-isin"] = de
            ? "Live-Vorschau & Pool-Look-Through für manuell erfasste ISINs"
            : "Live preview & pool look-through for manually-entered ISINs";
          return map;
        })()}
        de={de}
        onJump={openAndScrollTo}
      />

      <JumpMenu blocks={tocBlocks} de={de} onJump={openAndScrollTo} />

      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-3"
      >
        <SectionGroupHeading
          id="settings"
          tone="settings"
          title={de ? "Deine Einstellungen" : "Your settings"}
          description={de ? "Eingaben, die Sie hier live anpassen können — die Werte werden lokal gespeichert und überschreiben die Defaults überall in der App." : "Inputs you can edit live in this view — values are stored locally and override the defaults everywhere in the app."}
        />

        <Section
          value="etf-catalog"
          icon={<Building2 className="h-4 w-4" />}
          title={de ? "ETF-Katalog & Overrides" : "ETF Catalog & Overrides"}
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

            <Accordion type="single" collapsible>
              <AccordionItem value="etf-catalog-data-refresh">
                <AccordionTrigger className="text-xs" data-testid="etf-catalog-data-refresh-trigger">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    {de ? "Datenpflege & Aktualität (Snapshot-Build)" : "Data Refresh & Freshness (snapshot build)"}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
                  <TableHead className="text-right w-[90px]">{de ? "Aktion" : "Action"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(CMA) as AssetKey[]).map((k) => {
                  const seed = getCMASeed(k);
                  const src = cmaSources[k];
                  const isOverride = overrides[k] !== undefined;
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
                          placeholder={fmtPct(seed.expReturn)}
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
                          placeholder={fmtPct(seed.vol, 1)}
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
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => resetCMAOverride(k)}
                          disabled={!isOverride}
                          title={de ? `Auf Seed ${fmtPct(seed.expReturn)}% / ${fmtPct(seed.vol, 1)}% zurücksetzen` : `Reset to seed ${fmtPct(seed.expReturn)}% / ${fmtPct(seed.vol, 1)}%`}
                          data-testid={`cma-reset-${k}`}
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

            {/* ---------- Building-Block decomposition (CMA transparency) ---------- */}
            <AccordionItem value="cma-building-blocks">
              <AccordionTrigger className="text-xs" data-testid="bb-trigger">
                {t("bb.section.title")}
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  {t("bb.section.desc")}
                </p>
                <div className="space-y-4" data-testid="bb-section">
                  {(Object.keys(CMA) as AssetKey[]).map((k) => {
                    const bb = CMA_BUILDING_BLOCKS[k];
                    const seed = getCMASeed(k);
                    const sum = sumBuildingBlocks(k);
                    const delta = sum - seed.expReturn;
                    return (
                      <div key={k} className="rounded-md border p-3 bg-muted/20" data-testid={`bb-row-${k}`}>
                        <div className="flex items-baseline justify-between gap-2 mb-2">
                          <div className="text-xs font-semibold">{CMA[k].label}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {t("bb.col.seed")}: {fmtPct(seed.expReturn)}%
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px] uppercase tracking-wide">{t("bb.col.component")}</TableHead>
                              <TableHead className="text-[10px] uppercase tracking-wide text-right">{t("bb.col.value")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bb.components.map((c) => (
                              <TableRow key={c.key}>
                                <TableCell className="text-xs py-1">{t(c.key)}</TableCell>
                                <TableCell className={`text-xs py-1 text-right font-mono ${c.value < 0 ? "text-destructive" : ""}`} data-testid={`bb-${k}-${c.key.replace(/\./g, "-")}`}>
                                  {c.value > 0 ? "+" : ""}{(c.value * 100).toFixed(2)}%
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell className="text-xs py-1 font-semibold">{t("bb.col.sum")}</TableCell>
                              <TableCell className="text-xs py-1 text-right font-mono font-semibold" data-testid={`bb-sum-${k}`}>
                                {(sum * 100).toFixed(2)}%
                                {Math.abs(delta) > 0.0005 && (
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    ({t("bb.col.delta")} {delta > 0 ? "+" : ""}{(delta * 100).toFixed(2)}%)
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        <p className="text-[10px] text-muted-foreground mt-2 italic leading-snug">
                          {t(bb.source)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>
        <Section
          value="risk-free"
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
            <div className="flex items-center justify-end pt-1 border-t">
              <Button
                size="sm"
                variant="outline"
                onClick={resetAllRiskFreeRates}
                disabled={Object.keys(rfOverrides).length === 0}
                data-testid="button-rf-reset-all"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {de ? "Alle auf Defaults zurücksetzen" : "Reset all to defaults"}
              </Button>
            </div>
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

          {/* Why CHF Sharpe looks higher — frequent operator question. The
              difference is mechanical (denominator of (r − rf)/σ shrinks
              when rf is small), not a property of the portfolio. We show
              the same r/σ across base currencies and let the rf column do
              the explaining. Numbers match a typical 60/40 expectation set
              and the Defaults shown in the table above. */}
          <div
            className="rounded-md border border-border bg-muted/20 p-3 space-y-3"
            data-testid="rf-chf-sharpe-explainer"
          >
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {de ? "Warum CHF-Strategien einen höheren Sharpe zeigen" : "Why CHF strategies show a higher Sharpe"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {de
                ? "Die Sharpe-Ratio ist (r − rf) / σ. Die Asset-Renditen μ und Volatilitäten σ sind in dieser App währungs-nominal modelliert — sie verschieben sich zwischen Basiswährungen kaum. Was sich stark verschiebt, ist der Abzug rf: der CHF-Geldmarktsatz liegt mit ~0,50 % deutlich unter USD (~4,25 %) oder EUR (~2,50 %). Bei identischem Portfolio bleibt deshalb für CHF ein viel größerer Excess-Return übrig — und damit ein höherer Sharpe."
                : "Sharpe is (r − rf) / σ. Asset returns μ and volatilities σ are modelled currency-nominal in this app — they barely shift between base currencies. What does shift sharply is the rf deduction: the CHF cash rate at ~0.50% sits well below USD (~4.25%) or EUR (~2.50%). For the same portfolio, the CHF view therefore has a much larger excess return left over — and thus a higher Sharpe."}
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">{de ? "Basis" : "Base"}</TableHead>
                    <TableHead className="text-right">{de ? "Portfolio-Rendite r" : "Portfolio return r"}</TableHead>
                    <TableHead className="text-right">rf</TableHead>
                    <TableHead className="text-right">{de ? "Excess (r − rf)" : "Excess (r − rf)"}</TableHead>
                    <TableHead className="text-right">σ</TableHead>
                    <TableHead className="text-right font-semibold">Sharpe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-mono">
                  <TableRow>
                    <TableCell className="font-semibold">USD</TableCell>
                    <TableCell className="text-right">5.50%</TableCell>
                    <TableCell className="text-right">4.25%</TableCell>
                    <TableCell className="text-right">1.25%</TableCell>
                    <TableCell className="text-right">9.50%</TableCell>
                    <TableCell className="text-right font-semibold">0.13</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">EUR</TableCell>
                    <TableCell className="text-right">5.50%</TableCell>
                    <TableCell className="text-right">2.50%</TableCell>
                    <TableCell className="text-right">3.00%</TableCell>
                    <TableCell className="text-right">9.50%</TableCell>
                    <TableCell className="text-right font-semibold">0.32</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-semibold">CHF</TableCell>
                    <TableCell className="text-right">5.50%</TableCell>
                    <TableCell className="text-right">0.50%</TableCell>
                    <TableCell className="text-right">5.00%</TableCell>
                    <TableCell className="text-right">9.50%</TableCell>
                    <TableCell className="text-right font-semibold">0.53</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {de
                ? <><span className="font-semibold text-foreground">Wichtig:</span> Das ist <span className="italic">kein</span> Free Lunch und kein Argument für eine bestimmte Basiswährung. Die Sharpe-Ratio misst, was eine Anlage relativ zur risikolosen Cash-Alternative <span className="italic">in derselben Währung</span> liefert. Ein CHF-Investor hat eine niedrigere Cash-Hürde — also wirkt jede Risiko-Anlage gegen diese Hürde besser. Eine CHF-Sharpe und eine USD-Sharpe sind nicht direkt vergleichbar; sie bewerten unterschiedliche Spielfelder.</>
                : <><span className="font-semibold text-foreground">Important:</span> This is <span className="italic">not</span> a free lunch and not an argument for any specific base currency. Sharpe measures what an investment delivers relative to the risk-free cash alternative <span className="italic">in the same currency</span>. A CHF investor has a lower cash hurdle, so any risk asset looks better against that hurdle. A CHF Sharpe and a USD Sharpe are not directly comparable; they grade different fields.</>}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {de
                ? <><span className="font-semibold text-foreground">Schneller Selbsttest:</span> Setzen Sie oben in der Tabelle den CHF-RF testweise auf 4,25 % (US-Niveau) und beobachten Sie, wie der CHF-Sharpe in der Build-Kachel auf das Niveau von USD zusammenfällt. Das beweist: Der Unterschied stammt vollständig aus dem Cash-Diskont, nicht aus einer Eigenschaft der Allokation.</>
                : <><span className="font-semibold text-foreground">Quick self-test:</span> in the table above, temporarily set the CHF RF to 4.25% (US level) and watch the CHF Sharpe in the Build tile collapse to the USD level. This proves the gap comes entirely from the cash discount, not from any property of the allocation.</>}
            </p>
          </div>
        </Section>
        <Section
          value="home-bias"
          icon={<Layers className="h-4 w-4" />}
          title={de ? "Home-Bias-Multiplikatoren & Portfolio-Konstruktion" : "Home-Bias Multipliers & Portfolio Construction"}
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
                  <TableHead className="text-right">{de ? "Anker (USD/EUR)" : "Anchor (USD/EUR)"}</TableHead>
                  <TableHead className="text-right">{de ? "Anker (GBP)" : "Anchor (GBP)"}</TableHead>
                  <TableHead className="text-right">{de ? "Anker (CHF)" : "Anchor (CHF)"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell className="text-xs">USA</TableCell><TableCell className="text-right font-mono text-xs">60%</TableCell><TableCell className="text-right font-mono text-xs">60%</TableCell><TableCell className="text-right font-mono text-xs">60%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Europa" : "Europe"}</TableCell><TableCell className="text-right font-mono text-xs">13%</TableCell><TableCell className="text-right font-mono text-xs">10%</TableCell><TableCell className="text-right font-mono text-xs">10%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Vereinigtes Königreich" : "United Kingdom"}</TableCell><TableCell className="text-right font-mono text-xs">—</TableCell><TableCell className="text-right font-mono text-xs">4%</TableCell><TableCell className="text-right font-mono text-xs">—</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Schweiz" : "Switzerland"}</TableCell><TableCell className="text-right font-mono text-xs">—</TableCell><TableCell className="text-right font-mono text-xs">—</TableCell><TableCell className="text-right font-mono text-xs">4%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">Japan</TableCell><TableCell className="text-right font-mono text-xs">5%</TableCell><TableCell className="text-right font-mono text-xs">5%</TableCell><TableCell className="text-right font-mono text-xs">5%</TableCell></TableRow>
                <TableRow><TableCell className="text-xs">{de ? "Schwellenländer" : "Emerging Markets"}</TableCell><TableCell className="text-right font-mono text-xs">11%</TableCell><TableCell className="text-right font-mono text-xs">11%</TableCell><TableCell className="text-right font-mono text-xs">11%</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          <ol className="text-sm space-y-2 list-decimal pl-5">
            <li>
              <span className="font-semibold">{de ? "Marktkapitalisierungs-Anker" : "Market-cap anchor"}</span>{" — "}
              {de
                ? "Ausgangsgewichte folgen dem globalen Marktportfolio (MSCI-ACWI-Proxy oben). In CHF- und GBP-Portfolios wird der heimische Markt (Schweiz bzw. Vereinigtes Königreich) als eigener Eimer aus Europa herausgelöst."
                : "Starting weights follow the global market portfolio (MSCI ACWI proxy above). For CHF and GBP portfolios, the home market (Switzerland or United Kingdom respectively) is carved out of Europe into its own bucket."}
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
              ? "Defensiv-Sleeve (Cash & Anleihen), Satelliten-Sleeves (REIT 6 %, Krypto 1–3 %, Gold ≤ 5 %), der Thematik-Tilt im Aktien-Sleeve (3–5 %) und Risikoobergrenzen sind weiterhin regelbasiert wie im übrigen Methodik-Dokument beschrieben."
              : "The defensive sleeve (cash & bonds), satellite sleeves (REIT 6%, Crypto 1–3%, Gold ≤ 5%), the thematic tilt within the equity sleeve (3–5%) and risk caps remain rule-based as documented in the rest of this methodology."}
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
                    <div className="flex items-center gap-1">
                      <Input
                        id={`hb-${c}`}
                        type="text"
                        inputMode="decimal"
                        value={hbDraft[c]}
                        onChange={(e) => setHbDraft((d) => ({ ...d, [c]: e.target.value }))}
                        className="h-8 font-mono text-sm flex-1"
                        data-testid={`input-home-bias-${c}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={() => resetHomeBiasOverride(c)}
                        disabled={!isOverride}
                        title={de ? `Auf Default × ${def.toFixed(1)} zurücksetzen` : `Reset to default × ${def.toFixed(1)}`}
                        aria-label={de ? `Home-Bias ${c} auf Default zurücksetzen` : `Reset home bias ${c} to default`}
                        data-testid={`button-home-bias-reset-${c}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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

            {/* ---------- Chain: anchor × multiplier × look-through = engine target ÷ cap = bias ratio ---------- */}
            <div className="rounded-md border bg-background p-3 space-y-2" data-testid="home-bias-chain">
              <div className="text-xs font-semibold">
                {de
                  ? "Wie aus dem Multiplikator der angezeigte „Bias-Faktor vs. neutral“ wird"
                  : "How the multiplier becomes the displayed \"Bias ratio vs neutral\""}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {de
                  ? "Der Multiplikator wirkt auf den Engine-Anker (Cap-Weight Anchor des heimischen Aktien-Eimers, oben in der Anker-Tabelle), nicht direkt auf das MSCI-Cap-Gewicht. Anschließend reduziert der Look-Through-Faktor das Engine-Ziel um den Anteil, der laut Geo-Look-Through tatsächlich auf das Heimatland entfällt — siehe Spalte „LT-Faktor“. Die Home-Bias-Karte (im Tab Build, sichtbar nur wenn der Look-Through-Schalter AN ist) vergleicht den so entstandenen Heimat-Anteil mit dem MSCI-Cap-Gewicht. Werte unten ohne Sharpe-Tilt, ohne Normalisierung und ohne 65 %-Cap (≈ vor finaler Konstruktion)."
                  : "The multiplier acts on the engine anchor (cap-weight anchor of the home equity bucket, see anchor table above), not on the MSCI cap weight itself. The look-through factor then reduces the engine target to the share that actually lands in the home country once the ETF look-through is applied — see the \"LT factor\" column. The Home-Bias card (in the Build tab, visible only when the Look-Through toggle is ON) compares this home share to the MSCI cap weight. Values below ignore Sharpe tilt, normalisation and the 65 % cap (≈ pre-finalisation)."}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{de ? "Basis" : "Base"}</TableHead>
                      <TableHead className="text-xs">{de ? "Heimat-Region" : "Home region"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "Anker" : "Anchor"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "Multiplikator" : "Multiplier"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "Engine-Ziel" : "Engine target"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "LT-Faktor" : "LT factor"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "Heimat-Anteil" : "Home share"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "MSCI-Cap (neutral)" : "MSCI cap (neutral)"}</TableHead>
                      <TableHead className="text-right text-xs">{de ? "≈ Bias-Faktor" : "≈ Bias ratio"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {HB_CURRENCIES.map((c) => {
                      const region = de ? HB_REGION_LABEL_DE[c] : HB_REGION_LABEL[c];
                      const anchor = getHomeAnchorPct(c);
                      const mult = resolvedHomeBias(c);
                      const target = anchor * mult;
                      // Typical look-through factor per base currency: how much of
                      // the engine's "home region" allocation actually shows up as
                      // home-country exposure once Geo-Look-Through is applied.
                      // CHF/GBP carve out their home country and pick country-pure
                      // ETFs (SPI / FTSE 100), so ~95-100% lands at home.
                      // EUR fills the "Europe" bucket with broad-Europe ETFs
                      // (STOXX 600, MSCI Europe, FTSE Dev. Europe) which are only
                      // ~50% Eurozone — the rest is UK + CH + Nordics. With a
                      // Eurozone-pure ETF (EURO STOXX 50, MSCI EMU) the factor
                      // approaches ~1.0 and the bias ratio jumps to ~2.2×.
                      const LT_FACTOR: Record<HomeBiasCurrency, number | null> = {
                        USD: null, EUR: 0.50, GBP: 1.00, CHF: 1.00,
                      };
                      const lt = LT_FACTOR[c];
                      const homeShare = lt === null ? null : target * lt;
                      const cap = getNeutralHomeCapWeightPct(c);
                      const ratio = (homeShare !== null && cap > 0) ? homeShare / cap : null;
                      const usd = c === "USD";
                      return (
                        <TableRow key={`hb-chain-${c}`} data-testid={`hb-chain-row-${c}`}>
                          <TableCell className="text-xs font-mono">{c}</TableCell>
                          <TableCell className="text-xs">{region}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{anchor.toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-xs">× {mult.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">= {target.toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {lt === null
                              ? <span className="text-muted-foreground">{de ? "n. v." : "n/a"}</span>
                              : `× ${lt.toFixed(2)}`}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {homeShare === null
                              ? <span className="text-muted-foreground">{de ? "n. v." : "n/a"}</span>
                              : `= ${homeShare.toFixed(1)}%`}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {usd ? <span className="text-muted-foreground">{de ? "n. v." : "n/a"}</span> : `${cap.toFixed(1)}%`}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {ratio === null
                              ? <span className="text-muted-foreground">{de ? "n. v." : "n/a"}</span>
                              : `${ratio.toFixed(1)}×`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="text-[10px] text-muted-foreground italic leading-relaxed space-y-1">
                <p>
                  {de
                    ? "Beispiel CHF: 4,0 % × 2,5 × 1,00 = 10,0 % Heimat-Anteil ÷ 2,4 % MSCI-Cap ≈ 4,2 ×. Nach Sharpe-Tilt und Re-Normalisierung über alle Regionen landet der Schweiz-Anteil typischerweise bei ~9 – 10 % und ergibt den in der Home-Bias-Karte angezeigten Faktor (~3,9 ×)."
                    : "Example CHF: 4.0 % × 2.5 × 1.00 = 10.0 % home share ÷ 2.4 % MSCI cap ≈ 4.2 ×. After Sharpe tilt and re-normalisation across regions the Swiss share typically lands at ~9 – 10 % and produces the bias ratio (~3.9 ×) shown in the Home-Bias card."}
                </p>
                <p>
                  {de
                    ? "Beispiel EUR (wichtig): Die EUR-Aktien-Region wird mit Breit-Europa-ETFs gefüllt (STOXX 600, MSCI Europe, FTSE Developed Europe) — diese sind nur zu ~50 % Eurozone, der Rest ist UK + Schweiz + Nordics. Daher LT-Faktor ≈ 0,50 und der angezeigte Bias-Faktor liegt bei ~1,0 ×, obwohl der Multiplikator 1,5 × beträgt. Wird stattdessen ein Eurozone-reiner ETF gewählt (z. B. iShares Core EURO STOXX 50 IE0008471009 oder Amundi MSCI EMU), steigt der LT-Faktor auf ~1,00 und der Bias-Faktor springt entsprechend auf ~2,2 × — die Wirkung des Multiplikators wird damit voll sichtbar."
                    : "Example EUR (important): the EUR equity region is filled with broad-Europe ETFs (STOXX 600, MSCI Europe, FTSE Developed Europe) — these are only ~50 % Eurozone, with the rest in UK + Switzerland + Nordics. Hence LT factor ≈ 0.50 and the displayed bias ratio sits around ~1.0 × despite the 1.5 × multiplier. Switching to a Eurozone-pure ETF (e.g. iShares Core EURO STOXX 50 IE0008471009 or Amundi MSCI EMU) lifts the LT factor toward ~1.00 and the bias ratio jumps to ~2.2 ×, fully delivering the multiplier."}
                </p>
                <p>
                  {de
                    ? "USD hat per Konvention keine Home-Bias-Bewertung, weil die USA bereits ~60 % der globalen Marktkapitalisierung ausmachen."
                    : "USD has no home-bias verdict by design because the US already represents ~60 % of global market cap."}
                </p>
              </div>
            </div>
          </div>
        </Section>
        <SectionGroupHeading
          id="calc"
          tone="calc"
          title={de ? "Wie Ergebnisse berechnet werden" : "How results are calculated"}
          description={de ? "Annahmen, Routings und Modelle, die hinter den ausgewiesenen Kennzahlen stehen — read-only Dokumentation." : "Assumptions, routings and models behind every reported metric — read-only documentation."}
        />

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
          {corrReflectsPortfolio && (
            <p className="text-[11px] text-muted-foreground italic">
              {corrEtfImpl
                ? (de
                  ? "Look-Through-Routing aktiv: Multi-Country-ETFs wie iShares Core MSCI Europe werden in ihre tatsächlichen Länderanteile (z. B. UK ~20 %, CH ~14 %) zerlegt; entsprechend leuchten auch diese Detail-Zeilen als gehalten auf."
                  : "Look-Through routing active: multi-country ETFs such as iShares Core MSCI Europe are decomposed into their actual country shares (e.g. UK ~20 %, CH ~14 %); the corresponding detail rows light up as held.")
                : (de
                  ? "Look-Through-Routing aus (Schalter im Tab Build): Multi-Country-ETFs werden hier wie ein einzelner Region-Bucket behandelt. Für die feinere Aufteilung den Schalter \u201ELook-Through-Analyse\u201C einschalten."
                  : "Look-Through routing off (toggle in Build tab): multi-country ETFs are treated as a single regional bucket here. Turn on the “Look-Through Analysis” toggle for the finer split.")}
            </p>
          )}
        </Section>
        <Section value="lookthrough" icon={<Layers className="h-4 w-4" />} title={de ? "Look-Through-Routing" : "Look-Through Routing"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "ETFs wie iShares Core MSCI Europe (IE00B4K48X80) sind aus Sicht der Risiko-Engine keine homogene \u201EEurope\u201C-Position: rund 20 % entfallen auf UK und 14 % auf die Schweiz, der Rest auf Kontinental-EU. Die Look-Through-Logik nutzt die kuratierten Index-Geo-Profile (siehe Look-Through-Pool unten und src/data/lookthrough.overrides.json) und routet jede Allokationszeile gewichtet auf die korrekten Länder-Buckets — bevor Vola, Beta, TE, Alpha, der TE-Beitrag und die Korrelationsmatrix berechnet werden."
              : "From the risk engine's perspective, ETFs like iShares Core MSCI Europe (IE00B4K48X80) are not a homogeneous “Europe” position: roughly 20 % is UK and 14 % is Switzerland, with the rest in continental EU. The look-through logic uses the curated index geo profiles (see Look-Through Pool below and src/data/lookthrough.overrides.json) and routes each allocation row, weighted, onto the correct country buckets — before Vol, Beta, TE, Alpha, the TE contribution and the correlation matrix are computed."}
          </p>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Wo das Routing greift" : "Where the routing applies"}</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{de ? "Allokations-Pie-Chart und Stacked-Bar (Aktien-Buckets werden in Länder zerlegt, z. B. Equity-Europe → UK / CH / Kontinental-EU)" : "Allocation pie chart and stacked bar (equity buckets are decomposed into countries, e.g. Equity-Europe → UK / CH / Continental EU)"}</li>
              <li>{de ? "Risiko- & Performance-Kennzahlen im Tab Build (Vola, Beta, TE, Alpha, Sharpe)" : "Risk & Performance metrics in the Build tab (Vol, Beta, TE, Alpha, Sharpe)"}</li>
              <li>{de ? "TE-Contribution-Tabelle (Treiberzuordnung pro Bucket)" : "TE-Contribution table (per-bucket driver attribution)"}</li>
              <li>{de ? "Effiziente Frontier (Marker-Position des Portfolios)" : "Efficient Frontier (portfolio marker position)"}</li>
              <li>{de ? "Korrelationsmatrix oben (welche Zeilen als \u201Egehalten\u201C markiert werden)" : "Correlation matrix above (which rows are marked as “held”)"}</li>
              <li>{de ? "Monte-Carlo-Simulation (Erwartete Volatilität, CVaR95/99, Path-MDD — neu seit v1.7, Apr 2026; vorher region-basierter Pfad)" : "Monte Carlo simulation (Expected Volatility, CVaR95/99, Path-MDD — new since v1.7, Apr 2026; previously a region-based path)"}</li>
              <li>{de ? "Compare-Tab (Portfolios A und B unabhängig, je nach deren Toggle-Stellung)" : "Compare tab (Portfolios A and B independently, depending on each one’s toggle setting)"}</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Wo das Routing (bewusst) NICHT greift" : "Where the routing (intentionally) does NOT apply"}</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{de ? "Allokations-Tabelle (unter dem Pie-Chart): zeigt bewusst die vom Nutzer gewählten Buckets, damit „was ich ausgewählt habe\u201C nachvollziehbar bleibt." : "Allocation table (below the pie chart): intentionally shows the user-selected buckets, so that “what I picked” stays traceable."}</li>
              <li>{de ? "Stress-Test: schockt direkt die deklarierten Buckets, da die historischen Schock-Vektoren auf Region/Asset-Klassen-Ebene kalibriert sind." : "Stress test: shocks the declared buckets directly, because the historical shock vectors are calibrated at region / asset-class level."}</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Steuerung: der Schalter im Tab Build" : "Control: the toggle in the Build tab"}</p>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Der Schalter \u201ELook-Through-Analyse\u201C im Tab Build steuert das Routing global. AN (Default) → Risiko-Kennzahlen und Korrelationsmatrix verwenden die echten ETF-Bestände, das Look-Through-Panel (Geo-Map + Top 10) wird angezeigt, und die Home-Bias-Karte (Bewertung des Heimat-Tilts gegenüber dem MSCI-Cap-Gewicht) ist sichtbar. AUS → die Engine fällt auf das einfachere Zeilen-Region-Routing zurück (jede Allokationszeile zählt als ein einzelner Region-Bucket gemäss der Asset-Class-/Region-Spalte), das Look-Through-Panel ist ausgeblendet und die Home-Bias-Karte verschwindet ebenfalls — ihr Heimat-Anteil ist nur über die Geo-Look-Through-Körbe ehrlich berechenbar, ein Zeilen-Region-Fallback würde die EUR-Verdünnung (Breit-Europa-ETFs sind nur ~50 % Eurozone) verstecken. Der Vergleichs-Tab respektiert den Schalter pro Portfolio (A und B unabhängig)."
                : "The “Look-Through Analysis” toggle in the Build tab controls the routing globally. ON (default) → risk metrics and the correlation matrix use the actual ETF holdings, the look-through panel (geo map + top 10) is shown, and the Home-Bias card (verdict of the home tilt vs the MSCI cap weight) is visible. OFF → the engine falls back to the simpler row-region routing (each allocation row counts as a single regional bucket per its asset-class/region column), the look-through panel is hidden, and the Home-Bias card disappears too — its home-share figure can only be computed honestly from the geo look-through baskets, and a row-region fallback would hide the EUR dilution (broad-Europe ETFs are only ~50 % Eurozone). The Compare tab respects the toggle per portfolio (A and B independently)."}
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Wenn AUS: feste Aufteilung für \u201EEquity-Global\u201C-Zeilen" : "When OFF: fixed split for “Equity-Global” rows"}</p>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Auch ohne Look-Through braucht die Risiko-Engine konkrete Länder-Buckets. Eine Allokationszeile vom Typ Equity-Global (typischerweise ein einzelner Welt-ETF wie ACWI / FTSE All-World) wird daher gemäss einem festen ACWI-ähnlichen Schlüssel verteilt: US 60 % · Europa 14 % · UK 4 % · CH 4 % · Japan 4 % · EM 14 %. Ohne diesen Fallback würde die Zeile in den Default-Bucket Equity-Thematic fallen (σ ≈ 22 %, niedrige ACWI-Korrelation), und Vola, Beta und TE würden für ein nahezu reines ACWI-Portfolio massiv überzeichnet. Equity-Home-Zeilen (Sleeve-Compaction bei knappem ETF-Budget) routen analog auf den Home-Markt-Bucket der Basiswährung (CHF → Equity-Switzerland, EUR → Equity-Europe, USD → Equity-USA). Bei einem reinen Welt-ETF-Portfolio sind die Kennzahlen mit AN und AUS daher nahezu identisch; der Unterschied wird erst bei Länder-Tilts sichtbar."
                : "Even without look-through, the risk engine needs concrete country buckets. An allocation row of type Equity-Global (typically a single global ETF such as ACWI / FTSE All-World) is therefore distributed via a fixed ACWI-like split: US 60 % · Europe 14 % · UK 4 % · CH 4 % · Japan 4 % · EM 14 %. Without this fallback the row would land in the default Equity-Thematic bucket (σ ≈ 22 %, low ACWI correlation), and Vol, Beta and TE would be massively overstated for a near-pure ACWI portfolio. Equity-Home rows (sleeve compaction under tight ETF budget) route analogously onto the home-market bucket of the base currency (CHF → Equity-Switzerland, EUR → Equity-Europe, USD → Equity-USA). For a pure global-ETF portfolio the metrics with the toggle ON vs OFF are therefore nearly identical; the difference only becomes visible once country tilts are added."}
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Konservativer Länder-Map (worauf wird zerlegt)" : "Conservative country map (what gets decomposed)"}</p>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Aus den Index-Geo-Profilen werden nur eindeutig zuordenbare Länder ausgespalten: UK, CH, JP und US (entwickelte Märkte mit eigenem Bucket) sowie Polen → Equity EM. Mehrdeutige Buckets im Profil — etwa \u201EOther Europe\u201C oder \u201EIreland\u201C — bleiben bewusst beim Region-Bucket der Allokationszeile, damit Total-Gewichte invariant bleiben und keine falschen Vola-Annahmen entstehen. Total-Gewicht ist unter allen Routing-Pfaden identisch."
                : "Only countries that map unambiguously are split out from the index geo profiles: UK, CH, JP and US (developed markets with their own bucket) plus Poland → Equity EM. Ambiguous profile buckets — such as “Other Europe” or “Ireland” — intentionally fall back to the allocation row’s regional bucket, so total weights stay invariant and no spurious volatility assumptions are introduced. Total weight is identical under all routing paths."}
            </p>
          </div>
        </Section>

        <Section
          value="manual-isin"
          icon={<Sparkles className="h-4 w-4" />}
          title={de ? "Manuelle ETF-Eingabe — Live-Vorschau & Look-Through" : "Manual ETF Entry — Live Preview & Look-Through"}
          version={sectionVersionLong("manual-isin")}
        >
          <p className="text-sm text-muted-foreground">
            {de
              ? "Im Tab Erklären lassen sich Positionen ausserhalb des kuratierten Katalogs erfassen, indem ISIN, Asset-Klasse, Region und Gewicht direkt eingegeben werden. Sobald die ISIN dem Format /^[A-Z]{2}[A-Z0-9]{9}\\d$/ entspricht, blendet die App eine kompakte Live-Vorschau direkt unter den Eingabefeldern ein — bevor die Position überhaupt gespeichert wird."
              : "In the Explain tab, positions outside the curated catalog can be added by typing ISIN, asset class, region and weight directly. The moment the ISIN matches the format /^[A-Z]{2}[A-Z0-9]{9}\\d$/, the app shows a compact live preview right below the input fields — before the position is even committed."}
          </p>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Datenquellen (Reihenfolge)" : "Data sources (priority order)"}</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{de
                ? "Katalog (synchron, lokal): falls die ISIN bereits in src/lib/etfs.ts kuratiert ist, gelten die kuratierten Felder (Name, Währung, TER, Domizil, Replikation, Ausschüttung, AUM, Auflagedatum) in der Vorschau als Wahrheit."
                : "Catalog (synchronous, local): if the ISIN is already curated in src/lib/etfs.ts, the curated fields (name, currency, TER, domicile, replication, distribution, AUM, inception) are treated as truth in the preview."}</li>
              <li>{de
                ? "Look-Through-Pool (synchron, lokal): profileFor(isin) aus src/lib/lookthrough.ts liest die Index-Geo-/Sektor-/Top-Holdings-Profile aus dem Pool und zeigt deren Stand-Datum (breakdownsAsOf, topHoldingsAsOf) an."
                : "Look-through pool (synchronous, local): profileFor(isin) in src/lib/lookthrough.ts reads the index geo / sector / top-holdings profile from the pool and surfaces its as-of dates (breakdownsAsOf, topHoldingsAsOf)."}</li>
              <li>{de
                ? "justETF-Vorschau (asynchron, debounced 500 ms): GET /api/etf-preview/:isin liefert Master-Daten direkt aus dem öffentlichen justETF-Profil. Antworten werden 10 Minuten lang im Browser-Speicher zwischengespeichert; das Endpoint ist auf 10 Anfragen pro Minute pro IP rate-limitiert."
                : "justETF preview (async, debounced 500 ms): GET /api/etf-preview/:isin scrapes master data straight from the public justETF profile. Responses are cached in browser memory for 10 minutes; the endpoint is rate-limited to 10 requests per minute per IP."}</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Was die Vorschau zeigt" : "What the preview shows"}</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{de
                ? "Stammdaten: Name · Fondswährung · TER · AUM · Auflagedatum · Replikation · Ausschüttung · Domizil. Katalog-Werte überschreiben Scrape-Werte; Scrape füllt nur Lücken."
                : "Master data: name · fund currency · TER · AUM · inception · replication · distribution · domicile. Catalog values override scrape values; scrape only fills gaps."}</li>
              <li>{de
                ? "Pool-Look-Through: grünes Banner mit Anzahl Regionen / Sektoren / Top-Holdings + Stand-Datum, falls Pool-Daten zur ISIN existieren — sonst eine bernsteinfarbene Warnung, dass die Position 0 % zu den Look-Through-Karten beitragen würde."
                : "Pool look-through: green banner with region / sector / top-holding counts + as-of date when pool data exists for the ISIN — otherwise an amber warning that the position would contribute 0 % to the look-through cards."}</li>
              <li>{de
                ? "Schaltfläche „Werte übernehmen“: füllt Name, Währung und TER in die Eingabefelder ein — aber nur dort, wo der Nutzer noch nichts eingetragen hat. Bestehende Eingaben werden nie überschrieben (zweifach abgesichert: in der Komponente und im State-Setter)."
                : "“Use these values” button: copies name, currency and TER into the input fields — but only into fields the user hasn’t set. Existing inputs are never overwritten (double-gated in the component and the state setter)."}</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Konsequenzen für die Berechnung" : "Consequences for the calculation"}</p>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Sobald die manuelle Position im Portfolio steht, läuft sie durch synthesizePersonalPortfolio (src/lib/personalPortfolio.ts). In dieser Synthese sind die Vorschau und die Implementation-Tabelle bewusst entkoppelt: TER und Währung werden aus den manuellen Eingaben übernommen (Quick-Fill in der Vorschau befüllt diese Felder vor dem Speichern), Replikation und Domizil bleiben leer und Distribution wird auf „Accumulating“ gesetzt — diese drei Felder kommen nicht aus einem zweiten Server-Lookup, weil das in der Synthese teuer und redundant wäre. Pool-Daten werden im Synthesizer ausschließlich für die Sichtbarkeit verwendet: ist profileFor(isin) bekannt, wird der Kommentar zu „Manuell erfasst — Pool-Look-Through aus justETF (Stand: YYYY-MM-DD).“ (DE) bzw. „Manually entered — pool look-through from justETF (as of YYYY-MM-DD).“ (EN); andernfalls bleibt der Hinweis „Manuell erfasst — keine Katalog-Look-Through-Daten verfügbar.“ Wichtig: die eigentliche Look-Through-Berechnung (Geo, Sektoren, Top-Holdings, Home-Bias) läuft unabhängig davon weiter über profileFor(isin) in metrics.ts — der Pool-Treffer ist also bereits aktiv, der Kommentar macht ihn nur sichtbar."
                : "Once the manual position is in the portfolio, it flows through synthesizePersonalPortfolio (src/lib/personalPortfolio.ts). In that synthesis the preview and the implementation table are intentionally decoupled: TER and currency are taken from the manual inputs (the preview’s quick-fill button populates them before saving), replication and domicile are left blank, and distribution is set to “Accumulating” — these three fields are not re-fetched at synthesis time because that would be expensive and redundant. Pool data is used in the synthesizer for visibility only: when profileFor(isin) hits, the comment becomes “Manually entered — pool look-through from justETF (as of YYYY-MM-DD).” (or its German equivalent); otherwise the comment stays at “Manually entered — no catalog look-through data available.” Important: the actual look-through math (geo, sectors, top-holdings, home-bias) runs independently via profileFor(isin) in metrics.ts — the pool hit is already active, the comment just makes it visible."}
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold">{de ? "Robustheit beim Tippen" : "Robustness while typing"}</p>
            <p className="text-xs text-muted-foreground">
              {de
                ? "Der zugrunde liegende Hook (useEtfInfo) verwendet einen Per-Effect-Epoch-Token plus AbortController, sodass eine späte Antwort von einer vorherigen ISIN niemals in eine Zeile geschrieben wird, deren ISIN inzwischen geändert wurde. Strukturell fehlerhafte Vorschau-Antworten werden über einen lokalisierten Sentinel (ETF_PREVIEW_MALFORMED) in der Sprache des Bedieners gemeldet; sonstige Netzwerk- und HTTP-Fehler (429 Rate-Limit, 504 Timeout, 4xx/5xx) werden mit der ursprünglichen, vom Server gelieferten Meldung inline angezeigt — diese ist kompakt genug, um zu erkennen, ob es sich um ein Rate-Limit, ein Timeout oder ein echtes Datenproblem handelt."
                : "The underlying hook (useEtfInfo) uses a per-effect epoch token plus AbortController so that a late response from a previous ISIN can never be written onto a row whose ISIN has since changed. Structurally malformed preview responses are reported via a localized sentinel (ETF_PREVIEW_MALFORMED) in the operator’s chosen language; other network and HTTP errors (429 rate-limit, 504 timeout, 4xx/5xx) are surfaced inline using the original server-provided message — short enough to tell rate-limit, timeout and a genuine data problem apart."}
            </p>
          </div>
        </Section>

        <Section value="hedging" icon={<Coins className="h-4 w-4" />} title={de ? "Währungs-Hedging — was der Schalter wirklich tut" : "Currency Hedging — what the toggle actually does"}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Derselbe Hedging-Schalter taucht im Portfolio-Builder UND im Explain-Tab auf und greift an mehreren Stellen gleichzeitig in die Berechnung ein. Er wirkt nur, wenn die Basiswährung nicht USD ist (USD-Anleger gelten in US-Equity per Definition als „home“). Wo das Verhalten zwischen Build und Explain differiert, ist es unten ausdrücklich markiert."
              : "The same hedging toggle appears in the portfolio builder AND in the Explain tab, and feeds several downstream calculations at once. It only fires when the base currency is non-USD (a USD investor in US equity is by definition already \"home\"). Where the behaviour differs between Build and Explain, the bullet says so explicitly."}
          </p>
          <ul className="text-sm space-y-2 list-disc pl-5">
            <li>
              {de
                ? <><span className="font-medium text-foreground">Monte-Carlo-Simulation (Build &amp; Explain):</span> für Aktien-Buckets, deren Region nicht der Basiswährung entspricht, wird σ um −3 Prozentpunkte gesenkt (Emerging Markets: −2 pp), mit Untergrenze 5 %. μ bleibt unverändert. Effekt: schmalerer Fan, niedrigeres VaR/MaxDD, gleicher Median. Bonds, Gold, REITs und Crypto bleiben in der MC unangetastet — die σ-Reduktion gilt nur für equity_*-Buckets.</>
                : <><span className="font-medium text-foreground">Monte Carlo simulation (Build &amp; Explain):</span> for equity buckets whose region differs from the base currency, σ is cut by 3 percentage points (emerging markets: 2 pp), with a 5% floor. μ stays unchanged. Effect: tighter fan, lower VaR/MaxDD, same median. Bonds, gold, REITs and crypto are not touched in the MC — the σ cut only applies to equity_* buckets.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Risiko-&amp;-Performance-Kennzahlen (Build &amp; Explain):</span> Sharpe, σₚ, Beta/Alpha, Tracking Error, Max-Drawdown, Effiziente Frontier und die Korrelationsansicht lesen μ/σ aus exakt derselben Funktion wie die Monte-Carlo-Engine. Dadurch verschieben sich die analytischen Kennzahlen synchron mit dem MC-Fan — keine Diskrepanz zwischen den beiden Sichten möglich.</>
                : <><span className="font-medium text-foreground">Risk &amp; Performance metrics (Build &amp; Explain):</span> Sharpe, σₚ, beta/alpha, tracking error, max drawdown, the efficient frontier and the correlation view all read μ/σ from the exact same function as the Monte Carlo engine. So the analytical metrics shift in lockstep with the MC fan — the two views can't disagree.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Gebühren-Schätzer (Build &amp; Explain):</span> +15 Basispunkte TER pauschal auf jede hedgebare Anlageklasse (Equity, Fixed Income, Real Estate). Cash, Commodities und Digital Assets bekommen keinen Aufschlag. Diese Mehrkosten erscheinen direkt im Fee-Estimator und in der Rendite-nach-Kosten-Projektion.</>
                : <><span className="font-medium text-foreground">Fee estimator (Build &amp; Explain):</span> a flat +15 bps TER is added to every hedgeable asset class (Equity, Fixed Income, Real Estate). Cash, commodities and digital assets get no surcharge. The extra cost shows up directly in the fee estimator and in the after-fee return projection.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Synthetik-US-Gate (Build &amp; Explain):</span> hedged Anteilsklassen deaktivieren den Synthetik-US-Carve-out (<code>isSyntheticUsEffective</code>). Begründung: hedged-synthetische S&amp;P-500-Share-Classes sind in der UCITS-Realität atypisch; den vollen WHT-Benefit dafür anzurechnen würde die Erwartungsrendite überzeichnen. MC-Pfade und analytische Kennzahlen halten sich gemeinsam an dasselbe Gate.</>
                : <><span className="font-medium text-foreground">Synthetic-US gate (Build &amp; Explain):</span> hedged share classes disable the synthetic-US carve-out (<code>isSyntheticUsEffective</code>). Reason: hedged synthetic S&amp;P 500 share classes are atypical in the real UCITS catalog; granting the full WHT benefit there would overstate expected return. MC paths and analytical metrics both honour this gate together.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">ETF-Empfehlungen (nur Build):</span> die Bucket→ETF-Logik schwenkt auf hedged Share Classes um — z. B. iShares S&amp;P 500 EUR Hedged statt der unhedged USD-Variante, oder iShares Global Aggregate Bond CHF Hedged statt der unhedged Global-Aggregate. Die Logik nutzt explizit die Bucket-Schlüssel Equity-USA-EUR/CHF/GBP und FixedIncome-Global-EUR/CHF/GBP, fällt aber sauber auf die unhedged Variante zurück, falls für eine Basiswährung keine hedged Anteilsklasse im Katalog ist. Im <span className="font-medium text-foreground">Explain</span>-Tab passiert das nicht — dort sind die ETFs vom Nutzer manuell gewählt; der Schalter ist dort eine reine analytische Overlay-Annahme.</>
                : <><span className="font-medium text-foreground">ETF recommendations (Build only):</span> the bucket→ETF mapping switches to hedged share classes — e.g. \"iShares S&amp;P 500 EUR Hedged\" instead of the unhedged USD version, or \"iShares Global Aggregate Bond CHF Hedged\" instead of the unhedged Global Aggregate. It explicitly looks up the bucket keys Equity-USA-EUR/CHF/GBP and FixedIncome-Global-EUR/CHF/GBP, but falls back cleanly to the unhedged variant if a hedged share class is not in the catalog for the chosen base currency. In <span className="font-medium text-foreground">Explain</span> this does not happen — there the ETFs are user-picked, so the toggle is a pure analytical overlay assumption.</>}
            </li>
            <li>
              {de
                ? <><span className="font-medium text-foreground">Risiko-/Diversifikations-Hinweise (nur Build):</span> der Warntext „Currency Risk: Unhedged foreign equity exposure…" und der Diversifikations-Hinweis „Unhedged equities can act as a diversifier…" werden im Build ausgeblendet, sobald Hedging an ist — beide werden durch den Schalter gegenstandslos.</>
                : <><span className="font-medium text-foreground">Risk / diversification copy (Build only):</span> the \"Currency Risk: Unhedged foreign equity exposure…\" warning and the \"Unhedged equities can act as a diversifier…\" hint both disappear in Build once hedging is on — the toggle makes both points moot.</>}
            </li>
          </ul>
          <p className="text-sm text-muted-foreground pt-2">
            {de ? "Was der Schalter bewusst NICHT tut:" : "What the toggle deliberately does NOT do:"}
          </p>
          <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
            <li>{de ? "μ (Erwartungsrendite) wird nicht reduziert — die Hedging-Kosten schlagen ausschließlich über die +15-bp-TER durch, nicht über eine niedrigere CMA-Annahme." : "μ (expected return) is not reduced — the hedging cost only flows through the +15 bp TER, not through a lower CMA assumption."}</li>
            <li>{de ? "Korrelationen werden nicht angepasst (nur die Diagonal-Vola der betroffenen Equity-Buckets)." : "Correlations are not adjusted (only the diagonal vol of the affected equity buckets)."}</li>
            <li>{de ? "Bei Basiswährung USD passiert nichts — der Schalter wird wirkungslos." : "When the base currency is USD, the toggle is a no-op."}</li>
            <li>{de ? "Allokationen, Bucket-Gewichte und im Explain-Tab auch die Auswahl der konkreten ETFs bleiben unangetastet — der Schalter ist eine Annahme-Overlay, kein Rebalancer." : "Allocations, bucket weights and (in Explain) the user's specific ETF picks are left untouched — the toggle is an assumption overlay, not a rebalancer."}</li>
            <li>{de ? "Look-Through-Daten ändern sich nicht (gleicher Underlying-Basket; nur die FX-Exposition der hedged Anteilsklassen wird in der Look-Through-Währungstabelle bewusst auf die Anteilsklassen-Währung gemappt — siehe Abschnitt zur Look-Through-Datenpflege)." : "Look-through data does not change (same underlying basket; only the FX exposure of hedged share classes is intentionally mapped to the share-class currency in the look-through currency table — see the look-through data maintenance section)."}</li>
          </ul>
        </Section>
        <Section value="wht" icon={<Coins className="h-4 w-4" />} title={de ? "Quellensteuer-Drag" : "Withholding-Tax Drag"} version={sectionVersionLong("wht")}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Jede ausgewiesene erwartete Rendite (Risk-&-Performance-Kachel, effiziente Frontier, Monte-Carlo-Pfade, Vergleichstab) ist NETTO der nicht-rückforderbaren Quellensteuer auf Dividenden — die Steuer, die ein typischer CH/EU-Privatanleger über IE-domizilierte UCITS-ETFs trotz aller Doppelbesteuerungs-Treaties tatsächlich zahlt. Symmetrisch wird derselbe Drag auch auf den ACWI-Benchmark angewandt, sodass Alpha und Outperformance nicht künstlich erhöht werden."
              : "Every reported expected return (Risk & Performance tile, efficient frontier, Monte Carlo paths, Compare tab) is NET of irrecoverable withholding tax on dividends — the tax a typical CH/EU retail investor actually pays via IE-domiciled UCITS ETFs even after the most favorable double-taxation treaty. The same drag is applied symmetrically to the ACWI benchmark so alpha and outperformance aren't artificially inflated."}
          </p>

          {/* Derivation block — answers the recurring operator question
              "how do the bp numbers actually come about?". WHT only ever
              touches the dividend / coupon stream (capital gains aren't
              withheld at source under any major treaty), so the formula
              is mechanically just dividend yield × residual WHT rate.
              We show the derivation per bucket so the operator can
              sanity-check or override the assumption against current
              published yields. The numbers in this table MUST stay
              consistent with WHT_DRAG in src/lib/metrics.ts — they were
              generated from those exact constants. */}
          <div
            className="rounded-md border border-border bg-muted/20 p-3 space-y-3"
            data-testid="wht-derivation-block"
          >
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {de ? "Wie der Drag berechnet wird" : "How the drag is computed"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {de
                ? <>Quellensteuer trifft <span className="font-semibold text-foreground">nur Dividenden</span> (bzw. Coupons), nicht Kursgewinne — Capital Gains werden in keinem Major-Treaty an der Quelle besteuert. Die jährliche Belastung ist deshalb mechanisch:</>
                : <>Withholding tax only ever touches <span className="font-semibold text-foreground">dividends</span> (or coupons), not capital gains — no major treaty withholds capital gains at source. The annual drag is therefore mechanically:</>}
            </p>
            <Formula
              label={de ? "Drag pro Anlageklasse (p.a.)" : "Drag per asset class (p.a.)"}
              expr="drag = WHT-rate (after treaty) × dividend yield"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {de
                ? "Konkrete Herleitung pro Bucket — die WHT-Sätze sind die Residual-Sätze, die ein IE-domizilierter UCITS-ETF nach Anwendung des günstigsten Doppelbesteuerungs-Treaty noch trägt; die Yields sind langfristige Index-Annahmen:"
                : "Concrete derivation per bucket — WHT rates are the residual rates an IE-domiciled UCITS ETF still carries after applying the most favourable double-taxation treaty; yields are long-run index assumptions:"}
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">{de ? "Anlageklasse" : "Asset class"}</TableHead>
                    <TableHead className="text-right">{de ? "Div-Yield (Annahme)" : "Div yield (assumed)"}</TableHead>
                    <TableHead className="text-right">{de ? "WHT-Satz nach Treaty" : "WHT rate after treaty"}</TableHead>
                    <TableHead className="text-right font-semibold">{de ? "Drag p.a." : "Drag p.a."}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-mono">
                  <TableRow>
                    <TableCell className="font-semibold">US Equity</TableCell>
                    <TableCell className="text-right">2.00%</TableCell>
                    <TableCell className="text-right">15%</TableCell>
                    <TableCell className="text-right font-semibold">30 bps</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">EM Equity</TableCell>
                    <TableCell className="text-right">~2.5%</TableCell>
                    <TableCell className="text-right">~20% {de ? "(gemischt)" : "(blended)"}</TableCell>
                    <TableCell className="text-right font-semibold">40 bps</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">EU / UK / JP / Thematic</TableCell>
                    <TableCell className="text-right">~2.0%</TableCell>
                    <TableCell className="text-right">~10% {de ? "(blended Treaty)" : "(blended treaty)"}</TableCell>
                    <TableCell className="text-right font-semibold">20 bps</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">CH Equity (non-CHF resident)</TableCell>
                    <TableCell className="text-right">~3.0%</TableCell>
                    <TableCell className="text-right">~7% {de ? "(Treaty-Residual)" : "(treaty residual)"}</TableCell>
                    <TableCell className="text-right font-semibold">20 bps</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-semibold">CH Equity (CHF resident)</TableCell>
                    <TableCell className="text-right">~3.0%</TableCell>
                    <TableCell className="text-right font-semibold">0% {de ? "— voll rückforderbar" : "— fully reclaimable"}</TableCell>
                    <TableCell className="text-right font-semibold">0 bps</TableCell>
                  </TableRow>
                  <TableRow className="bg-emerald-50/60 dark:bg-emerald-950/20">
                    <TableCell className="font-semibold">US Equity (synthetic ETF)</TableCell>
                    <TableCell className="text-right">2.00%</TableCell>
                    <TableCell className="text-right font-semibold">0% {de ? "— Swap umgeht WHT" : "— swap bypasses WHT"}</TableCell>
                    <TableCell className="text-right font-semibold">0 bps</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">Bonds / Cash</TableCell>
                    <TableCell className="text-right">{de ? "Coupon" : "coupon"}</TableCell>
                    <TableCell className="text-right">0% {de ? "(Major-Treaties)" : "(major treaties)"}</TableCell>
                    <TableCell className="text-right font-semibold">0 bps</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">Gold / REITs / Crypto</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right font-semibold">0 bps</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {de
                ? <><span className="font-semibold text-foreground">Hinweis zur Statik:</span> Die Drag-Werte sind als Konstanten in <span className="font-mono">WHT_DRAG</span> (src/lib/metrics.ts) hinterlegt — sie ziehen NICHT live mit den tagesaktuellen Dividenden-Renditen mit. Begründung: die annualisierte Yield einer Indexregion bewegt sich über Quartale nur in der Größenordnung von 20–50 bps, während die Streuung zwischen LTCMA-Anbietern beim Yield-Input deutlich größer ist. Eine Live-Berechnung würde Genauigkeit nur vortäuschen.</>
                : <><span className="font-semibold text-foreground">Static-by-design:</span> drag values live as constants in <span className="font-mono">WHT_DRAG</span> (src/lib/metrics.ts) — they do NOT track today's published dividend yields in real time. Rationale: an index region's annualised yield moves only ~20–50 bps quarter-on-quarter, while LTCMA-provider dispersion on the yield input is materially larger. A "live" recompute would be false precision.</>}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {de
                ? <><span className="font-semibold text-foreground">Bewusste Vereinfachungen:</span> Globale REITs würden in der Praxis ~50 bps Drag tragen (15 % WHT auf ~3.5 % Yield), sind im Modell aber als 0 bps vereinfacht — Bucket ist klein, Effekt &lt; 5 bps auf Portfolio-Ebene. High-Yield-Corporate-Bonds in einzelnen Jurisdiktionen wären streng genommen leicht zu optimistisch mit 0 bps; Major-Treaty-Coverage trägt das Modell aber sauber.</>
                : <><span className="font-semibold text-foreground">Deliberate simplifications:</span> global REITs would in practice carry ~50 bps drag (15 % WHT on ~3.5 % yield) but are simplified to 0 bps — bucket is small, portfolio-level effect &lt; 5 bps. High-yield corporates in single jurisdictions would strictly be slightly optimistic at 0 bps; major-treaty coverage carries the model cleanly.</>}
            </p>
          </div>

          <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs space-y-2">
            <p className="font-semibold">{de ? "Synthetik-Carve-Out (v1.5):" : "Synthetic-replication carve-out (v1.5):"}</p>
            <p className="text-muted-foreground">
              {de
                ? "Wenn der Synthetic-ETF-Schalter im Builder aktiv ist (und nicht durch Hedging in einer non-USD-Basiswährung überschrieben wird), entfällt der US-Equity-Drag von 30 bp auf der Portfolio-Seite — ein swap-basierter UCITS-ETF auf den S&P 500 (z. B. Invesco IE00B3YCGJ38) erhält die US-Dividenden rechtlich nicht selbst und vermeidet die 15 % US-WHT strukturell. Der ACWI-Benchmark behält bewusst seinen vollen Drag (er steht für die praktische Alternative — ein physisch replizierender ACWI-ETF), sodass die Synthetik korrekt als Implementations-Alpha sichtbar wird (~30 bp × US-Anteil im Aktien-Sleeve, also ~18 bp bei 60 % US-Equity)."
                : "When the synthetic-ETF toggle in the builder is active (and not overridden by currency hedging in a non-USD base), the 30 bps US-equity drag is removed on the portfolio side — a swap-based UCITS ETF on the S&P 500 (e.g. Invesco IE00B3YCGJ38) doesn't legally receive US dividends and structurally avoids the 15 % US WHT. The ACWI benchmark deliberately keeps its full drag (it represents the practical alternative — a physical-replication ACWI ETF), so the synthetic structure shows up correctly as implementation alpha (~30 bps × US share of the equity sleeve, i.e. ~18 bps at 60 % US equity)."}
            </p>
            <p className="text-muted-foreground">
              {de
                ? "Risiko: Im Tausch gegen den Steuervorteil entsteht kontrolliertes Kontrahentenrisiko zu den Swap-Counterparts (begrenzt durch tägliches Collateral-Management und die UCITS-10 %-Grenze pro Kontrahent). Vol, β, Tracking Error sind unverändert — der Carve-Out wirkt ausschließlich auf den Renditeterm."
                : "Risk: in exchange for the tax pickup, the portfolio takes controlled counterparty risk to the swap counterparties (mitigated by daily collateral and the UCITS 10 %-per-counterparty cap). Vol, β, tracking error are unchanged — the carve-out is a pure return adjustment."}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-semibold mb-2">{de ? "Default-Drag-Sätze (jährlich, in bp):" : "Default drag rates (annual, in bps):"}</p>
            <ul className="space-y-1 list-disc pl-5">
              <li>{de ? "US-Equity: 30 bp (15 % WHT auf ~2 % Div-Yield, IE-Treaty). US-domizilierte ETFs würden 60 bp produzieren." : "US Equity: 30 bps (15 % WHT on ~2 % div yield, IE treaty). US-domiciled ETFs would yield 60 bps."}</li>
              <li>{de ? "EM-Equity: 40 bp (gemischt ~20 % WHT auf ~2.5 % Div-Yield, leicht konservativ gerundet)." : "EM Equity: 40 bps (blended ~20 % WHT on ~2.5 % div yield, rounded slightly conservative)."}</li>
              <li>{de ? "DM ex-US (EU / UK / JP / Thematic): 20 bp." : "DM ex-US (EU / UK / JP / Thematic): 20 bps."}</li>
              <li>{de ? "CH-Equity: 20 bp regulär — aber 0 bp bei Basiswährung CHF (CH-Resident kann die 35 % Verrechnungssteuer voll zurückfordern)." : "CH Equity: 20 bps standard — but 0 bps when base currency is CHF (CH residents can fully reclaim the 35 % federal anticipatory tax)."}</li>
              <li>{de ? "Bonds, Cash, Gold, Real Estate, Crypto: 0 bp (Coupons in den meisten Treaties WHT-frei; REITs vereinfacht)." : "Bonds, Cash, Gold, Real Estate, Crypto: 0 bps (coupons largely WHT-free in major treaties; REITs simplified)."}</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              {de
                ? "Quelle: WHT_DRAG-Konstante in src/lib/metrics.ts, dort werden die Sätze und Quellen-Annahmen versioniert."
                : "Source: WHT_DRAG constant in src/lib/metrics.ts — rates and source assumptions are versioned there."}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Limitierung: Modell unterstellt IE-domizilierte Vehikel und einen CH-Resident als Default-Anleger. Für US-domizilierte ETFs, EU-Resident-Setups oder andere Domizil-Kombinationen sind die Sätze konservativ und teilweise zu niedrig (US-domiziliert: ~60 bp statt 30 bp). Kapitalgewinn- und Vermögenssteuer (kantonal, CH) sind weiterhin nicht modelliert."
              : "Limitation: model assumes IE-domiciled vehicles and a CH-resident default investor. For US-domiciled ETFs, EU-resident setups or other domicile combinations the rates are conservative and partly too low (US-domiciled: ~60 bps instead of 30 bps). Capital-gains and wealth tax (cantonal, CH) are still not modelled."}
          </p>
        </Section>
        <Section value="mc" icon={<Calculator className="h-4 w-4" />} title={de ? "Monte-Carlo-Simulation" : "Monte Carlo Simulation"} version={sectionVersionLong("mc")}>
          <ul className="text-sm space-y-2 list-disc pl-5">
            <li>{de ? "Verteilung: log-normale jährliche Renditen pro Anlageklasse, gezogen aus der CMA-Tabelle (μ und σ wie oben)." : "Distribution: log-normal annual returns per asset class, drawn from the CMA table above (μ and σ as listed)."}</li>
            <li>{de ? "Korrelation: die Portfolio-Volatilität σₚ wird vorab aus der vollständigen Korrelationsmatrix berechnet (Formel im Abschnitt „Formeln“); anschließend wird das Portfolio als Ganzes simuliert (eine Gauß-Ziehung pro Jahr)." : "Correlation: portfolio volatility σₚ is computed up front from the full correlation matrix (formula in the \"Formulas\" section); the portfolio is then simulated as a single asset (one Gaussian draw per year)."}</li>
            <li>{de ? "Pfade: 2.000 unabhängige Pfade über den Anlagehorizont des Nutzers." : "Paths: 2,000 independent paths over the user's chosen horizon."}</li>
            <li>{de ? "Ausgewiesen: Median, P10, P90, Wahrscheinlichkeit eines Verlusts, CVaR(95)/CVaR(99) am Horizont und pfadbasierter realisierter Max-Drawdown (Median + 5.-Perzentil)." : "Reported: median, P10, P90, probability of loss, CVaR(95)/CVaR(99) at horizon, and path-based realized Max Drawdown (median + 5th-percentile)."}</li>
            <li>{de ? "ETF-Look-Through: ist der Schalter „Look-Through-Analyse\u201C im Tab Build aktiv, leitet die Simulation jede Allokationszeile durch dieselbe ETF-Durchsicht-Hilfsfunktion wie die Risk-&-Performance-Kachel — ein Multi-Country-ETF (z. B. iShares MSCI Europe → 23 % UK + 15 % CH + …) trägt zu den tatsächlichen Länder-Buckets bei, statt zum Region-Label der Zeile. Erwartete Volatilität, CVaR95/99 und Path-MDD stimmen daher mit der Risk-&-Performance-Kachel im Rahmen der Sampling-Streuung überein. Bei AUS-Stellung (oder im Vergleichstab pro Portfolio) wird der ältere Region-Pfad verwendet." : "ETF look-through: when the \u201CLook-Through Analysis\u201D toggle in the Build tab is on, the simulation routes each allocation row through the same ETF look-through helper as the Risk & Performance Metrics tile — a multi-country ETF (e.g. iShares MSCI Europe → 23 % UK + 15 % CH + …) contributes to the actual country buckets instead of the row's region label. Expected volatility, CVaR95/99 and Path-MDD therefore agree with the Risk & Performance tile within sampling noise. When OFF (or per-portfolio in the Compare tab), the older region path is used."}</li>
          </ul>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 my-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
              {de ? "Pfadbasierter Max Drawdown (v1.4, Apr 2026)" : "Path-based Max Drawdown (v1.4, Apr 2026)"}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {de
                ? "Für jeden simulierten Pfad wird der schlimmste Peak-to-Trough-Verlust *entlang* des Pfads berechnet (laufendes Maximum bis zum Jahr y, dann (Wert/Peak − 1)). Über alle Pfade berichten wir Median (typischer Pfad-Worst-Case) und 5.-Perzentil (Bad-Tail). Ersetzt für die Simulationsansicht die ältere analytische Heuristik MDD ≈ −min(0.85, (1.8 + 1.4·equityShare)·σₚ), die auf der Risk-&-Performance-Kachel weiterhin als Grobschätzung dient (markiert als „Heuristik“)."
                : "For every simulated path we compute the worst peak-to-trough loss *along* the path (running max up to year y, then (value/peak − 1)). Across all paths we report the median (typical path's worst case) and the 5th-percentile (bad-tail). Replaces the older analytical heuristic MDD ≈ −min(0.85, (1.8 + 1.4·equityShare)·σₚ) for the simulation view; the heuristic is kept on the Risk & Performance tile as a quick analytical proxy (labeled \"heuristic\")."}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Standard-Annahmen sind bewusst konservativ-mainstream: Gauss-Verteilung pro Jahr und Long-Run-Korrelationsmatrix. Für eine pessimistischere Sicht stehen die optionalen Schalter „Crisis-Σ\" und „Student-t\" zur Verfügung — dokumentiert im Abschnitt „Tail-Realismus\" direkt unten. Weitere bewusst nicht modellierte Effekte: Inflations-/Steuermodell (außer dem WHT-Drag — siehe Abschnitt „Quellensteuer-Drag\"), Sequence-of-Returns-Pfade über Cash-Flows."
              : "Default assumptions are deliberately conservative-mainstream: Gauss distribution per year and the long-run correlation matrix. For a more pessimistic lens, the optional \"Crisis-Σ\" and \"Student-t\" toggles are available — documented in the \"Tail Realism\" section directly below. Other deliberately unmodelled effects: inflation/tax (apart from the WHT drag — see \"Withholding-Tax Drag\" section), cash-flow sequence-of-returns paths."}
          </p>
        </Section>
        <Section value="tail-realism" icon={<Calculator className="h-4 w-4" />} title={de ? "Tail-Realismus" : "Tail Realism"} version={sectionVersionLong("tail-realism")}>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Zwei optionale Schalter erlauben dem Operator, die Standard-Annahmen pessimistischer zu kalibrieren — ohne den ausgewiesenen Median oder die erwartete Rendite zu verändern. Beide Schalter sind in der Default-Stellung „aus\" — alle bisherigen Auswertungen bleiben unverändert reproduzierbar. Sie greifen unabhängig voneinander und können einzeln oder gemeinsam aktiviert werden."
              : "Two optional toggles let the operator calibrate the default assumptions more pessimistically — without changing the reported median or expected return. Both toggles default to \"off\" — every prior reading remains exactly reproducible. They are independent and can be flipped individually or stacked."}
          </p>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 my-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {de ? "1. Crisis-Σ (Korrelations-Regime)" : "1. Crisis-Σ (correlation regime)"}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {de
                ? "In normalen Marktphasen sind Equity-Equity-Korrelationen typischerweise 0.55–0.85, Equity↔Bonds nahe null bzw. leicht positiv (~+0.10 im Post-2022-Regime), Equity↔Gold leicht positiv (~+0.05), Equity↔Cash genau 0. In Krisen (2008, März 2020) konvergieren alle riskanten Assets nach oben: Equity-Equity-Pärchen rücken auf 0.85–0.95, Equity↔Bonds steigt auf +0.30 (Flight-to-Quality bricht zusammen), Equity↔REITs auf 0.80–0.88 (REITs handeln wie gehebelte Aktien), Equity↔Crypto auf 0.55–0.75. Gold und Cash bleiben die einzigen verlässlichen Diversifier (Equity↔Gold dreht auf 0 bis −0.05, Equity↔Cash bewusst auf 0 belassen). Die Krisen-Matrix ist konservativ-konsensuell aus AQR-/Bridgewater-Stress-Studien kalibriert."
                : "In normal markets, equity-equity correlations are typically 0.55–0.85, equity↔bonds near zero or slightly positive (~+0.10 in the post-2022 regime), equity↔gold slightly positive (~+0.05), equity↔cash exactly 0. In crises (2008, March 2020) all risky assets converge upward: equity-equity pairs jump to 0.85–0.95, equity↔bonds rises to +0.30 (flight-to-quality breaks down), equity↔REITs to 0.80–0.88 (REITs trade as levered equity), equity↔crypto to 0.55–0.75. Gold and cash remain the only reliable diversifiers (equity↔gold flips to 0 / −0.05, equity↔cash deliberately kept at 0). The crisis matrix is calibrated conservatively from AQR/Bridgewater stress studies."}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {de
                ? "Wirkung: σ, β, Tracking Error, Sharpe, Alpha, Heuristik-MDD und die effiziente Frontier rechnen mit der Crisis-Matrix neu — die ausgewiesene Vol steigt strikt für jeden imperfekt korrelierten Mix; Diversifikations-Vorteile schrumpfen. In der Monte-Carlo-Simulation verbreitert sich der Fan, CVaR99 und Path-MDD-P05 verschlechtern sich, der Median bleibt nahezu unverändert (er wird vom Drift, nicht von der Korrelation getrieben)."
                : "Effect: σ, β, tracking error, Sharpe, alpha, heuristic MDD and the efficient frontier all recompute against the crisis matrix — reported vol strictly rises for any imperfectly-correlated mix; diversification benefits shrink. In the Monte Carlo simulation the fan widens, CVaR99 and Path-MDD-P05 worsen, the median is largely unchanged (it is driven by drift, not by correlation)."}
            </p>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 my-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {de ? "2. Student-t Tail-Modell (df=5)" : "2. Student-t tail model (df=5)"}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {de
                ? "Die Default-Annahme einer Gauss-Verteilung unterschätzt die Häufigkeit extremer Ereignisse — empirisch zeigen Aktien-Tagesrenditen (und auch Jahresrenditen) Kurtosis-Werte von 4–7 statt der Gauss-3. Der Student-t-Schalter ersetzt den jährlichen Schock durch eine Student-t-Verteilung mit 5 Freiheitsgraden (Standard-Wahl in der akademischen Literatur, z. B. Cont 2001) — die σ wird über √((df−2)/df) korrigiert, sodass sie identisch zur Gauss-σ bleibt."
                : "The default Gauss assumption understates the frequency of extreme events — equity daily returns (and annual returns) empirically show kurtosis of 4–7 vs Gauss's 3. The Student-t toggle replaces the annual shock with a Student-t distribution at 5 degrees of freedom (standard choice in the academic literature, e.g. Cont 2001) — σ is corrected via √((df−2)/df) so it stays identical to the Gauss σ."}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {de
                ? "Wirkung: Median, P10/P90 und P/(L) ändern sich nur marginal (gleiche σ, gleicher Drift). CVaR99 verschlechtert sich messbar (typischerweise 5–15 % schlechter), Path-MDD-P05 ebenso — die fetteren Tails treffen genau die extremen Pfade, die diese Kennzahlen messen."
                : "Effect: median, P10/P90 and P/L barely change (same σ, same drift). CVaR99 worsens measurably (typically 5–15 % worse), Path-MDD-P05 likewise — the heavier tails hit exactly the extreme paths these metrics measure."}
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 my-3 space-y-2">
            <p className="text-xs font-semibold">
              {de ? "Wo bedienen?" : "Where to operate?"}
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
              <li>{de ? "Crisis-Σ: ein einziger Schalter, der auf der Risk-&-Performance-Kachel und der Monte-Carlo-Kachel jeweils gespiegelt ist — flippt ihn an einer Stelle, fließt das Stress-Regime in σ, β, Tracking Error, Sharpe, Alpha, Heuristik-MDD, Frontier, Korrelationsmatrix und gleichzeitig in die MC-Aggregate (CVaR95/99, Path-MDD-P05). Beide Karten zeigen also dieselbe Krisen-Sicht — keine inkonsistenten Mischzustände mehr." : "Crisis-Σ: a single switch that is mirrored on both the Risk & Performance tile and the Monte Carlo tile — flip it in either place and the stress regime flows into σ, β, tracking error, Sharpe, alpha, heuristic MDD, frontier, correlation matrix, and at the same time into the MC aggregates (CVaR95/99, Path-MDD-P05). Both cards therefore show the same crisis lens — no more inconsistent mixed readings."}</li>
              <li>{de ? "Student-t: nur auf der Monte-Carlo-Kachel (Tail-Realismus-Box) — wirkt unabhängig von Crisis-Σ und beeinflusst ausschließlich die Pfad-Aggregate (CVaR, Path-MDD)." : "Student-t: lives only on the Monte Carlo tile (Tail-Realism box) — flips independently of Crisis-Σ and affects only the path aggregates (CVaR, Path-MDD)."}</li>
              <li>{de ? "Stress-Test (Szenarien-Tab) ist deterministisch konstruiert — er nutzt fixe historische Drawdowns je Asset und ist damit Σ-unabhängig (keine Doppel-Pessimismus-Falle)." : "Stress-Test (Scenarios tab) is deterministic by construction — it uses fixed historical drawdowns per asset and is Σ-independent (no double-pessimism trap)."}</li>
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            {de
              ? "Empfohlener Use: Standard-Aussage mit Default-Annahmen (Gauss + Normal-Σ) + Robustheits-Check mit beiden Schaltern aktiv („Worst-realistic\"-Linse). Wenn die Investment-These auch unter Crisis-Σ + Student-t trägt, ist sie deutlich robuster validiert als unter den Defaults allein."
              : "Recommended use: produce the standard reading with the default assumptions (Gauss + normal Σ), then a robustness check with both toggles active (the \"worst-realistic\" lens). If the investment thesis still holds under Crisis-Σ + Student-t, it is materially better validated than under the defaults alone."}
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
        <Section value="formulas" icon={<Calculator className="h-4 w-4" />} title={de ? "Formeln" : "Formulas"}>
          <div className="space-y-3 text-sm">
            <Formula label="Expected Return" expr="E[Rₚ] = Σᵢ wᵢ · μᵢ" />
            <Formula label="Volatility" expr="σₚ = √(Σᵢ Σⱼ wᵢ wⱼ σᵢ σⱼ ρᵢⱼ)" />
            <Formula label="Sharpe Ratio" expr="(E[Rₚ] − Rf) / σₚ" />
            <Formula label="Beta vs benchmark" expr="βₚ = Cov(Rₚ, R_b) / Var(R_b)" />
            <Formula label="Alpha (Jensen)" expr="αₚ = E[Rₚ] − [Rf + βₚ · (E[R_b] − Rf)]" />
            <Formula label="Tracking Error" expr="TE = √(σₚ² + σ_b² − 2·Cov(Rₚ, R_b))" />
            <Formula label="Max Drawdown (heuristic — Risk & Performance tile)" expr="MDD ≈ −min(0.85, (1.8 + 1.4 · equityShare) · σₚ)" />
            <Formula label="Max Drawdown (path-based — MC tile)" expr="MDDₚₐₜₕ = minₜ (Vₜ / maxₛ≤ₜ Vₛ − 1);  reported = quantileₚ(MDDₚₐₜₕ)  for p ∈ {0.50, 0.05}" />
            <Formula label="WHT-net Expected Return" expr="E[Rₚ]ₙₑₜ = Σᵢ wᵢ · (μᵢ − whtᵢ)" />
          </div>
        </Section>
        <SectionGroupHeading
          id="reference"
          tone="reference"
          title={de ? "Referenz & Kontext" : "Reference & context"}
          description={de ? "Hintergrund-Material: Benchmark-Definition, Datenpflege und ausdrückliche Limitationen der App." : "Background material: benchmark definition, data refresh cadence and explicit limitations of the app."}
        />

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

function Section({ value, icon, title, children, editable, editableLabel, version }: { value: string; icon: React.ReactNode; title: string; children: React.ReactNode; editable?: boolean; editableLabel?: string; version?: string }) {
  return (
    <AccordionItem
      value={value}
      id={`methodology-anchor-${value}`}
      className="border rounded-lg bg-card data-[state=open]:shadow-sm scroll-mt-24"
      data-testid={`methodology-section-${value}`}
    >
      <AccordionTrigger className="px-4 hover:no-underline">
        <span className="flex items-center gap-2 text-sm font-semibold flex-1 text-left flex-wrap">
          {icon}
          <span>{title}</span>
          {editable && (
            <Badge
              variant="default"
              className="ml-1 text-[11px] px-2 py-0.5 gap-1 inline-flex items-center font-semibold shadow-sm ring-1 ring-primary/30"
              data-testid={`badge-editable-${value}`}
            >
              <Pencil className="h-3 w-3" />
              {editableLabel ?? "Editable"}
            </Badge>
          )}
          {version && (
            <Badge
              variant="secondary"
              className="ml-auto mr-2 text-[10px] px-1.5 py-0 gap-1 inline-flex items-center bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
              data-testid={`whats-new-${value}`}
            >
              <RefreshCw className="h-2.5 w-2.5" />
              {version}
            </Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-4">{children}</AccordionContent>
    </AccordionItem>
  );
}

function SectionGroupHeading({
  id,
  title,
  description,
  tone,
}: {
  id: string;
  title: string;
  description: string;
  tone: "settings" | "calc" | "reference";
}) {
  const toneClasses =
    tone === "settings"
      ? "border-primary/30 bg-primary/5 text-primary"
      : tone === "calc"
        ? "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-300"
        : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  return (
    <div
      id={`methodology-group-${id}`}
      className={`mt-2 first:mt-0 rounded-md border-l-4 ${toneClasses} px-3 py-2 scroll-mt-24`}
      data-testid={`methodology-group-${id}`}
    >
      <div className="text-xs font-bold uppercase tracking-wider">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{description}</div>
    </div>
  );
}

function WhatsNewPanel({
  sectionVersions,
  sectionLabels,
  de,
  onJump,
}: {
  sectionVersions: Record<string, { version: string; month: string }>;
  sectionLabels: Record<string, string>;
  de: boolean;
  onJump: (value: string) => void;
}) {
  // Sort newest-first using a tuple comparator on the numeric segments of
  // the version string ("v1.6" → [1, 6], "v1.10" → [1, 10]). A naïve
  // parseFloat would mis-order v1.10 as < v1.9 (1.1 < 1.9); the per-segment
  // numeric compare keeps the ordering correct as the version scheme
  // grows. Adding a new entry to SECTION_VERSIONS with a higher version
  // automatically floats it to the top — no second edit here.
  const versionParts = (v: string): number[] =>
    v.replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const compareDesc = (a: number[], b: number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = (b[i] ?? 0) - (a[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  const entries = Object.entries(sectionVersions)
    .map(([value, v]) => ({
      value,
      version: v.version,
      month: v.month,
      label: sectionLabels[value] ?? value,
      sortKey: versionParts(v.version),
    }))
    .sort((a, b) => compareDesc(a.sortKey, b.sortKey));

  if (entries.length === 0) return null;

  return (
    <details
      className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 shadow-sm open:shadow-md"
      open
      data-testid="methodology-whats-new"
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-semibold select-none">
        <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
        <span>{de ? "Was ist neu" : "What's new"}</span>
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
        >
          {entries.length}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground font-normal">
          {de ? "Klicken zum Springen" : "Click to jump"}
        </span>
      </summary>
      <ul className="px-4 pb-3 pt-1 border-t border-emerald-500/20 space-y-1.5">
        {entries.map((e) => (
          <li key={e.value}>
            <button
              type="button"
              onClick={() => onJump(e.value)}
              className="w-full text-left text-xs inline-flex items-baseline gap-2 hover:text-primary hover:underline focus:text-primary focus:underline focus:outline-none rounded-sm py-0.5"
              data-testid={`whats-new-jump-${e.value}`}
            >
              <span className="text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 shrink-0 tabular-nums">
                {e.version}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                · {e.month}
              </span>
              <span className="text-foreground truncate">— {e.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function JumpMenu({
  blocks,
  de,
  onJump,
}: {
  blocks: Array<{ id: string; title: string; items: Array<{ value: string; label: string; editable?: boolean; version?: string }> }>;
  de: boolean;
  onJump: (value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const autoCollapsedRef = useRef(false);

  useEffect(() => {
    if (autoCollapsedRef.current) return;
    const handleScroll = () => {
      if (autoCollapsedRef.current) return;
      autoCollapsedRef.current = true;
      setOpen(false);
    };
    window.addEventListener("scroll", handleScroll, { passive: true, once: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <details
      className="rounded-lg border bg-card sticky top-2 z-20 shadow-sm open:shadow-md"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      data-testid="methodology-toc"
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-semibold select-none">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <span>{de ? "Auf dieser Seite" : "On this page"}</span>
        <span className="ml-auto text-xs text-muted-foreground font-normal">
          {de ? "Klicken zum Springen" : "Click to jump"}
        </span>
      </summary>
      <div className="px-4 pb-3 pt-1 grid gap-3 sm:grid-cols-3 border-t">
        {blocks.map((b) => (
          <div key={b.id} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              {b.title}
            </div>
            <ul className="space-y-1">
              {b.items.map((it) => (
                <li key={it.value}>
                  <button
                    type="button"
                    onClick={() => onJump(it.value)}
                    className="text-xs text-left text-foreground hover:text-primary hover:underline inline-flex items-center gap-1.5 w-full"
                    data-testid={`toc-jump-${it.value}`}
                  >
                    <span className="truncate">{it.label}</span>
                    {it.editable && (
                      <Pencil className="h-2.5 w-2.5 text-primary shrink-0" aria-label="editable" />
                    )}
                    {it.version && (
                      <span className="ml-auto text-[9px] text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                        {it.version}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
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
    equity_uk: "FTSE 100 / MSCI UK proxy",
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
    equity_uk: "FTSE 100 / MSCI UK-Proxy",
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
  if (k === "equity_uk") return "UK";
  if (k === "equity_ch") return "Switzerland";
  if (k === "equity_jp") return "Japan";
  if (k === "equity_em") return "EM";
  return "USA";
}

function regionLabel(k: string, de: boolean): string {
  if (k === "equity_us") return de ? "USA" : "United States";
  if (k === "equity_eu") return de ? "Europa (ex CH/UK)" : "Europe (ex CH/UK)";
  if (k === "equity_uk") return de ? "Vereinigtes Königreich" : "United Kingdom";
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
