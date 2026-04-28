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
      Pick<ETFImplementation, "bucket" | "terBps">
    >;
  } = {},
) {
  let totalWeight = 0;
  let blendedTerBpsWeighted = 0;

  const hedgingCostBps = options.hedged ? options.hedgingCostBps ?? 15 : 0;
  const terByBucket = new Map<string, number>();
  for (const e of options.etfImplementations ?? []) {
    if (typeof e.terBps === "number" && Number.isFinite(e.terBps)) {
      terByBucket.set(e.bucket, e.terBps);
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
    return {
      key: bucketKey,
      weight: a.weight,
      terBps,
      contributionBps
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
