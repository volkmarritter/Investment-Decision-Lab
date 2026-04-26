import { AssetAllocation } from "./types";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  shocks: Record<string, number>;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "gfc",
    name: "2008 Global Financial Crisis",
    description: "Severe global equity market crash and flight to safety.",
    shocks: {
      "Equity_USA": -37,
      "Equity_Europe": -45,
      "Equity_UK": -41,
      "Equity_Switzerland": -34,
      "Equity_Japan": -42,
      "Equity_EM": -53,
      "Equity_Global": -40,
      "Bonds": 5,
      "Fixed Income": 5,
      "Cash": 2,
      "Commodities": 5,
      "Real Estate": -38,
      "Digital Assets": 0,
      "Crypto": 0
    }
  },
  {
    id: "covid",
    name: "2020 COVID Crash (Q1 2020)",
    description: "Rapid, indiscriminate sell-off in Q1 2020 due to global lockdowns.",
    shocks: {
      "Equity_USA": -20,
      "Equity_Europe": -23,
      "Equity_UK": -25,
      "Equity_Switzerland": -12,
      "Equity_Japan": -18,
      "Equity_EM": -24,
      "Equity_Global": -20,
      "Bonds": 3,
      "Fixed Income": 3,
      "Cash": 0,
      "Commodities": 6,
      "Real Estate": -25,
      "Digital Assets": -50,
      "Crypto": -50
    }
  },
  {
    id: "rates",
    name: "2022 Rates Shock",
    description: "Inflation surge leading to aggressive central bank rate hikes.",
    shocks: {
      "Equity_USA": -19,
      "Equity_Europe": -12,
      "Equity_UK": -2,
      "Equity_Switzerland": -16,
      "Equity_Japan": -5,
      "Equity_EM": -20,
      "Equity_Global": -18,
      "Bonds": -13,
      "Fixed Income": -13,
      "Cash": 1,
      "Commodities": 16,
      "Real Estate": -25,
      "Digital Assets": -64,
      "Crypto": -64
    }
  }
];

export interface Contribution {
  key: string;
  weight: number;
  shock: number;
  contribution: number;
}

export interface StressTestResult {
  id: string;
  name: string;
  description: string;
  total: number;
  contributions: Contribution[];
}

// Map a base currency to the shock-key its `region === "Home"` compaction
// row should pick up. Mirrors the home-equity routing in portfolio.ts §4.5
// so a compacted GBP portfolio uses Equity_UK shocks (not Equity_USA), a
// compacted CHF portfolio uses Equity_Switzerland, etc.
const HOME_SHOCK_KEY: Record<string, string> = {
  USD: "Equity_USA",
  EUR: "Equity_Europe",
  GBP: "Equity_UK",
  CHF: "Equity_Switzerland",
};

function getShock(
  assetClass: string,
  region: string,
  shocks: Record<string, number>,
  baseCurrency?: string
): number {
  if (assetClass === "Equity") {
    if (region === "USA") return shocks["Equity_USA"] ?? shocks["Equity_Global"];
    if (region === "Europe") return shocks["Equity_Europe"] ?? shocks["Equity_Global"];
    if (region === "Switzerland") return shocks["Equity_Switzerland"] ?? shocks["Equity_Global"];
    if (region === "UK" || region === "United Kingdom") return shocks["Equity_UK"] ?? shocks["Equity_Europe"] ?? shocks["Equity_Global"];
    if (region === "Japan") return shocks["Equity_Japan"] ?? shocks["Equity_Global"];
    if (region === "EM" || region === "EM_Japan" || region === "Emerging Markets") return shocks["Equity_EM"] ?? shocks["Equity_Global"];
    if (region === "Global") return shocks["Equity_Global"] ?? -30;
    if (region === "Home") {
      const key = (baseCurrency && HOME_SHOCK_KEY[baseCurrency]) || "Equity_USA";
      return shocks[key] ?? shocks["Equity_Global"] ?? -30;
    }
    return shocks["Equity_Global"] ?? -30;
  }
  
  if (shocks[assetClass] !== undefined) {
    return shocks[assetClass];
  }
  
  return 0;
}

export function runStressTest(
  allocation: AssetAllocation[],
  baseCurrency?: string
): StressTestResult[] {
  return SCENARIOS.map(scenario => {
    let total = 0;
    const contributions: Contribution[] = [];

    allocation.forEach(alloc => {
      const shock = getShock(alloc.assetClass, alloc.region, scenario.shocks, baseCurrency);
      const contribution = (alloc.weight / 100) * shock;
      total += contribution;
      
      contributions.push({
        key: `${alloc.assetClass} - ${alloc.region}`,
        weight: alloc.weight,
        shock,
        contribution
      });
    });

    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      total: Math.round(total * 10) / 10,
      contributions
    };
  });
}

