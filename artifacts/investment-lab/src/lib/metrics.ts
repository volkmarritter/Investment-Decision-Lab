import { AssetAllocation, BaseCurrency } from "./types";
import { getRiskFreeRate, getCMAOverrides } from "./settings";
import consensusFile from "@/data/cmas.consensus.json";
import { APP_DEFAULTS } from "./appDefaults";

export type AssetKey =
  | "equity_us"
  | "equity_eu"
  | "equity_uk"
  | "equity_ch"
  | "equity_jp"
  | "equity_em"
  | "equity_thematic"
  | "bonds"
  | "cash"
  | "gold"
  | "reits"
  | "crypto";

export interface AssetCMA {
  key: AssetKey;
  label: string;
  expReturn: number;
  vol: number;
}

// Built-in seed values (final engine fallback). These are the deliberately
// conservative, stable defaults documented in the Methodology tab.
// Override layers (priority: user > consensus > app-defaults > built-in):
//   1. Built-in BASE_SEED below.
//   2. APP-DEFAULTS overlay from src/data/app-defaults.json (admin-managed
//      via /admin → GitHub PR; ships in the bundle for ALL users after
//      merge + redeploy). Task #35, 2026-04-27.
//   3. Multi-provider CONSENSUS from src/data/cmas.consensus.json (Option A).
//   4. USER overrides from localStorage (Option B), edited in the Methodology tab.
// Layers 3+4 mutate the leaf objects of CMA in place so every existing caller
// (CMA[key].expReturn, CMA[key].vol) keeps working without changes.
// Exportiert, damit die Admin-UI die Built-in-Fallback-Werte (μ und σ) neben
// jedem CMA-Editor-Feld anzeigen kann (Aktuelle-Werte-Anzeige).
export const BASE_SEED: Record<AssetKey, AssetCMA> = {
  equity_us:        { key: "equity_us",        label: "US Equity",         expReturn: 0.070, vol: 0.16 },
  equity_eu:        { key: "equity_eu",        label: "Europe Equity",     expReturn: 0.075, vol: 0.17 },
  equity_uk:        { key: "equity_uk",        label: "UK Equity",         expReturn: 0.065, vol: 0.15 },
  equity_ch:        { key: "equity_ch",        label: "Swiss Equity",      expReturn: 0.060, vol: 0.13 },
  equity_jp:        { key: "equity_jp",        label: "Japan Equity",      expReturn: 0.060, vol: 0.16 },
  equity_em:        { key: "equity_em",        label: "EM Equity",         expReturn: 0.085, vol: 0.22 },
  equity_thematic:  { key: "equity_thematic",  label: "Thematic Equity",   expReturn: 0.080, vol: 0.22 },
  bonds:            { key: "bonds",            label: "Global Bonds",      expReturn: 0.035, vol: 0.06 },
  cash:             { key: "cash",             label: "Cash",              expReturn: 0.030, vol: 0.005 },
  gold:             { key: "gold",             label: "Gold",              expReturn: 0.040, vol: 0.16 },
  reits:            { key: "reits",            label: "Listed Real Estate", expReturn: 0.065, vol: 0.18 },
  crypto:           { key: "crypto",           label: "Crypto",            expReturn: 0.120, vol: 0.70 },
};

// Effective seed = built-in seed with the admin-managed overlay applied.
const CMA_SEED: Record<AssetKey, AssetCMA> = (() => {
  const out = Object.fromEntries(
    (Object.entries(BASE_SEED) as [AssetKey, AssetCMA][]).map(([k, v]) => [k, { ...v }]),
  ) as Record<AssetKey, AssetCMA>;
  for (const [k, v] of Object.entries(APP_DEFAULTS.cma)) {
    if (!(k in out)) continue;
    const target = out[k as AssetKey];
    if (typeof v?.expReturn === "number" && Number.isFinite(v.expReturn)) {
      target.expReturn = v.expReturn;
    }
    if (typeof v?.vol === "number" && Number.isFinite(v.vol)) {
      target.vol = v.vol;
    }
  }
  return out;
})();

// Live, mutable view used by the engine and UI everywhere.
export const CMA: Record<AssetKey, AssetCMA> = Object.fromEntries(
  (Object.entries(CMA_SEED) as [AssetKey, AssetCMA][]).map(([k, v]) => [k, { ...v }]),
) as Record<AssetKey, AssetCMA>;

