import { AssetAllocation } from "./types";

export type AssetKey =
  | "equity_us"
  | "equity_eu"
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

export const CMA: Record<AssetKey, AssetCMA> = {
  equity_us:        { key: "equity_us",        label: "US Equity",         expReturn: 0.070, vol: 0.16 },
  equity_eu:        { key: "equity_eu",        label: "Europe Equity",     expReturn: 0.075, vol: 0.17 },
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

export const RISK_FREE_RATE = 0.025;

const C: Partial<Record<AssetKey, Partial<Record<AssetKey, number>>>> = {
  equity_us: { equity_eu: 0.82, equity_ch: 0.70, equity_jp: 0.70, equity_em: 0.72, equity_thematic: 0.85, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.30 },
  equity_eu: { equity_ch: 0.78, equity_jp: 0.65, equity_em: 0.72, equity_thematic: 0.78, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.28 },
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
    equity_us: 0, equity_eu: 0, equity_ch: 0, equity_jp: 0, equity_em: 0,
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

// Benchmark: MSCI ACWI proxy (60/18/4/4/14 across US/EU/CH/JP/EM)
export const BENCHMARK: AssetExposure[] = [
  { key: "equity_us", weight: 0.60 },
  { key: "equity_eu", weight: 0.18 },
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

export function computeMetrics(allocation: AssetAllocation[]): PortfolioMetricsResult {
  const exp = mapAllocationToAssets(allocation);
  const r = portfolioReturn(exp);
  const v = portfolioVol(exp);
  const rB = portfolioReturn(BENCHMARK);
  const vB = portfolioVol(BENCHMARK);

  const cov_pb = covariance(exp, BENCHMARK);
  const beta = vB > 0 ? cov_pb / (vB * vB) : 0;
  const alpha = r - (RISK_FREE_RATE + beta * (rB - RISK_FREE_RATE));

  // Tracking error = stdev of (R_p - R_b) = sqrt(Var_p + Var_b - 2*Cov_pb)
  const teVar = v * v + vB * vB - 2 * cov_pb;
  const trackingError = Math.sqrt(Math.max(teVar, 0));

  // Heuristic max drawdown estimate: scales with vol and equity-likeness.
  const equityShare = exp
    .filter((e) => e.key.startsWith("equity_") || e.key === "reits" || e.key === "crypto")
    .reduce((s, e) => s + e.weight, 0);
  const maxDrawdown = -Math.min(0.85, (1.8 + 1.4 * equityShare) * v);

  const sharpe = v > 0 ? (r - RISK_FREE_RATE) / v : 0;

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

export function computeFrontier(allocation: AssetAllocation[]): { points: FrontierPoint[]; current: FrontierPoint } {
  const exp = mapAllocationToAssets(allocation);
  const equityKeys: AssetKey[] = ["equity_us", "equity_eu", "equity_ch", "equity_jp", "equity_em", "equity_thematic", "reits", "crypto"];
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
      sharpe: v > 0 ? (r - RISK_FREE_RATE) / v : 0,
    });
  }

  const currentEqPct = Math.round(eqWeightSum * 100);
  const r = portfolioReturn(exp);
  const v = portfolioVol(exp);
  const current: FrontierPoint = {
    equityPct: currentEqPct,
    vol: v,
    ret: r,
    sharpe: v > 0 ? (r - RISK_FREE_RATE) / v : 0,
    isCurrent: true,
  };
  return { points, current };
}

export interface CorrelationCell {
  a: string;
  b: string;
  value: number;
}

export function buildCorrelationMatrix(allocation: AssetAllocation[]): { labels: string[]; matrix: number[][] } {
  const exp = mapAllocationToAssets(allocation);
  const keys = exp.map((e) => e.key);
  const labels = keys.map((k) => CMA[k].label);
  const matrix = keys.map((a) => keys.map((b) => corr(a, b)));
  return { labels, matrix };
}
