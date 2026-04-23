import { PortfolioOutput } from "./types";

export interface DiffRow {
  key: string;
  assetClass: string;
  region: string;
  a: number;
  b: number;
  delta: number; // b - a
}

export interface PortfolioDiff {
  equityDelta: number;
  rows: DiffRow[];
  observations: string[];
}

export function diffPortfolios(a: PortfolioOutput, b: PortfolioOutput): PortfolioDiff {
  const getEquityWeight = (p: PortfolioOutput) => 
    p.allocation.filter(x => x.assetClass === "Equity").reduce((sum, curr) => sum + curr.weight, 0);
  
  const getBondWeight = (p: PortfolioOutput) => 
    p.allocation.filter(x => x.assetClass === "Fixed Income").reduce((sum, curr) => sum + curr.weight, 0);

  const getCryptoWeight = (p: PortfolioOutput) => 
    p.allocation.filter(x => x.assetClass === "Digital Assets").reduce((sum, curr) => sum + curr.weight, 0);

  const equityA = getEquityWeight(a);
  const equityB = getEquityWeight(b);
  const equityDelta = equityB - equityA;

  const bondA = getBondWeight(a);
  const bondB = getBondWeight(b);

  const cryptoA = getCryptoWeight(a);
  const cryptoB = getCryptoWeight(b);

  const rowMap = new Map<string, DiffRow>();

  for (const alloc of a.allocation) {
    const key = `${alloc.assetClass} - ${alloc.region}`;
    rowMap.set(key, { key, assetClass: alloc.assetClass, region: alloc.region, a: alloc.weight, b: 0, delta: 0 });
  }

  for (const alloc of b.allocation) {
    const key = `${alloc.assetClass} - ${alloc.region}`;
    if (rowMap.has(key)) {
      const existing = rowMap.get(key)!;
      existing.b = alloc.weight;
      existing.delta = existing.b - existing.a;
    } else {
      rowMap.set(key, { key, assetClass: alloc.assetClass, region: alloc.region, a: 0, b: alloc.weight, delta: alloc.weight });
    }
  }

  for (const val of rowMap.values()) {
    val.delta = val.b - val.a;
  }

  const rows = Array.from(rowMap.values()).sort((r1, r2) => Math.abs(r2.delta) - Math.abs(r1.delta));

  const observations: string[] = [];

  if (equityDelta > 10) {
    observations.push(`Portfolio B has significantly higher equity exposure (+${equityDelta.toFixed(1)}%).`);
  } else if (equityDelta < -10) {
    observations.push(`Portfolio A has significantly higher equity exposure (+${Math.abs(equityDelta).toFixed(1)}%).`);
  } else {
    observations.push(`Both portfolios have a similar core equity vs. defensive split.`);
  }

  if (bondA > bondB + 10) {
    observations.push(`Portfolio A is more bond-heavy, offering greater drawdown protection.`);
  } else if (bondB > bondA + 10) {
    observations.push(`Portfolio B is more bond-heavy, offering greater drawdown protection.`);
  }

  if (cryptoA > 0 && cryptoB === 0) {
    observations.push(`Portfolio A includes a digital assets satellite.`);
  } else if (cryptoB > 0 && cryptoA === 0) {
    observations.push(`Portfolio B includes a digital assets satellite.`);
  }

  const aETFs = a.allocation.length;
  const bETFs = b.allocation.length;
  if (aETFs > bETFs + 3) {
    observations.push(`Portfolio A is more granularly segmented (${aETFs} components vs ${bETFs}).`);
  } else if (bETFs > aETFs + 3) {
    observations.push(`Portfolio B is more granularly segmented (${bETFs} components vs ${aETFs}).`);
  }

  return {
    equityDelta,
    rows,
    observations
  };
}