// --- Layer 1: consensus from public LTCMAs (manual yearly curation) ----------
interface ConsensusFile {
  _meta?: { lastReviewed?: string | null; providers?: string[]; note?: string };
  assets?: Partial<Record<AssetKey, {
    consensus?: { expReturn?: number; vol?: number; n?: number };
    providers?: Record<string, { expReturn?: number; vol?: number; asOf?: string }>;
  }>>;
}
const CONSENSUS = consensusFile as ConsensusFile;

export interface CMAConsensusInfo {
  hasConsensus: boolean;
  lastReviewed: string | null;
  providers: string[];
  perAsset: Partial<Record<AssetKey, {
    consensus: { expReturn?: number; vol?: number; n?: number };
    providers: Record<string, { expReturn?: number; vol?: number; asOf?: string }>;
  }>>;
}

export function getCMAConsensus(): CMAConsensusInfo {
  const perAsset: CMAConsensusInfo["perAsset"] = {};
  let hasConsensus = false;
  for (const [k, v] of Object.entries(CONSENSUS.assets ?? {})) {
    if (v && (v.consensus || v.providers)) {
      perAsset[k as AssetKey] = { consensus: v.consensus ?? {}, providers: v.providers ?? {} };
      if (v.consensus?.expReturn !== undefined || v.consensus?.vol !== undefined) hasConsensus = true;
    }
  }
  return {
    hasConsensus,
    lastReviewed: CONSENSUS._meta?.lastReviewed ?? null,
    providers: CONSENSUS._meta?.providers ?? [],
    perAsset,
  };
}

// Sanity helper: only let finite, in-bounds numbers reach CMA.
function sanitizeCMAValue(v: unknown, bounds: [number, number]): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < bounds[0] || v > bounds[1]) return undefined;
  return v;
}

// --- Layer 2: live user overrides (Option B) --------------------------------
// Re-applies seed -> consensus -> user, in that order. Called at module load
// and whenever the user edits values in the Methodology tab. Both consensus
// JSON values and user override values are sanitized (type-checked + clamped
// to μ ∈ [-0.5, +1.0], σ ∈ [0, 2]) on every call, so malformed snapshot data
// or tampered localStorage can never corrupt CMA — even after multiple
// successive idl-cma-changed events. The user overrides path also receives a
// second pass of sanitization in getCMAOverrides() (which additionally
// enforces the asset-key whitelist).
const MU_BOUNDS: [number, number] = [-0.5, 1];
const SIGMA_BOUNDS: [number, number] = [0, 2];
export function applyCMALayers() {
  // Layer 0: seed.
  for (const k of Object.keys(CMA_SEED) as AssetKey[]) {
    CMA[k].expReturn = CMA_SEED[k].expReturn;
    CMA[k].vol = CMA_SEED[k].vol;
  }
  // Layer 1: multi-provider consensus snapshot (sanitized).
  for (const [k, v] of Object.entries(CONSENSUS.assets ?? {})) {
    const key = k as AssetKey;
    if (!CMA[key]) continue;
    const er = sanitizeCMAValue(v?.consensus?.expReturn, MU_BOUNDS);
    const vl = sanitizeCMAValue(v?.consensus?.vol, SIGMA_BOUNDS);
    if (er !== undefined) CMA[key].expReturn = er;
    if (vl !== undefined) CMA[key].vol = vl;
  }
  // Layer 2: user overrides (already sanitized in getCMAOverrides; re-clamp
  // here defensively in case the API ever changes).
  const userOverrides = getCMAOverrides();
  for (const [k, v] of Object.entries(userOverrides)) {
    const key = k as AssetKey;
    if (!CMA[key]) continue;
    const er = sanitizeCMAValue(v.expReturn, MU_BOUNDS);
    const vl = sanitizeCMAValue(v.vol, SIGMA_BOUNDS);
    if (er !== undefined) CMA[key].expReturn = er;
    if (vl !== undefined) CMA[key].vol = vl;
  }
}

// Apply once eagerly at module load.
applyCMALayers();

