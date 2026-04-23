import { PortfolioInput, ValidationResult, ValidationSuggestion } from "./types";
import { Lang } from "./i18n";
import { computeNaturalBucketCount } from "./portfolio";

export function runValidation(input: PortfolioInput, lang: Lang = "en"): ValidationResult {
  const errors: ValidationSuggestion[] = [];
  const warnings: ValidationSuggestion[] = [];
  const de = lang === "de";

  const maxEquityMap: Record<string, number> = {
    "Low": 40,
    "Moderate": 70,
    "High": 90,
    "Very High": 100,
  };

  const cap = maxEquityMap[input.riskAppetite];

  if (input.targetEquityPct > cap + 15) {
    errors.push({
      message: de
        ? `Ziel-Aktienquote (${input.targetEquityPct}%) übersteigt das typische Maximum für ein Risikoprofil "${input.riskAppetite}" deutlich.`
        : `Target equity (${input.targetEquityPct}%) significantly exceeds the typical maximum for a ${input.riskAppetite} risk profile.`,
      suggestion: de
        ? `Reduzieren Sie die Ziel-Aktienquote auf ${cap}% oder weniger, oder erhöhen Sie Ihr Risikoprofil.`
        : `Reduce target equity to ${cap}% or below, or change your risk profile to a higher setting.`
    });
  }

  const minETFs = input.numETFsMin ?? input.numETFs;
  if (minETFs < 3 || minETFs > 15 || minETFs > input.numETFs) {
    errors.push({
      message: de
        ? `Ungültiger ETF-Bereich (${minETFs}–${input.numETFs}).`
        : `Invalid ETF range (${minETFs}–${input.numETFs}).`,
      suggestion: de
        ? "Min. muss zwischen 3 und Max. liegen, Max. ≤ 15."
        : "Min must be between 3 and Max, with Max ≤ 15.",
    });
  }
  if (input.numETFs < 3 || input.numETFs > 15) {
    errors.push({
      message: de
        ? `Ungültige Anzahl an ETFs (${input.numETFs}).`
        : `Invalid number of ETFs requested (${input.numETFs}).`,
      suggestion: de
        ? "Wählen Sie eine ETF-Anzahl zwischen 3 und 15."
        : "Set the number of ETFs between 3 and 15."
    });
  }

  if (input.horizon < 1) {
    errors.push({
      message: de
        ? `Anlagehorizont ist zu kurz (${input.horizon} Jahre).`
        : `Investment horizon is too short (${input.horizon} years).`,
      suggestion: de
        ? "Wählen Sie einen Anlagehorizont von mindestens 1 Jahr."
        : "Set a horizon of at least 1 year."
    });
  }

  if (input.riskAppetite === "Low" && input.targetEquityPct > 30) {
    warnings.push({
      message: de
        ? "Die Aktienquote ist für ein 'Low'-Risikoprofil etwas hoch."
        : "Equity allocation is slightly high for a 'Low' risk appetite.",
      suggestion: de
        ? "Reduzieren Sie die Aktienquote auf 30% oder weniger."
        : "Consider reducing equity to 30% or below."
    });
  }

  if (input.riskAppetite === "Very High" && input.horizon < 10) {
    warnings.push({
      message: de
        ? "Kurzer Horizont kombiniert mit Risikoprofil 'Very High'."
        : "Short horizon combined with 'Very High' risk.",
      suggestion: de
        ? "Wählen Sie einen längeren Horizont oder reduzieren Sie das Risiko auf Moderate/High."
        : "Consider a longer horizon or reducing risk to Moderate/High."
    });
  }

  if (input.horizon < 3 && input.targetEquityPct > 50) {
    warnings.push({
      message: de
        ? "Hohe Aktienquote bei kurzem Anlagehorizont (Horizontrisiko)."
        : "High equity allocation for a short horizon (Horizon Risk).",
      suggestion: de
        ? "Erhöhen Sie die defensive Allokation (Anleihen/Liquidität), wenn Sie diese Mittel innerhalb von 3 Jahren benötigen."
        : "Increase defensive allocation (Bonds/Cash) if you need these funds within 3 years."
    });
  }

  if (input.includeCrypto && input.riskAppetite === "Low") {
    warnings.push({
      message: de
        ? "Krypto-Beimischung widerspricht dem Risikoprofil 'Low'."
        : "Cryptocurrency inclusion contradicts 'Low' risk profile.",
      suggestion: de
        ? "Deaktivieren Sie die Krypto-Option oder erhöhen Sie Ihr angegebenes Risikoprofil."
        : "Disable the crypto toggle or increase your stated risk profile."
    });
  }

  // Complexity warning is based on the actual number of ETFs the engine will
  // produce (= natural buckets, capped by Max), NOT on the Max cap alone.
  // Otherwise the user gets "too many ETFs" while the engine in fact builds
  // fewer (e.g. Max=11 but only 9 buckets => 9 ETFs, no complexity issue).
  const natural = computeNaturalBucketCount(input);
  const effectiveCount = Math.min(natural, input.numETFs);
  if (effectiveCount > 10) {
    warnings.push({
      message: de
        ? "Hohe Komplexität (Komplexitätsrisiko)."
        : "High complexity (Complexity Risk).",
      suggestion: de
        ? `Ihre Auswahl erzeugt ${effectiveCount} ETFs. Sofern nicht aus steuerlichen oder Faktorgründen erforderlich, reduzieren Sie Satelliten (Krypto, REITs, Thematik) für eine einfachere Verwaltung.`
        : `Your selections produce ${effectiveCount} ETFs. Unless needed for specific tax or factor reasons, reduce satellites (Crypto, REITs, Thematic) for easier management.`
    });
  }

  if (input.numETFs <= 4 && (input.includeCrypto || input.thematicPreference !== "None" || input.includeListedRealEstate)) {
    warnings.push({
      message: de
        ? "Zu wenige Bausteine, um Ihre Auswahl umzusetzen."
        : "Not enough sleeves to express your selections.",
      suggestion: de
        ? "Erhöhen Sie die ETF-Anzahl auf 5+ oder entfernen Sie Satelliten-/Thematik-Optionen."
        : "Increase the number of ETFs to 5+ or remove satellite/thematic toggles."
    });
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0
  };
}