// ---------------------------------------------------------------------------
// Reverse Stress Test
// ---------------------------------------------------------------------------
// "What would have to happen for my plan to break?" — instead of fixing the
// shock and reading off the loss, we fix the loss (e.g. -30 %) and solve
// for the shock magnitude. Two complementary views:
//
//   1. Scenario-multiplier view — for each historical SCENARIO, find the
//      smallest scalar λ ≥ 0 such that applying (λ × scenario shocks) to
//      the allocation produces exactly `targetLoss`. λ < 1 means the
//      historical scenario alone is already worse than the user's pain
//      threshold; λ > 1 means it would have to be λ-times worse than the
//      historical analogue. Pure-equity allocations land near λ ≈ 0.7-0.8
//      for GFC at -30 %; balanced 60/40s typically need λ ≈ 1.4 or more.
//
//   2. Single-factor "equity-only" view — what uniform shock applied to
//      ALL equity sleeves alone (bonds / cash / gold etc. unchanged) is
//      needed to hit the target loss. Useful as a clean intuition pump:
//      "an equity-only drop of -47 % would break my plan".
//
// Both views are deterministic, closed-form (linear in the shock for a
// fixed allocation), and so cheap that we run them on every render.
export interface ReverseStressScenarioResult {
  /** Stable scenario id the multiplier was solved against. */
  scenarioId: string;
  /** Display name of the underlying scenario. */
  scenarioName: string;
  /** Multiplier λ to scale the historical shocks by so total = targetLoss.
   *  null when the unscaled scenario produces a non-negative or zero loss
   *  (in which case no positive λ can reach a negative target). */
  multiplier: number | null;
  /** Total loss the unscaled (λ = 1) scenario would produce. Useful for
   *  the user to compare "we are already at -22 %, target -30 % needs
   *  another 36 % on top". */
  baselineTotal: number;
  /** True iff the unscaled scenario alone already exceeds the target loss
   *  (multiplier < 1). Helps the UI flag the most pressing scenarios. */
  alreadyExceeds: boolean;
}
export interface ReverseStressEquityOnlyResult {
  /** Uniform shock (in %) applied to every equity sleeve such that the
   *  allocation hits `targetLoss`. null if the portfolio carries no
   *  equity at all (no equity weight ⇒ no shock can reach the target). */
  uniformEquityShock: number | null;
  /** Sum of equity weights in the allocation, in %. */
  equityWeightTotal: number;
}
export interface ReverseStressTestResult {
  /** The user's pain threshold, in % (negative number, e.g. -30). */
  targetLoss: number;
  scenarios: ReverseStressScenarioResult[];
  equityOnly: ReverseStressEquityOnlyResult;
}

export function runReverseStressTest(
  allocation: AssetAllocation[],
  targetLoss: number = -30,
  baseCurrency?: string
): ReverseStressTestResult {
  // Round once so UI displays line up with the underlying solution.
  const target = Math.round(targetLoss * 10) / 10;

  // ---- 1. Scenario-multiplier view --------------------------------------
  const scenarios: ReverseStressScenarioResult[] = SCENARIOS.map((scenario) => {
    let baseline = 0;
    allocation.forEach((alloc) => {
      const shock = getShock(alloc.assetClass, alloc.region, scenario.shocks, baseCurrency);
      baseline += (alloc.weight / 100) * shock;
    });
    baseline = Math.round(baseline * 10) / 10;

    // The portfolio shock is linear in λ: total(λ) = λ × baseline. So
    // λ = target / baseline whenever baseline < 0 (i.e. the scenario is
    // actually a loss for the user). Defensive: if baseline ≥ 0 the
    // scenario can't generate a loss for this allocation at all.
    let multiplier: number | null = null;
    if (baseline < 0) {
      multiplier = Math.round((target / baseline) * 100) / 100;
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      multiplier,
      baselineTotal: baseline,
      alreadyExceeds: multiplier !== null && multiplier < 1,
    };
  });

  // ---- 2. Single-factor equity-only view --------------------------------
  let equityWeight = 0;
  allocation.forEach((alloc) => {
    if (alloc.assetClass === "Equity") equityWeight += alloc.weight;
  });
  // Solve target = (equityWeight / 100) × shock  →  shock = target / (w/100).
  // Round to 0.1 % to stay aligned with the rest of the stress UI.
  const uniformEquityShock =
    equityWeight > 0
      ? Math.round((target / (equityWeight / 100)) * 10) / 10
      : null;

  return {
    targetLoss: target,
    scenarios,
    equityOnly: {
      uniformEquityShock,
      equityWeightTotal: Math.round(equityWeight * 10) / 10,
    },
  };
}
