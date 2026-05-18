/**
 * Builds a typed snapshot of the current Build-tab portfolio. The Build tab
 * feeds this snapshot to `exportReportPptx` (see `./exportReportPptx.ts`) to
 * produce a direct `.pptx` download. The Portfolio Report Deck artifact still
 * consumes the same shape via `localStorage[SNAPSHOT_STORAGE_KEY]` when
 * launched standalone.
 *
 * The shape mirrors the Zod contract on the deck side
 * (`artifacts/portfolio-report-deck/src/data/snapshotSchema.ts`). Keep the
 * two in sync.
 */

import { PortfolioInput, PortfolioOutput } from "./types";
import {
  computeMetrics,
  isSyntheticUsEffective,
  CMA,
  type RiskRegime,
} from "./metrics";
import { getRiskFreeRate } from "./settings";
import { buildLookthrough } from "./lookthrough";
import { runMonteCarlo, type MonteCarloResult } from "./monteCarlo";
import { estimateFees } from "./fees";

export const SNAPSHOT_STORAGE_KEY = "investment-lab.report-snapshot.v1";
const SNAPSHOT_SCHEMA_VERSION = 1;

/** Same illustrative figure PortfolioReport uses, so deck numbers line up
 *  with the on-screen Build defaults. */
const ILLUSTRATIVE_AMOUNT = 100_000;

type Group = "equity" | "bonds" | "realestate" | "cash" | "commodities" | "crypto";

function classifyGroup(assetClass: string): Group {
  const ac = assetClass.toLowerCase();
  if (ac.includes("cash")) return "cash";
  if (ac.includes("fixed") || ac.includes("bond")) return "bonds";
  if (ac.includes("real estate")) return "realestate";
  if (ac.includes("commod")) return "commodities";
  if (ac.includes("digital") || ac.includes("crypto")) return "crypto";
  return "equity";
}

function fmtPct(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`;
}

function fmtPctFrac(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtMoney(v: number, currency: string, lang: "de" | "en"): string {
  try {
    return new Intl.NumberFormat(lang === "de" ? "de-CH" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString("en-GB")}`;
  }
}

