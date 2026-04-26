import { AssetAllocation } from "./types";
import { CMA, AssetKey, corr } from "./metrics";

// Map an (assetClass, region) pair to the CMA key. Mirrors the logic in
// metrics.mapAllocationToAssets so Monte Carlo, Sharpe and the frontier all
// draw from the same single source of truth (CMA — including any user
// overrides applied via applyCMALayers).
function bucketKey(assetClass: string, region: string): AssetKey {
  const ac = assetClass.toLowerCase();
  const rg = region.toLowerCase();
  if (ac.includes("cash")) return "cash";
  if (ac.includes("fixed") || ac.includes("bond")) return "bonds";
  if (ac.includes("commod")) return "gold";
  if (ac.includes("real estate")) return "reits";
  if (ac.includes("digital") || ac.includes("crypto")) return "crypto";
  if (ac.includes("equity")) {
    if (rg.includes("usa")) return "equity_us";
    if (rg.includes("switzer")) return "equity_ch";
    if (rg === "uk" || rg.includes("united kingdom")) return "equity_uk";
    if (rg.includes("europ")) return "equity_eu";
    if (rg.includes("japan")) return "equity_jp";
    if (rg.includes("em")) return "equity_em";
    return "equity_thematic";
  }
  return "equity_thematic";
}

export interface BucketAssumption {
  mu: number;
  sigma: number;
}

export interface MonteCarloResult {
  expectedReturn: number;
  expectedVol: number;
  paths: { year: number; p10: number; p50: number; p90: number }[];
  finalP10: number;
  finalP50: number;
  finalP90: number;
  probLoss: number;
  probDoubled: number;
  initial: number;
}

function bucketAssumption(
  assetClass: string,
  region: string,
  hedged: boolean = false,
  baseCurrency: string = "USD"
): BucketAssumption {
  const key = bucketKey(assetClass, region);
  const cma = CMA[key];
  let mu = cma.expReturn;
  let sigma = cma.vol;

  // FX-hedge sigma reduction for foreign equity. Applied after reading CMA so
  // user overrides + hedging stay composable. Removing FX vol typically cuts
  // ~3pp of total sigma for developed markets, ~2pp for EM. Keep a floor.
  if (key.startsWith("equity_") && hedged) {
    const homeKey: Record<string, AssetKey | undefined> = {
      USD: "equity_us", EUR: "equity_eu", GBP: "equity_uk", CHF: "equity_ch",
    };
    const isForeignEquity = homeKey[baseCurrency] !== key;
    if (isForeignEquity) {
      const cut = key === "equity_em" ? 0.02 : 0.03;
      sigma = Math.max(0.05, sigma - cut);
    }
  }
  return { mu, sigma };
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function runMonteCarlo(
  allocation: AssetAllocation[],
  horizonYears: number,
  initial: number,
  options: {
    paths?: number;
    seed?: number;
    hedged?: boolean;
    baseCurrency?: string;
  } = {}
): MonteCarloResult {
  const numPaths = options.paths ?? 2000;
  const seed = options.seed ?? 42;
  const hedged = options.hedged ?? false;
  const baseCurrency = options.baseCurrency ?? "USD";

  let portfolioMu = 0;

  // Build per-bucket (weight, mu, sigma, key) so we can compute portfolio
  // variance using the FULL covariance matrix below — i.e. accounting for
  // the diversification benefit of imperfectly correlated assets, the same
  // way metrics.portfolioVol does. This keeps Monte Carlo's headline
  // "Expected Volatility" line up with the analytical Risk & Performance
  // Metrics view (modulo the FX-hedge sigma reduction below, which is
  // intentionally a Monte-Carlo-only feature).
  const buckets: { weight: number; mu: number; sigma: number; key: AssetKey }[] = [];
  for (const a of allocation) {
    const w = a.weight / 100;
    const { mu, sigma } = bucketAssumption(a.assetClass, a.region, hedged, baseCurrency);
    const key = bucketKey(a.assetClass, a.region);
    buckets.push({ weight: w, mu, sigma, key });
    portfolioMu += w * mu;
  }

  // σ_p = sqrt( ΣΣ w_i w_j σ_i σ_j ρ_ij ). Self-pairs contribute the old
  // diagonal w² σ² terms (corr(k, k) === 1); off-diagonal pairs add the
  // cross-asset covariance that the previous diagonal-only formula
  // ignored. For a single-asset portfolio this collapses to w² σ², so the
  // existing single-asset hedged/unhedged regression tests still hold.
  let portfolioVar = 0;
  for (let i = 0; i < buckets.length; i++) {
    for (let j = 0; j < buckets.length; j++) {
      const bi = buckets[i];
      const bj = buckets[j];
      portfolioVar += bi.weight * bj.weight * bi.sigma * bj.sigma * corr(bi.key, bj.key);
    }
  }
  const portfolioSigma = Math.sqrt(Math.max(portfolioVar, 0));

  const years = Math.max(1, Math.round(horizonYears));
  const finalsPerYear: number[][] = Array.from({ length: years + 1 }, () => []);

  const rng = mulberry32(seed);

  for (let p = 0; p < numPaths; p++) {
    let value = initial;
    finalsPerYear[0].push(value);
    for (let y = 1; y <= years; y++) {
      const z = gaussian(rng);
      const r = portfolioMu - 0.5 * portfolioSigma * portfolioSigma + portfolioSigma * z;
      value = value * Math.exp(r);
      finalsPerYear[y].push(value);
    }
  }

  const paths = finalsPerYear.map((vals, y) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      year: y,
      p10: quantile(sorted, 0.1),
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
    };
  });

  const finals = finalsPerYear[years];
  const sortedFinals = [...finals].sort((a, b) => a - b);
  const finalP10 = quantile(sortedFinals, 0.1);
  const finalP50 = quantile(sortedFinals, 0.5);
  const finalP90 = quantile(sortedFinals, 0.9);
  const probLoss = finals.filter((v) => v < initial).length / finals.length;
  const probDoubled = finals.filter((v) => v >= initial * 2).length / finals.length;

  return {
    expectedReturn: portfolioMu,
    expectedVol: portfolioSigma,
    paths,
    finalP10,
    finalP50,
    finalP90,
    probLoss,
    probDoubled,
    initial,
  };
}
