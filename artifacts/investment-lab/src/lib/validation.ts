import { PortfolioInput, ValidationResult, ValidationSuggestion } from "./types";

export function runValidation(input: PortfolioInput): ValidationResult {
  const errors: ValidationSuggestion[] = [];
  const warnings: ValidationSuggestion[] = [];

  const maxEquityMap: Record<string, number> = {
    "Low": 40,
    "Moderate": 70,
    "High": 90,
    "Very High": 100,
  };

  const cap = maxEquityMap[input.riskAppetite];
  
  if (input.targetEquityPct > cap + 15) {
    errors.push({
      message: `Target equity (${input.targetEquityPct}%) significantly exceeds the typical maximum for a ${input.riskAppetite} risk profile.`,
      suggestion: `Reduce target equity to ${cap}% or below, or change your risk profile to a higher setting.`
    });
  }

  if (input.numETFs < 3 || input.numETFs > 15) {
    errors.push({
      message: `Invalid number of ETFs requested (${input.numETFs}).`,
      suggestion: "Set the number of ETFs between 3 and 15."
    });
  }

  if (input.horizon < 1) {
    errors.push({
      message: `Investment horizon is too short (${input.horizon} years).`,
      suggestion: "Set a horizon of at least 1 year."
    });
  }

  if (input.riskAppetite === "Low" && input.targetEquityPct > 30) {
    warnings.push({
      message: "Equity allocation is slightly high for a 'Low' risk appetite.",
      suggestion: "Consider reducing equity to 30% or below."
    });
  }

  if (input.riskAppetite === "Very High" && input.horizon < 5) {
    warnings.push({
      message: "Short horizon combined with 'Very High' risk.",
      suggestion: "Consider a longer horizon or reducing risk to Moderate/High."
    });
  }

  if (input.horizon < 3 && input.targetEquityPct > 50) {
    warnings.push({
      message: "High equity allocation for a short horizon (Horizon Risk).",
      suggestion: "Increase defensive allocation (Bonds/Cash) if you need these funds within 3 years."
    });
  }

  if (input.includeCrypto && input.riskAppetite === "Low") {
    warnings.push({
      message: "Cryptocurrency inclusion contradicts 'Low' risk profile.",
      suggestion: "Disable the crypto toggle or increase your stated risk profile."
    });
  }

  if (input.numETFs > 10) {
    warnings.push({
      message: "High complexity (Complexity Risk).",
      suggestion: "Unless needed for specific tax or factor reasons, consider reducing the ETF count for easier management."
    });
  }

  if (input.numETFs <= 4 && (input.includeCrypto || input.thematicPreference !== "None" || input.includeListedRealEstate)) {
    warnings.push({
      message: "Not enough sleeves to express your selections.",
      suggestion: "Increase the number of ETFs to 5+ or remove satellite/thematic toggles."
    });
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0
  };
}
