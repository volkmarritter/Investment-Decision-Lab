import { ExplainAnalysis, ExplainPosition, RiskAppetite, BaseCurrency } from "./types";
import { Lang } from "./i18n";

export function analyzePortfolio(
  positions: ExplainPosition[],
  riskProfile: RiskAppetite,
  baseCurrency: BaseCurrency,
  lang: Lang = "en"
): ExplainAnalysis {
  void baseCurrency;
  const warnings: string[] = [];
  const errors: string[] = [];
  const de = lang === "de";

  let sum = 0;
  let equityTotal = 0;
  let bondCashTotal = 0;
  const regionTotals: Record<string, number> = {};

  for (const p of positions) {
    sum += p.weight;
    if (p.weight > 25) {
      warnings.push(de
        ? `Konzentrationsrisiko: ${p.assetClass} (${p.region}) macht > 25% des Portfolios aus.`
        : `Concentration risk: ${p.assetClass} (${p.region}) is > 25% of the portfolio.`);
    }

    if (p.assetClass.toLowerCase().includes("equity") || p.assetClass.toLowerCase().includes("aktien")) {
      equityTotal += p.weight;
      regionTotals[p.region] = (regionTotals[p.region] || 0) + p.weight;
    } else if (
      p.assetClass.toLowerCase().includes("bond") ||
      p.assetClass.toLowerCase().includes("cash") ||
      p.assetClass.toLowerCase().includes("fixed") ||
      p.assetClass.toLowerCase().includes("anleih") ||
      p.assetClass.toLowerCase().includes("liquid")
    ) {
      bondCashTotal += p.weight;
    }
  }

  if (Math.abs(sum - 100) > 0.5) {
    errors.push(de
      ? `Portfolio-Gewichte summieren sich auf ${sum.toFixed(1)}%, nicht auf 100%.`
      : `Portfolio weights sum to ${sum.toFixed(1)}%, not 100%.`);
  }

  if (equityTotal > 0) {
    for (const [region, weight] of Object.entries(regionTotals)) {
      if (weight / equityTotal > 0.6) {
        warnings.push(de
          ? `Regionale Übergewichtung: ${region} macht > 60% Ihrer Aktienallokation aus.`
          : `Regional overweight: ${region} makes up > 60% of your equity allocation.`);
      }
    }
  }

  if (bondCashTotal === 0) {
    warnings.push(de
      ? "Keine Anleihen oder Liquidität: Dem Portfolio fehlen stabilisierende Anlagen."
      : "No bonds or cash: The portfolio lacks stabilizing assets.");
  }

  if (riskProfile === "Low" && equityTotal > 50) {
    warnings.push(de
      ? "Angegebenes Risiko ist 'Low', aber Aktienquote > 50%. Dies ist inkonsistent."
      : "Stated risk is 'Low', but equity exposure > 50%. This is inconsistent.");
  } else if (riskProfile === "Very High" && equityTotal < 50) {
    warnings.push(de
      ? "Angegebenes Risiko ist 'Very High', aber Aktienquote < 50%. Dies ist inkonsistent."
      : "Stated risk is 'Very High', but equity exposure < 50%. This is inconsistent.");
  }

  let verdict: "Coherent" | "Needs Attention" | "Inconsistent" = "Coherent";
  if (errors.length > 0) verdict = "Inconsistent";
  else if (warnings.length >= 1) verdict = "Needs Attention";

  return { sum, verdict, warnings, errors };
}