// Helper that exposes the current "active source" per asset for the UI.
export function getCMASources(): Record<AssetKey, {
  expReturnSource: "seed" | "consensus" | "user";
  volSource: "seed" | "consensus" | "user";
}> {
  const userOverrides = getCMAOverrides();
  const out = {} as Record<AssetKey, { expReturnSource: "seed" | "consensus" | "user"; volSource: "seed" | "consensus" | "user" }>;
  for (const k of Object.keys(CMA_SEED) as AssetKey[]) {
    const cons = CONSENSUS.assets?.[k]?.consensus;
    const user = userOverrides[k];
    out[k] = {
      expReturnSource: user?.expReturn !== undefined ? "user" : cons?.expReturn !== undefined ? "consensus" : "seed",
      volSource: user?.vol !== undefined ? "user" : cons?.vol !== undefined ? "consensus" : "seed",
    };
  }
  return out;
}

export function getCMASeed(key: AssetKey): { expReturn: number; vol: number } {
  return { expReturn: CMA_SEED[key].expReturn, vol: CMA_SEED[key].vol };
}

// ----------------------------------------------------------------------------
// Building-Block decomposition for the seed expReturn (transparency layer).
// ----------------------------------------------------------------------------
// Standard institutional practice (JPM LTCMA, BlackRock, Research Affiliates,
// GMO etc.) is NOT to publish a single equity-return number but to decompose
// it into observable building blocks so an analyst can audit, challenge, and
// re-flex any component independently:
//
//   Equity      = Dividend Yield + Net Buyback Yield + Real EPS Growth
//                 + Inflation + Valuation Drift
//   Bonds       = Yield-to-Maturity + Roll-down − Expected Credit Loss
//   Cash        = Short-term policy / money-market rate
//   Gold        = Real return + Inflation hedge premium
//   Real Estate = Net Income Yield + Real NOI Growth + Inflation
//                 (often modelled as listed REITs; ignores private-RE smoothing)
//   Crypto      = Pure speculative drift (no fundamental anchor)
//
// The components below are illustrative defaults that sum (within rounding)
// to the seed expReturn shipped in CMA_SEED. They are READ-ONLY documentation
// — the engine continues to consume CMA[k].expReturn directly. Editing the
// CMA in the UI does not retro-fit the components; the components describe
// the seed only and are presented in the Methodology tab so the user can
// see the *reasoning* behind each default and decide whether it fits their
// own market view.
export interface BuildingBlock {
  /** Stable token used as a translation key (en/de). */
  key: string;
  /** Contribution to the expected return, in decimals (0.012 = 1.2 %). */
  value: number;
}
export interface BuildingBlocks {
  /** Short label for the family of decomposition (e.g. "Equity (DDM)"). */
  family: string;
  components: BuildingBlock[];
  /** One-sentence source / reasoning shown beneath the table. */
  source: string;
}
export const CMA_BUILDING_BLOCKS: Record<AssetKey, BuildingBlocks> = {
  equity_us: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.014 },
      { key: "bb.equity.buyback", value: 0.018 },
      { key: "bb.equity.realGrowth", value: 0.020 },
      { key: "bb.equity.inflation", value: 0.022 },
      { key: "bb.equity.valuationDrift", value: -0.004 },
    ],
    source: "bb.src.equity_us",
  },
  equity_eu: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.032 },
      { key: "bb.equity.buyback", value: 0.008 },
      { key: "bb.equity.realGrowth", value: 0.014 },
      { key: "bb.equity.inflation", value: 0.020 },
      { key: "bb.equity.valuationDrift", value: 0.001 },
    ],
    source: "bb.src.equity_eu",
  },
  equity_uk: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.039 },
      { key: "bb.equity.buyback", value: 0.010 },
      { key: "bb.equity.realGrowth", value: 0.005 },
      { key: "bb.equity.inflation", value: 0.022 },
      { key: "bb.equity.valuationDrift", value: -0.011 },
    ],
    source: "bb.src.equity_uk",
  },
  equity_ch: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.029 },
      { key: "bb.equity.buyback", value: 0.005 },
      { key: "bb.equity.realGrowth", value: 0.018 },
      { key: "bb.equity.inflation", value: 0.010 },
      { key: "bb.equity.valuationDrift", value: -0.002 },
    ],
    source: "bb.src.equity_ch",
  },
  equity_jp: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.024 },
      { key: "bb.equity.buyback", value: 0.012 },
      { key: "bb.equity.realGrowth", value: 0.010 },
      { key: "bb.equity.inflation", value: 0.015 },
      { key: "bb.equity.valuationDrift", value: -0.001 },
    ],
    source: "bb.src.equity_jp",
  },
  equity_em: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.028 },
      { key: "bb.equity.buyback", value: 0.002 },
      { key: "bb.equity.realGrowth", value: 0.030 },
      { key: "bb.equity.inflation", value: 0.030 },
      { key: "bb.equity.valuationDrift", value: -0.005 },
    ],
    source: "bb.src.equity_em",
  },
  equity_thematic: {
    family: "equity_ddm",
    components: [
      { key: "bb.equity.div", value: 0.010 },
      { key: "bb.equity.buyback", value: 0.005 },
      { key: "bb.equity.realGrowth", value: 0.045 },
      { key: "bb.equity.inflation", value: 0.022 },
      { key: "bb.equity.valuationDrift", value: -0.002 },
    ],
    source: "bb.src.equity_thematic",
  },
  bonds: {
    family: "bonds_ytm",
    components: [
      { key: "bb.bonds.ytm", value: 0.040 },
      { key: "bb.bonds.roll", value: 0.000 },
      { key: "bb.bonds.creditLoss", value: -0.005 },
    ],
    source: "bb.src.bonds",
  },
  cash: {
    family: "cash_rate",
    components: [{ key: "bb.cash.rate", value: 0.030 }],
    source: "bb.src.cash",
  },
  gold: {
    family: "gold_real",
    components: [
      { key: "bb.gold.real", value: 0.010 },
      { key: "bb.gold.inflation", value: 0.022 },
      { key: "bb.gold.hedge", value: 0.008 },
    ],
    source: "bb.src.gold",
  },
  reits: {
    family: "reits_income",
    components: [
      { key: "bb.reits.income", value: 0.040 },
      { key: "bb.reits.realGrowth", value: 0.005 },
      { key: "bb.reits.inflation", value: 0.020 },
    ],
    source: "bb.src.reits",
  },
  crypto: {
    family: "crypto_drift",
    components: [{ key: "bb.crypto.drift", value: 0.120 }],
    source: "bb.src.crypto",
  },
};

