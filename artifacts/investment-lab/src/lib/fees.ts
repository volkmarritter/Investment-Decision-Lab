import { AssetAllocation } from "./types";

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
  options: { hedgingCostBps?: number; hedged?: boolean } = {}
) {
  let totalWeight = 0;
  let blendedTerBpsWeighted = 0;

  const hedgingCostBps = options.hedged ? options.hedgingCostBps ?? 15 : 0;

  const breakdown = allocation.map(a => {
    const baseTer = getETFTer(a.assetClass, a.region);
    // Hedging cost only applies to instruments that can be hedged (equity, FI, real estate)
    const canHedge =
      hedgingCostBps > 0 &&
      (a.assetClass === "Equity" || a.assetClass === "Fixed Income" || a.assetClass === "Real Estate");
    const terBps = baseTer + (canHedge ? hedgingCostBps : 0);
    const contributionBps = terBps * (a.weight / 100);
    totalWeight += a.weight;
    blendedTerBpsWeighted += contributionBps;
    return {
      key: `${a.assetClass} - ${a.region}`,
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