function fmtDate(d: Date, lang: "de" | "en"): string {
  return d.toLocaleDateString(lang === "de" ? "de-CH" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}

function sharpeBand(s: number, lang: "de" | "en"): string {
  if (s >= 0.6) return lang === "de" ? "Starkes Sharpe-Verhältnis." : "Strong risk-adjusted return.";
  if (s >= 0.4) return lang === "de" ? "Solides Sharpe-Verhältnis." : "Solid risk-adjusted return.";
  if (s >= 0.2) return lang === "de" ? "Moderates Sharpe-Verhältnis." : "Moderate risk-adjusted return.";
  return lang === "de" ? "Schwaches Sharpe-Verhältnis." : "Weak risk-adjusted return.";
}

function riskProfileLabel(r: string, lang: "de" | "en"): string {
  if (lang !== "de") return r;
  switch (r) {
    case "Low": return "Niedrig";
    case "Moderate": return "Moderat";
    case "High": return "Hoch";
    case "Very High": return "Sehr hoch";
    default: return r;
  }
}

function onOff(b: boolean, lang: "de" | "en"): string {
  if (lang === "de") return b ? "An" : "Aus";
  return b ? "On" : "Off";
}

export interface BuildReportSnapshotArgs {
  output: PortfolioOutput;
  input: PortfolioInput;
  riskRegime: RiskRegime;
  lang: "de" | "en";
  preparedFor?: string;
}

export function buildReportSnapshot(args: BuildReportSnapshotArgs) {
  const { output, input, riskRegime, lang } = args;
  const de = lang === "de";

  const syntheticUsEffective = isSyntheticUsEffective(
    input.includeSyntheticETFs,
    input.baseCurrency,
    input.includeCurrencyHedging,
  );

  const metrics = computeMetrics(
    output.allocation,
    input.baseCurrency,
    input.lookThroughView ? output.etfImplementation : undefined,
    syntheticUsEffective,
    riskRegime,
  );

  const mc: MonteCarloResult = runMonteCarlo(
    output.allocation,
    input.horizon,
    ILLUSTRATIVE_AMOUNT,
    {
      hedged: input.includeCurrencyHedging,
      bondsHedged: input.hedgeForeignBonds !== false,
      baseCurrency: input.baseCurrency,
      syntheticUsEffective,
      riskRegime,
      tailModel: "gauss",
      etfImplementation: input.lookThroughView ? output.etfImplementation : undefined,
    },
  );

  const fees = estimateFees(output.allocation, input.horizon, ILLUSTRATIVE_AMOUNT, {
    hedged: input.includeCurrencyHedging && input.baseCurrency !== "USD",
    hedgeForeignBonds: input.hedgeForeignBonds !== false && input.baseCurrency !== "USD",
    etfImplementations: output.etfImplementation,
  });

  const lookthrough = buildLookthrough(output.etfImplementation, lang, input.baseCurrency);
  const topHoldings = lookthrough.topConcentrations.slice(0, 10);

  // ---------------------------------------------------------------- meta
  const now = new Date();
  const generatedOn = fmtDate(now, lang);
  const reportId =
    `ID-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}-${input.baseCurrency}-` +
    `${input.riskAppetite[0]}${Math.round(input.targetEquityPct)}-${input.horizon}Y`;
  const profileOneLiner = de
    ? `${input.baseCurrency} · ${riskProfileLabel(input.riskAppetite, "de")} · ${input.horizon} Jahre Horizont · ${Math.round(input.targetEquityPct)}% Aktienziel · Look-Through ${input.lookThroughView ? "an" : "aus"}.`
    : `${input.baseCurrency} · ${input.riskAppetite} · ${input.horizon}-year horizon · ${Math.round(input.targetEquityPct)}% target equity · look-through ${input.lookThroughView ? "on" : "off"}.`;
  const correlationRegime = de
    ? riskRegime === "crisis" ? "Krise" : "Normal"
    : riskRegime === "crisis" ? "Crisis" : "Normal";

  // ----------------------------------------------------------- allocation
  // Surface allocation (matches what PortfolioReport defaults to). Rows are
  // already in percent. Sort: equity first, then real estate, bonds,
  // commodities, crypto, cash — matches deck's group order.
  const groupOrder: Group[] = ["equity", "realestate", "bonds", "commodities", "crypto", "cash"];
  const allocRows = output.allocation
    .filter((a) => a.weight > 0.05)
    .map((a) => ({
      label: `${a.assetClass} – ${a.region}`,
      weight: Math.round(a.weight * 10) / 10,
      group: classifyGroup(a.assetClass),
    }))
    .sort((x, y) => {
      const gi = groupOrder.indexOf(x.group);
      const gj = groupOrder.indexOf(y.group);
      if (gi !== gj) return gi - gj;
      return y.weight - x.weight;
    });

  const groupTotals = {
    equity: 0,
    realestate: 0,
    bonds: 0,
    cash: 0,
    commodities: 0,
    crypto: 0,
  };
  for (const r of allocRows) groupTotals[r.group] += r.weight;
  const equityDefensive = (() => {
    const equityLike = groupTotals.equity + groupTotals.realestate + groupTotals.crypto;
    const defensive = groupTotals.bonds + groupTotals.cash + groupTotals.commodities;
    const total = equityLike + defensive;
    if (total <= 0) return "—";
    return `${Math.round((equityLike / total) * 100)} / ${Math.round((defensive / total) * 100)}`;
  })();

  // ----------------------------------------------------------------- etfs
  const etfRows = output.etfImplementation
    .filter((e) => e.weight > 0.05)
    .map((e, i) => ({
      n: i + 1,
      bucket: e.bucket,
      name: e.exampleETF,
      isin: e.isin,
      ticker: e.ticker,
      exchange: e.exchange,
      currency: e.currency,
      distribution: e.distribution === "Accumulating" ? "Acc" : "Dist",
      weight: fmtPct(e.weight, 1),
      terBps: e.terBps,
      ter: fmtPct(e.terBps / 100, 2),
      comment: (de ? e.commentDe : undefined) || e.comment || "",
    }));

  // ----------------------------------------------------------- holdings
  const equityTotalPct = lookthrough.equityWeightTotal * 100;
  const holdingsRows = topHoldings.map((h, i) => ({
    n: i + 1,
    name: h.name,
    source: h.source,
    pctPortfolio: `${h.pctOfPortfolio.toFixed(2)}%`,
    pctEquity:
      equityTotalPct > 0
        ? `${((h.pctOfPortfolio / equityTotalPct) * 100).toFixed(1)}%`
        : "—",
  }));

  // ----------------------------------------------------------- monteCarlo
  const cagr = (final: number) => {
    if (final <= 0 || mc.initial <= 0 || input.horizon <= 0) return "—";
    const r = Math.pow(final / mc.initial, 1 / input.horizon) - 1;
    return `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}% p.a.`;
  };
  // Rebase final values to start=100 for the deck's chart geometry.
  const rebase = (v: number) =>
    mc.initial > 0 ? Math.round((v / mc.initial) * 100) : 100;

  const monteCarlo = {
    paths: "2,000",
    horizonYears: input.horizon,
    finalP10: rebase(mc.finalP10),
    finalP50: rebase(mc.finalP50),
    finalP90: rebase(mc.finalP90),
    finalP10CAGR: cagr(mc.finalP10),
    finalP50CAGR: cagr(mc.finalP50),
    finalP90CAGR: cagr(mc.finalP90),
    expReturnGeom: fmtPctFrac(mc.expectedReturn - 0.5 * mc.expectedVol * mc.expectedVol, 1),
    expVol: fmtPctFrac(mc.expectedVol, 1),
    pLoss15y: fmtPctFrac(mc.probLoss, 1),
    pDouble15y: `${Math.round(mc.probDoubled * 100)}%`,
    cvar5: fmtPctFrac(mc.cvar95Return, 0),
  };

  // ---------------------------------------------------------------- fees
  const portfolioSize = fmtMoney(ILLUSTRATIVE_AMOUNT, input.baseCurrency, lang);
  const feesRows = fees.breakdown.map((b) => ({
    bucket: b.key,
    weightPct: fmtPct(b.weight, 1),
    terBps: Math.round(b.terBps),
    contributionBps: Math.round(b.contributionBps * 100) / 100,
  }));

  // ---------------------------------------------------------------- keyMetrics
  // Use computeMetrics for the headline R/σ/Sharpe (these are the same
  // numbers shown in the on-screen Risk & Performance Metrics tile).
  // MaxDD comes from the simulated path tail so it matches MC's CVaR.
  const keyMetrics = {
    expectedReturnPa: fmtPctFrac(metrics.expReturn, 1),
    volatilityPa: fmtPctFrac(metrics.vol, 1),
    sharpe: metrics.sharpe.toFixed(2),
    sharpeInterpretation: sharpeBand(metrics.sharpe, lang),
    riskFreeRate: fmtPctFrac(getRiskFreeRate(input.baseCurrency), 1),
    maxDrawdownP5: fmtPctFrac(mc.realizedMddP05, 0),
    alphaVsAcwi: `${metrics.alpha >= 0 ? "+" : ""}${(metrics.alpha * 100).toFixed(1)}%`,
    equityDefensiveSplit: equityDefensive,
    weightedTER: fmtPct(fees.blendedTerPct, 2),
  };

  // ---------------------------------------------------------------- fees (top stats)
  const totalFeeBps = fees.blendedTerBps + 15; // include the ~15 bps trading & FX drag like the deck copy
  const feesTop = {
    portfolioSize,
    blendedTERPct: fmtPct(fees.blendedTerPct, 2),
    blendedTERBps: Math.round(fees.blendedTerBps),
    year1FeeCHF: fmtMoney(fees.annualFee, input.baseCurrency, lang),
    totalDrag15yCHF: fmtMoney(fees.projectedTotalFees, input.baseCurrency, lang),
    totalDragPctPa: `−${(totalFeeBps / 100).toFixed(2)}%`,
    rows: feesRows,
  };

  // ----------------------------------------------------------- profile
  const profile = {
    baseCurrency: input.baseCurrency,
    riskProfile: riskProfileLabel(input.riskAppetite, lang),
    horizonYears: input.horizon,
    targetEquityPct: Math.round(input.targetEquityPct),
    numEtfs: etfRows.length,
    toggles: {
      hedging: onOff(input.includeCurrencyHedging, lang),
      bondHedging:
        input.baseCurrency === "USD"
          ? (de ? "Nicht zutreffend" : "N/A")
          : input.hedgeForeignBonds !== false
            ? `${de ? "An" : "On"} (${input.baseCurrency})`
            : onOff(false, lang),
      syntheticEtfs: input.includeSyntheticETFs ? (de ? "Erlaubt" : "Allowed") : (de ? "Aus" : "Off"),
      lookThrough: onOff(input.lookThroughView, lang),
      thematic: input.thematicPreference !== "None" ? input.thematicPreference : (de ? "Aus" : "Off"),
    },
  };

  // -------------------------------------------------------- table of contents
  const tocLabels = de
    ? [
        "Profil-Übersicht",
        "Kennzahlen",
        "Zielallokation",
        "ETF-Implementierung",
        "Top 10 Aktien-Positionen",
        "Monte-Carlo-Projektion",
        "Gebühren-Schätzung",
        "Methodik & Haftungsausschluss",
      ]
    : [
        "Profile summary",
        "Key metrics",
        "Target allocation",
        "ETF implementation",
        "Top 10 equity holdings",
        "Monte Carlo projection",
        "Fee estimate",
        "Methodology & disclaimer",
      ];
  const slideNumbers = [3, 4, 5, 6, 7, 8, 9, 10];
  const tocSections = tocLabels.map((title, i) => ({
    n: i + 1,
    title,
    slide: slideNumbers[i],
    page: `p. ${String(slideNumbers[i]).padStart(2, "0")}`,
  }));

  const meta = {
    reportTitle: de
      ? "Investment Decision Lab — Portfolio-Report"
      : "Investment Decision Lab — Portfolio Report",
    reportId,
    generatedOn,
    preparedFor: args.preparedFor ?? (de ? "Beispiel-Investor" : "Example Investor"),
    jurisdiction: input.baseCurrency === "CHF"
      ? "Switzerland"
      : input.baseCurrency === "EUR"
        ? "Eurozone"
        : input.baseCurrency === "GBP"
          ? "United Kingdom"
          : "United States",
    profileOneLiner,
    correlationRegime,
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    meta,
    profile,
    keyMetrics,
    allocation: {
      rows: allocRows,
      groupTotals: {
        equity: Math.round(groupTotals.equity),
        realestate: Math.round(groupTotals.realestate),
        bonds: Math.round(groupTotals.bonds),
        cash: Math.round(groupTotals.cash),
        commodities: Math.round(groupTotals.commodities),
        crypto: Math.round(groupTotals.crypto),
      },
    },
    etfs: etfRows,
    holdings: holdingsRows,
    monteCarlo,
    fees: feesTop,
    tocSections,
  };
}

// `openReportDeck` was removed when the Build tab switched to direct
// PPTX downloads (see `exportReportPptx.ts`). The deck artifact still
// reads `SNAPSHOT_STORAGE_KEY` on its own; that path is unaffected.
void CMA;