/** Sum of all building-block components — should be within ~50 bps of the seed. */
export function sumBuildingBlocks(key: AssetKey): number {
  return CMA_BUILDING_BLOCKS[key].components.reduce((s, c) => s + c.value, 0);
}

const C: Partial<Record<AssetKey, Partial<Record<AssetKey, number>>>> = {
  equity_us: { equity_eu: 0.82, equity_uk: 0.78, equity_ch: 0.70, equity_jp: 0.70, equity_em: 0.72, equity_thematic: 0.85, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.30 },
  equity_eu: { equity_uk: 0.85, equity_ch: 0.78, equity_jp: 0.65, equity_em: 0.72, equity_thematic: 0.78, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.28 },
  equity_uk: { equity_ch: 0.72, equity_jp: 0.55, equity_em: 0.62, equity_thematic: 0.65, bonds: 0.10, cash: 0.00, gold: 0.10, reits: 0.65, crypto: 0.25 },
  equity_ch: { equity_jp: 0.55, equity_em: 0.60, equity_thematic: 0.65, bonds: 0.15, cash: 0.00, gold: 0.10, reits: 0.62, crypto: 0.20 },
  equity_jp: { equity_em: 0.60, equity_thematic: 0.65, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.55, crypto: 0.22 },
  equity_em: { equity_thematic: 0.75, bonds: 0.05, cash: 0.00, gold: 0.15, reits: 0.65, crypto: 0.40 },
  equity_thematic: { bonds: 0.05, cash: 0.00, gold: 0.05, reits: 0.65, crypto: 0.45 },
  bonds: { cash: 0.40, gold: 0.20, reits: 0.30, crypto: 0.05 },
  cash: { gold: 0.05, reits: 0.00, crypto: 0.00 },
  gold: { reits: 0.10, crypto: 0.20 },
  reits: { crypto: 0.30 },
};

export function corr(a: AssetKey, b: AssetKey): number {
  if (a === b) return 1;
  const ab = C[a]?.[b];
  if (ab !== undefined) return ab;
  const ba = C[b]?.[a];
  if (ba !== undefined) return ba;
  return 0;
}

export interface AssetExposure {
  key: AssetKey;
  weight: number;
}

