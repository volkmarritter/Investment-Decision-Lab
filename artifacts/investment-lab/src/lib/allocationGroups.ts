import type { AssetAllocation } from "./types";

export type AllocationGroup = "Cash" | "Bonds" | "Equities" | "Satellites";

export const ALLOCATION_GROUPS: ReadonlyArray<AllocationGroup> = [
  "Cash",
  "Bonds",
  "Equities",
  "Satellites",
];

// Short codes are matched only as exact tokens (avoids "China" matching "ch",
// "Bermuda" matching "bm", etc.). Multi-word names are matched as substrings.
const REGIONAL_EQUITY_EXACT = new Set([
  "us",
  "usa",
  "ch",
  "dm",
  "em",
  "uk",
]);
const REGIONAL_EQUITY_SUBSTRINGS = [
  "united states",
  "europe",
  "switzerland",
  "japan",
  "emerging market",
  "developed market",
  "world",
  "global",
];

// Thematic preference labels per ThematicPreference type in src/lib/types.ts.
// Matched as substrings since they appear as the full region label for
// thematic equity sleeves (e.g. region = "Sustainability").
const THEMATIC_REGION_TOKENS = [
  "technology",
  "healthcare",
  "sustainability",
  "cybersecurity",
];

export function classifyGroup(
  assetClass: string,
  region: string,
): AllocationGroup {
  const ac = (assetClass ?? "").toLowerCase().trim();
  const rg = (region ?? "").toLowerCase().trim();

  if (ac.includes("cash") || ac.includes("money market")) return "Cash";
  if (ac.includes("bond") || ac.includes("fixed")) return "Bonds";
  if (
    ac.includes("commod") ||
    ac.includes("real estate") ||
    ac.includes("reit") ||
    ac.includes("digital") ||
    ac.includes("crypto")
  ) {
    return "Satellites";
  }
  if (ac.includes("equit")) {
    // Thematic check first so e.g. region="Sustainability" classifies as
    // Satellite even though it's an equity sleeve.
    if (THEMATIC_REGION_TOKENS.some((t) => rg.includes(t))) return "Satellites";
    if (REGIONAL_EQUITY_EXACT.has(rg)) return "Equities";
    if (REGIONAL_EQUITY_SUBSTRINGS.some((t) => rg.includes(t))) return "Equities";
    return "Satellites";
  }
  return "Satellites";
}

export interface GroupSummary {
  group: AllocationGroup;
  weight: number;
}

export function summarizeAllocationByGroup(
  allocation: ReadonlyArray<AssetAllocation>,
): GroupSummary[] {
  const totals: Record<AllocationGroup, number> = {
    Cash: 0,
    Bonds: 0,
    Equities: 0,
    Satellites: 0,
  };
  for (const row of allocation) {
    totals[classifyGroup(row.assetClass, row.region)] += row.weight;
  }

  const rounded: Record<AllocationGroup, number> = {
    Cash: Math.round(totals.Cash * 10) / 10,
    Bonds: Math.round(totals.Bonds * 10) / 10,
    Equities: Math.round(totals.Equities * 10) / 10,
    Satellites: Math.round(totals.Satellites * 10) / 10,
  };

  const sumRaw =
    totals.Cash + totals.Bonds + totals.Equities + totals.Satellites;
  if (sumRaw > 0.01) {
    const target = Math.round(sumRaw * 10) / 10;
    const sumRounded =
      rounded.Cash + rounded.Bonds + rounded.Equities + rounded.Satellites;
    const diff = Math.round((target - sumRounded) * 10) / 10;
    if (diff !== 0) {
      let maxGroup: AllocationGroup = "Equities";
      let maxVal = -Infinity;
      for (const g of ALLOCATION_GROUPS) {
        if (rounded[g] > maxVal) {
          maxVal = rounded[g];
          maxGroup = g;
        }
      }
      rounded[maxGroup] = Math.round((rounded[maxGroup] + diff) * 10) / 10;
    }
  }

  return ALLOCATION_GROUPS.map((group) => ({ group, weight: rounded[group] }));
}
