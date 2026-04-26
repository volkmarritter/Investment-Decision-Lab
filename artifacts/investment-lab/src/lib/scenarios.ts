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