export function mapAllocationToAssets(allocation: AssetAllocation[]): AssetExposure[] {
  const map: Record<AssetKey, number> = {
    equity_us: 0, equity_eu: 0, equity_uk: 0, equity_ch: 0, equity_jp: 0, equity_em: 0,
    equity_thematic: 0, bonds: 0, cash: 0, gold: 0, reits: 0, crypto: 0,
  };
  for (const a of allocation) {
    const w = a.weight / 100;
    if (a.assetClass === "Fixed Income") map.bonds += w;
    else if (a.assetClass === "Cash") map.cash += w;
    else if (a.assetClass === "Commodities") map.gold += w;
    else if (a.assetClass === "Real Estate") map.reits += w;
    else if (a.assetClass === "Digital Assets") map.crypto += w;
    else if (a.assetClass === "Equity") {
      const r = a.region;
      if (r === "USA") map.equity_us += w;
      else if (r === "Europe") map.equity_eu += w;
      else if (r === "UK" || r === "United Kingdom") map.equity_uk += w;
      else if (r === "Switzerland") map.equity_ch += w;
      else if (r === "Japan") map.equity_jp += w;
      else if (r === "EM") map.equity_em += w;
      else map.equity_thematic += w;
    }
  }
  return (Object.keys(map) as AssetKey[])
    .filter((k) => map[k] > 0)
    .map((k) => ({ key: k, weight: map[k] }));
}

export function portfolioReturn(exp: AssetExposure[]): number {
  let r = 0;
  for (const e of exp) r += e.weight * CMA[e.key].expReturn;
  return r;
}

export function portfolioVol(exp: AssetExposure[]): number {
  let v = 0;
  for (let i = 0; i < exp.length; i++) {
    for (let j = 0; j < exp.length; j++) {
      const wi = exp[i].weight, wj = exp[j].weight;
      const si = CMA[exp[i].key].vol, sj = CMA[exp[j].key].vol;
      v += wi * wj * si * sj * corr(exp[i].key, exp[j].key);
    }
  }
  return Math.sqrt(Math.max(v, 0));
}

export function covariance(a: AssetExposure[], b: AssetExposure[]): number {
  let cov = 0;
  for (const ea of a) {
    for (const eb of b) {
      cov += ea.weight * eb.weight * CMA[ea.key].vol * CMA[eb.key].vol * corr(ea.key, eb.key);
    }
  }
  return cov;
}

// Benchmark: MSCI ACWI proxy (60/14/4/4/4/14 across US / EU-ex-UK / UK / CH / JP / EM).
// UK is broken out from the broad-Europe slice so a GBP investor's home market
// has its own benchmark slot, mirroring the existing CH carve-out.
export const BENCHMARK: AssetExposure[] = [
  { key: "equity_us", weight: 0.60 },
  { key: "equity_eu", weight: 0.14 },
  { key: "equity_uk", weight: 0.04 },
  { key: "equity_ch", weight: 0.04 },
  { key: "equity_jp", weight: 0.04 },
  { key: "equity_em", weight: 0.14 },
];

export interface PortfolioMetricsResult {
  expReturn: number;
  vol: number;
  sharpe: number;
  maxDrawdown: number;
  beta: number;
  alpha: number;
  trackingError: number;
  outperformance: number;
  benchmarkReturn: number;
  benchmarkVol: number;
}

export function computeMetrics(allocation: AssetAllocation[], baseCurrency: BaseCurrency): PortfolioMetricsResult {
  const rf = getRiskFreeRate(baseCurrency);
  const exp = mapAllocationToAssets(allocation);
  const r = portfolioReturn(exp);
  const v = portfolioVol(exp);
  const rB = portfolioReturn(BENCHMARK);
  const vB = portfolioVol(BENCHMARK);

  const cov_pb = covariance(exp, BENCHMARK);
  const beta = vB > 0 ? cov_pb / (vB * vB) : 0;
  const alpha = r - (rf + beta * (rB - rf));

  // Tracking error = stdev of (R_p - R_b) = sqrt(Var_p + Var_b - 2*Cov_pb)
  const teVar = v * v + vB * vB - 2 * cov_pb;
  const trackingError = Math.sqrt(Math.max(teVar, 0));

  // Heuristic max drawdown estimate: scales with vol and equity-likeness.
  const equityShare = exp
    .filter((e) => e.key.startsWith("equity_") || e.key === "reits" || e.key === "crypto")
    .reduce((s, e) => s + e.weight, 0);
  const maxDrawdown = -Math.min(0.85, (1.8 + 1.4 * equityShare) * v);

  const sharpe = v > 0 ? (r - rf) / v : 0;

  return {
    expReturn: r,
    vol: v,
    sharpe,
    maxDrawdown,
    beta,
    alpha,
    trackingError,
    outperformance: r - rB,
    benchmarkReturn: rB,
    benchmarkVol: vB,
  };
}

