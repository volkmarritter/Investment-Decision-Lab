export type RiskAppetite = "Low" | "Moderate" | "High" | "Very High";
export type BaseCurrency = "USD" | "EUR" | "CHF" | "GBP";
export type PreferredExchange = "None" | "NYSE" | "LSE" | "XETRA" | "SIX";
export type ThematicPreference = "None" | "Technology" | "Healthcare" | "Sustainability" | "Cybersecurity";

export interface PortfolioInput {
  baseCurrency: BaseCurrency;
  riskAppetite: RiskAppetite;
  horizon: number;
  targetEquityPct: number;
  numETFs: number;
  preferredExchange: PreferredExchange;
  thematicPreference: ThematicPreference;
  includeCurrencyHedging: boolean;
  lookThroughView: boolean;
  includeCrypto: boolean;
  includeListedRealEstate: boolean;
}

export interface ValidationSuggestion {
  message: string;
  suggestion: string;
}

export interface ValidationResult {
  errors: ValidationSuggestion[];
  warnings: ValidationSuggestion[];
  isValid: boolean;
}

export interface AssetAllocation {
  assetClass: string;
  region: string;
  weight: number;
}

export interface ETFImplementation {
  bucket: string;
  intent: string;
  exampleETF: string;
  rationale: string;
}

export interface PortfolioOutput {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  rationale: string[];
  risks: string[];
  learning: string[];
}

export interface ExplainPosition {
  assetClass: string;
  region: string;
  weight: number;
}

export interface ExplainAnalysis {
  sum: number;
  verdict: "Coherent" | "Needs Attention" | "Inconsistent";
  warnings: string[];
  errors: string[];
}
