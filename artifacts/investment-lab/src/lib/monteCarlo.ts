import { AssetAllocation } from "./types";

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
  const ac = assetClass.toLowerCase();
  const rg = region.toLowerCase();

  if (ac.includes("cash")) return { mu: 0.02, sigma: 0.005 };
  if (ac.includes("fixed") || ac.includes("bond")) return { mu: 0.035, sigma: 0.06 };
  if (ac.includes("commod")) return { mu: 0.04, sigma: 0.16 };
  if (ac.includes("real estate")) return { mu: 0.06, sigma: 0.18 };
  if (ac.includes("digital") || ac.includes("crypto")) return { mu: 0.18, sigma: 0.7 };
  let baseEq: BucketAssumption | null = null;
  let isForeignEquity = false;
  if (ac.includes("equity")) {
    if (rg.includes("usa")) {
      baseEq = { mu: 0.07, sigma: 0.16 };
      isForeignEquity = baseCurrency !== "USD";
    } else if (rg.includes("switzer")) {
      baseEq = { mu: 0.055, sigma: 0.14 };
      isForeignEquity = baseCurrency !== "CHF";
    } else if (rg.includes("europ")) {
      baseEq = { mu: 0.065, sigma: 0.17 };
      isForeignEquity = baseCurrency !== "EUR";
    } else if (rg.includes("japan") && rg.includes("em")) {
      baseEq = { mu: 0.075, sigma: 0.19 };
      isForeignEquity = true;
    } else if (rg.includes("japan")) {
      baseEq = { mu: 0.06, sigma: 0.17 };
      isForeignEquity = true;
    } else if (rg.includes("em")) {
      baseEq = { mu: 0.085, sigma: 0.22 };
      isForeignEquity = true;
    } else {
      baseEq = { mu: 0.075, sigma: 0.2 };
      isForeignEquity = true;
    }
    if (hedged && isForeignEquity) {
      // Removing FX vol typically cuts ~3pp of total sigma for developed markets,
      // ~2pp for EM (where local market vol dominates). Keep a floor.
      const cut = rg.includes("em") ? 0.02 : 0.03;
      baseEq = { mu: baseEq.mu, sigma: Math.max(0.05, baseEq.sigma - cut) };
    }
    return baseEq;
  }
  return { mu: 0.05, sigma: 0.12 };
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
  let portfolioVar = 0;

  const buckets: { weight: number; mu: number; sigma: number }[] = [];
  for (const a of allocation) {
    const w = a.weight / 100;
    const { mu, sigma } = bucketAssumption(a.assetClass, a.region, hedged, baseCurrency);
    buckets.push({ weight: w, mu, sigma });
    portfolioMu += w * mu;
    portfolioVar += w * w * sigma * sigma;
  }
  const portfolioSigma = Math.sqrt(portfolioVar);

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