// Efficient frontier: scale equity sleeve from 0% to 100%, keeping internal mix.
export interface FrontierPoint {
  equityPct: number;
  vol: number;
  ret: number;
  sharpe: number;
  isCurrent?: boolean;
}

export function computeFrontier(allocation: AssetAllocation[], baseCurrency: BaseCurrency): { points: FrontierPoint[]; current: FrontierPoint } {
  const rf = getRiskFreeRate(baseCurrency);
  const exp = mapAllocationToAssets(allocation);
  const equityKeys: AssetKey[] = ["equity_us", "equity_eu", "equity_uk", "equity_ch", "equity_jp", "equity_em", "equity_thematic", "reits", "crypto"];
  const isEq = (k: AssetKey) => equityKeys.includes(k);

  const eqExp = exp.filter((e) => isEq(e.key));
  const defExp = exp.filter((e) => !isEq(e.key));

  const eqWeightSum = eqExp.reduce((s, e) => s + e.weight, 0);
  const defWeightSum = defExp.reduce((s, e) => s + e.weight, 0);

  const eqMix: AssetExposure[] = eqWeightSum > 0
    ? eqExp.map((e) => ({ key: e.key, weight: e.weight / eqWeightSum }))
    : [{ key: "equity_us", weight: 0.6 }, { key: "equity_eu", weight: 0.25 }, { key: "equity_em", weight: 0.15 }];
  const defMix: AssetExposure[] = defWeightSum > 0
    ? defExp.map((e) => ({ key: e.key, weight: e.weight / defWeightSum }))
    : [{ key: "bonds", weight: 0.85 }, { key: "cash", weight: 0.15 }];

  const points: FrontierPoint[] = [];
  for (let pct = 0; pct <= 100; pct += 5) {
    const w = pct / 100;
    const blended: AssetExposure[] = [
      ...eqMix.map((e) => ({ key: e.key, weight: e.weight * w })),
      ...defMix.map((e) => ({ key: e.key, weight: e.weight * (1 - w) })),
    ];
    const r = portfolioReturn(blended);
    const v = portfolioVol(blended);
    points.push({
      equityPct: pct,
      vol: v,
      ret: r,
      sharpe: v > 0 ? (r - rf) / v : 0,
    });
  }

  const currentEqPct = Math.round(eqWeightSum * 100);
  const r = portfolioReturn(exp);
  const v = portfolioVol(exp);
  const current: FrontierPoint = {
    equityPct: currentEqPct,
    vol: v,
    ret: r,
    sharpe: v > 0 ? (r - rf) / v : 0,
    isCurrent: true,
  };
  return { points, current };
}

export interface CorrelationCell {
  a: string;
  b: string;
  value: number;
}

// Stable display order for the correlation matrix: equities first
// (developed → EM → thematic), then bonds & cash, then real assets,
// finishing with crypto. Matches the visual grouping used in §4 of
// the Methodology tab.
const CORR_DISPLAY_ORDER: AssetKey[] = [
  "equity_us", "equity_eu", "equity_uk", "equity_ch", "equity_jp", "equity_em", "equity_thematic",
  "bonds", "cash",
  "gold", "reits", "crypto",
];

export function buildCorrelationMatrix(allocation: AssetAllocation[]): {
  keys: AssetKey[];
  labels: string[];
  matrix: number[][];
  held: boolean[];
} {
  const exp = mapAllocationToAssets(allocation);
  const heldSet = new Set<AssetKey>(exp.map((e) => e.key));
  const keys = [...CORR_DISPLAY_ORDER];
  const labels = keys.map((k) => CMA[k].label);
  const matrix = keys.map((a) => keys.map((b) => corr(a, b)));
  const held = keys.map((k) => heldSet.has(k));
  return { keys, labels, matrix, held };
}
