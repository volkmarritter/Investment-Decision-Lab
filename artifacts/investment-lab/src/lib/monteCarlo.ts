import { AssetAllocation, BaseCurrency } from "./types";
import { CMA, AssetKey, corr, BENCHMARK, whtDragForKey } from "./metrics";

// Map an (assetClass, region) pair to the CMA key. Mirrors the logic in
// metrics.mapAllocationToAssets so Monte Carlo, Sharpe and the frontier all
// draw from the same single source of truth (CMA — including any user
// overrides applied via applyCMALayers). "Home" / "Global" are the engine's
// equity-sleeve compaction labels (see portfolio.ts:280-287); they must
// resolve to real region keys instead of falling through to thematic, or
// vol / Sharpe / TE / beta drift away from reality.
const HOME_BUCKET: Record<string, AssetKey> = {
  USD: "equity_us", EUR: "equity_eu", GBP: "equity_uk", CHF: "equity_ch",
};
function bucketKey(assetClass: string, region: string, baseCurrency: string = "USD"): AssetKey {
  const ac = assetClass.toLowerCase();
  const rg = region.toLowerCase();
  if (ac.includes("cash")) return "cash";
  if (ac.includes("fixed") || ac.includes("bond")) return "bonds";
  if (ac.includes("commod")) return "gold";
  if (ac.includes("real estate")) return "reits";
  if (ac.includes("digital") || ac.includes("crypto")) return "crypto";
  if (ac.includes("equity")) {
    if (rg === "home") return HOME_BUCKET[baseCurrency] ?? "equity_us";
    if (rg.includes("usa")) return "equity_us";
    if (rg.includes("switzer")) return "equity_ch";
    if (rg === "uk" || rg.includes("united kingdom")) return "equity_uk";
    if (rg.includes("europ")) return "equity_eu";
    if (rg.includes("japan")) return "equity_jp";
    if (rg.includes("em")) return "equity_em";
    // "Global" intentionally falls through here — runMonteCarlo expands
    // a single Global row across the BENCHMARK weights (see below) so
    // we never collapse it into one bucket the way other regions do.
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
  // Tail-risk measures: average outcome in the worst (1 - q) tail of the
  // simulated paths at the horizon. Convention follows institutional usage:
  // - cvarXXFinal: monetary value (currency, average over the worst tail)
  // - cvarXXReturn: cumulative return over the horizon vs. `initial`
  //   (e.g. -0.45 means the average path in the worst tail loses 45 %).
  // Reported at 95 % and 99 % confidence levels — both are common in CFA-
  // and Solvency-II-style risk reports. CVaR (Expected Shortfall) is a
  // strict generalisation of VaR: it tells you what the loss looks like
  // *given* you are already in the tail, not just the threshold itself.
  cvar95Final: number;
  cvar95Return: number;
  cvar99Final: number;
  cvar99Return: number;
  // Path-based realized maximum drawdown. For each simulated path we track
  // the running peak across all years and record the worst peak-to-trough
  // drop; we then summarise the distribution across paths.
  // - realizedMddP50: median realized MDD (the "typical" path's worst drop)
  // - realizedMddP05: 5th-percentile realized MDD — a true tail measure that
  //   answers "how bad does it get in the worst 5 % of histories?"
  // Both are negative numbers (e.g. -0.32 = -32 %). Replaces the older
  // analytical heuristic `MDD ≈ -(1.8 + 1.4·equityShare)·σ` for the MC view.
  realizedMddP50: number;
  realizedMddP05: number;
}

function bucketAssumption(
  assetClass: string,
  region: string,
  hedged: boolean = false,
  baseCurrency: BaseCurrency = "USD",
  syntheticUsEffective: boolean = false,
): BucketAssumption {
  const key = bucketKey(assetClass, region, baseCurrency);
  const cma = CMA[key];
  // Net of irrecoverable WHT on dividends — same drag definition used by
  // computeMetrics, so MC paths and the analytical Risk & Performance
  // metrics agree on the headline expected return. Synthetic-US carve-out
  // is honoured here too, so MC and analytical views shift together when
  // the toggle flips.
  let mu = cma.expReturn - whtDragForKey(key, baseCurrency, syntheticUsEffective);
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
    baseCurrency?: BaseCurrency;
    syntheticUsEffective?: boolean;
  } = {}
): MonteCarloResult {
  const numPaths = options.paths ?? 2000;
  const seed = options.seed ?? 42;
  const hedged = options.hedged ?? false;
  const baseCurrency: BaseCurrency = options.baseCurrency ?? "USD";
  const syntheticUsEffective = options.syntheticUsEffective ?? false;

  let portfolioMu = 0;

  // Build per-bucket (weight, mu, sigma, key) so we can compute portfolio
  // variance using the FULL covariance matrix below — i.e. accounting for
  // the diversification benefit of imperfectly correlated assets, the same
  // way metrics.portfolioVol does. This keeps Monte Carlo's headline
  // "Expected Volatility" line up with the analytical Risk & Performance
  // Metrics view (modulo the FX-hedge sigma reduction below, which is
  // intentionally a Monte-Carlo-only feature).
  // Equity-sleeve compaction: an "Equity-Global" (MSCI ACWI IMI) row
  // expands across the BENCHMARK regional weights so MC vol / Sharpe stay
  // consistent with metrics.mapAllocationToAssets. Without this, Global
  // would collapse to one bucket and produce a different sigma than the
  // analytical Risk & Performance Metrics view.
  const expanded: { assetClass: string; region: string; weight: number }[] = [];
  const benchSum = BENCHMARK.reduce((s, e) => s + e.weight, 0);
  for (const a of allocation) {
    if (a.assetClass === "Equity" && a.region === "Global") {
      for (const b of BENCHMARK) {
        const regionLabel =
          b.key === "equity_us" ? "USA" :
          b.key === "equity_eu" ? "Europe" :
          b.key === "equity_uk" ? "UK" :
          b.key === "equity_ch" ? "Switzerland" :
          b.key === "equity_jp" ? "Japan" : "EM";
        expanded.push({ assetClass: "Equity", region: regionLabel, weight: a.weight * (b.weight / benchSum) });
      }
    } else {
      expanded.push({ assetClass: a.assetClass, region: a.region, weight: a.weight });
    }
  }

  const buckets: { weight: number; mu: number; sigma: number; key: AssetKey }[] = [];
  for (const a of expanded) {
    const w = a.weight / 100;
    const { mu, sigma } = bucketAssumption(a.assetClass, a.region, hedged, baseCurrency, syntheticUsEffective);
    const key = bucketKey(a.assetClass, a.region, baseCurrency);
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

  // Conditional-VaR (Expected Shortfall) at 95 % and 99 %. We average the
  // bottom (1 - q) fraction of `sortedFinals`. With the default 2 000 paths
  // that's the worst 100 paths for 95 % and the worst 20 paths for 99 % —
  // small enough to be visibly noisier than P10 (intentional) but big
  // enough to be stable under reseed. We always include at least 1 path so
  // the helper is well-defined for tiny path counts in tests.
  const cvarTail = (q: number): number => {
    const k = Math.max(1, Math.floor(sortedFinals.length * (1 - q)));
    let sum = 0;
    for (let i = 0; i < k; i++) sum += sortedFinals[i];
    return sum / k;
  };
  const cvar95Final = cvarTail(0.95);
  const cvar99Final = cvarTail(0.99);
  const cvar95Return = initial > 0 ? cvar95Final / initial - 1 : 0;
  const cvar99Return = initial > 0 ? cvar99Final / initial - 1 : 0;

  // Path-based realized maximum drawdown. For each path, walk the full
  // value series, track the running peak, and record the worst (current/
  // peak − 1). This replaces the analytical heuristic from metrics.ts for
  // the MC view — it is simulation-honest, properly tail-aware, and
  // independent of the equity-share scaler. Note finalsPerYear[y][p] is
  // the value of path p at year y; `years + 1` rows including y = 0.
  const pathMdds: number[] = new Array(numPaths);
  for (let p = 0; p < numPaths; p++) {
    let peak = -Infinity;
    let worstDd = 0;
    for (let y = 0; y <= years; y++) {
      const v = finalsPerYear[y][p];
      if (v > peak) peak = v;
      const dd = peak > 0 ? v / peak - 1 : 0;
      if (dd < worstDd) worstDd = dd;
    }
    pathMdds[p] = worstDd;
  }
  const sortedMdds = [...pathMdds].sort((a, b) => a - b); // most-negative first
  const realizedMddP05 = quantile(sortedMdds, 0.05);
  const realizedMddP50 = quantile(sortedMdds, 0.5);

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
    cvar95Final,
    cvar95Return,
    cvar99Final,
    cvar99Return,
    realizedMddP50,
    realizedMddP05,
  };
}
