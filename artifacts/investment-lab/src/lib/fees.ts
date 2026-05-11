import { AssetAllocation, ETFImplementation } from "./types";

export const TER_BPS_BY_ASSET_CLASS: Record<string, number> = {
  "Cash": 10,
  "Fixed Income": 15,
  "Commodities": 25,
  "Real Estate": 35,
  "Digital Assets": 95,
};

export function getETFTer(assetClass: string, region: string): number {
  if (TER_BPS_BY_ASSET_CLASS[assetClass]) {
    return TER_BPS_BY_ASSET_CLASS[assetClass];
  }
  
  if (assetClass === "Equity") {
    if (region === "EM" || region === "Emerging Markets") return 25;
    if (["Technology", "Healthcare", "Sustainability", "Cybersecurity"].includes(region)) return 45;
    // Default core regions
    return 12;
  }
  
  return 15; // fallback
}

export function estimateFees(
  allocation: AssetAllocation[],
  horizonYears: number,
  investmentAmount: number,
  options: {
    hedgingCostBps?: number;
    hedged?: boolean;
    /**
     * Optional. Per-bucket ETF implementations from the BuildPortfolio table.
     * When provided, the actual `terBps` of the ETF the operator picked is
     * used for that bucket instead of the asset-class default from
     * TER_BPS_BY_ASSET_CLASS / getETFTer. This is what makes the Fee
     * Estimator react when the operator switches an ETF in the per-bucket
     * picker — without it the panel was frozen on the asset-class default.
     * Lookup is keyed by `${assetClass} - ${region}`, which matches both
     * AssetAllocation rows and the `bucket` field set by
     * src/lib/portfolio.ts.
     */
    etfImplementations?: ReadonlyArray<
      Pick<ETFImplementation, "bucket" | "terBps"> &
        Partial<Pick<ETFImplementation, "weight" | "terSource">>
    >;
  } = {},
) {
  let totalWeight = 0;
  let blendedTerBpsWeighted = 0;

  const hedgingCostBps = options.hedged ? options.hedgingCostBps ?? 15 : 0;
  const terByBucket = new Map<string, number>();
  const terWeightedSumByBucket = new Map<string, number>();
  const terWeightTotalByBucket = new Map<string, number>();
  // Task #271 — surface the per-row TER provenance ("operator" / "justetf"
  // / "default") on the breakdown rows so the Fee Estimator can render a
  // small badge per row. We only set a source when ALL contributing
  // implementation rows for a bucket agree on the same source — a mixed
  // bucket (e.g. one operator-typed + one fallback, OR a catalog row
  // without source plus a manual row with one) is intentionally left
  // undefined so we never mislabel a blended row.
  const terSourceByBucket = new Map<
    string,
    "operator" | "justetf" | "default" | "mixed" | undefined
  >();
  const bucketHasUnknownSource = new Set<string>();
  for (const e of options.etfImplementations ?? []) {
    if (typeof e.terBps !== "number" || !Number.isFinite(e.terBps)) continue;
    // Treat missing/invalid weight as 1 so a single-ETF bucket still works
    // (and so multi-ETF buckets without supplied weights degrade to a plain
    // equal-weight average instead of silently dropping entries).
    const w =
      typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight > 0
        ? e.weight
        : 1;
    terWeightedSumByBucket.set(
      e.bucket,
      (terWeightedSumByBucket.get(e.bucket) ?? 0) + e.terBps * w
    );
    terWeightTotalByBucket.set(
      e.bucket,
      (terWeightTotalByBucket.get(e.bucket) ?? 0) + w
    );
    if (e.terSource) {
      const prev = terSourceByBucket.get(e.bucket);
      if (prev === undefined) {
        terSourceByBucket.set(e.bucket, e.terSource);
      } else if (prev !== "mixed" && prev !== e.terSource) {
        terSourceByBucket.set(e.bucket, "mixed");
      }
    } else {
      // A contributor without a known source (typical for catalog rows)
      // is itself a distinct provenance — flag the bucket so the
      // resolver below downgrades to undefined.
      bucketHasUnknownSource.add(e.bucket);
    }
  }
  for (const [bucket, weightedSum] of terWeightedSumByBucket) {
    const totalWeight = terWeightTotalByBucket.get(bucket) ?? 0;
    if (totalWeight > 0) {
      terByBucket.set(bucket, weightedSum / totalWeight);
    }
  }

  const breakdown = allocation.map(a => {
    const bucketKey = `${a.assetClass} - ${a.region}`;
    // Prefer the picked-ETF TER (bucket-keyed) over the asset-class default.
    // Cash buckets are excluded from the implementation table, so for them
    // we always fall back to the table.
    const baseTer = terByBucket.get(bucketKey) ?? getETFTer(a.assetClass, a.region);
    // Hedging cost only applies to instruments that can be hedged (equity, FI, real estate)
    const canHedge =
      hedgingCostBps > 0 &&
      (a.assetClass === "Equity" || a.assetClass === "Fixed Income" || a.assetClass === "Real Estate");
    const terBps = baseTer + (canHedge ? hedgingCostBps : 0);
    const contributionBps = terBps * (a.weight / 100);
    totalWeight += a.weight;
    blendedTerBpsWeighted += contributionBps;
    const rawSource = terSourceByBucket.get(bucketKey);
    const hasUnknown = bucketHasUnknownSource.has(bucketKey);
    const terSource: "operator" | "justetf" | "default" | undefined =
      !hasUnknown &&
      (rawSource === "operator" || rawSource === "justetf" || rawSource === "default")
        ? rawSource
        : undefined;
    return {
      key: bucketKey,
      weight: a.weight,
      terBps,
      contributionBps,
      terSource,
    };
  });
  
  const blendedTerBps = totalWeight > 0 ? (blendedTerBpsWeighted / (totalWeight / 100)) : 0;
  const blendedTerPct = blendedTerBps / 100;
  const annualFee = investmentAmount * (blendedTerPct / 100);
  
  breakdown.sort((a, b) => b.contributionBps - a.contributionBps);
  
  const grossReturn = 0.05; // 5%
  let currentZeroFee = investmentAmount;
  let currentAfterFees = investmentAmount;
  let projectedTotalFees = 0;
  
  const projection = [{
    year: 0,
    zeroFee: currentZeroFee,
    afterFees: currentAfterFees,
    feePaid: 0
  }];
  
  for (let y = 1; y <= horizonYears; y++) {
    currentZeroFee = currentZeroFee * (1 + grossReturn);
    
    currentAfterFees = currentAfterFees * (1 + grossReturn);
    const feeThisYear = currentAfterFees * (blendedTerPct / 100);
    currentAfterFees -= feeThisYear;
    projectedTotalFees += feeThisYear;
    
    projection.push({
      year: y,
      zeroFee: currentZeroFee,
      afterFees: currentAfterFees,
      feePaid: feeThisYear
    });
  }
  
  const feeDragPct = currentZeroFee > 0 ? ((currentZeroFee - currentAfterFees) / currentZeroFee) * 100 : 0;
  
  return {
    blendedTerBps,
    blendedTerPct,
    annualFee,
    projectedTotalFees,
    projectedFinalValueAfterFees: currentAfterFees,
    projectedFinalValueZeroFee: currentZeroFee,
    feeDragPct,
    breakdown,
    projection
  };
}
