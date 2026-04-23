import { PortfolioInput, AssetAllocation, PortfolioOutput, ETFImplementation } from "./types";
import { getExampleETF } from "./etfs";
import { Lang } from "./i18n";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function buildPortfolio(input: PortfolioInput, lang: Lang = "en"): PortfolioOutput {
  const de = lang === "de";
  const maxEquityMap: Record<string, number> = {
    "Low": 40,
    "Moderate": 70,
    "High": 90,
    "Very High": 100,
  };
  
  let equityPct = Math.min(input.targetEquityPct, maxEquityMap[input.riskAppetite]);
  let defensivePct = 100 - equityPct;

  let cashPct = clamp((10 - input.horizon) * 1.5 + (input.riskAppetite === "Low" ? 5 : 0), 2, 20);
  cashPct = Math.min(cashPct, defensivePct);
  let bondsPct = defensivePct - cashPct;

  const weights: Record<string, number> = {};

  let usaBase = 45;
  if (input.thematicPreference === "Sustainability") usaBase -= 5;
  let europeBase = 22;
  let chBase = 0;
  if (input.baseCurrency === "CHF") {
    chBase = 8;
    europeBase -= 8;
  }
  let japanBase = 8;
  let emBase = 15;
  if (input.horizon >= 10) emBase += 5;

  let reitPct = 0;
  if (input.includeListedRealEstate) {
    reitPct = 6;
  }

  let cryptoPct = 0;
  if (input.includeCrypto) {
    if (input.riskAppetite === "Very High") cryptoPct = 3;
    else if (input.riskAppetite === "High") cryptoPct = 2;
    else if (input.riskAppetite === "Moderate") cryptoPct = 1;
  }

  let thematicPct = 0;
  if (input.thematicPreference !== "None") {
    thematicPct = input.numETFs <= 5 ? 3 : 5;
  }

  const satellitesTotal = reitPct + cryptoPct + thematicPct;
  const coreEquity = equityPct - satellitesTotal;

  if (coreEquity > 0) {
    const totalBase = usaBase + europeBase + chBase + japanBase + emBase;
    weights["Equity_USA"] = (usaBase / totalBase) * coreEquity;
    weights["Equity_Europe"] = (europeBase / totalBase) * coreEquity;
    if (chBase > 0) weights["Equity_Switzerland"] = (chBase / totalBase) * coreEquity;
    weights["Equity_Japan"] = (japanBase / totalBase) * coreEquity;
    weights["Equity_EM"] = (emBase / totalBase) * coreEquity;
  }

  if (reitPct > 0) weights["RealEstate"] = reitPct;
  if (cryptoPct > 0) weights["Crypto"] = cryptoPct;
  if (thematicPct > 0) weights["Thematic"] = thematicPct;

  let goldPct = 0;
  if (input.riskAppetite !== "Low" && bondsPct > 0) {
    goldPct = Math.min(5, bondsPct * 0.15);
    bondsPct -= goldPct;
  }

  if (goldPct > 0) weights["Commodities"] = goldPct;
  weights["Bonds"] = bondsPct;
  weights["Cash"] = cashPct;

  if (input.numETFs <= 5) {
    const sorted = Object.entries(weights)
      .filter(([k, v]) => ["RealEstate", "Crypto", "Thematic", "Commodities"].includes(k) && v > 0)
      .sort((a, b) => a[1] - b[1]);
    
    let toRemove = sorted.length > (input.numETFs - 3) ? sorted.length - Math.max(0, input.numETFs - 3) : 0;
    for (let i = 0; i < toRemove; i++) {
      const [k, v] = sorted[i];
      delete weights[k];
      if (["RealEstate", "Crypto", "Thematic"].includes(k)) weights["Equity_USA"] = (weights["Equity_USA"] || 0) + v;
      if (k === "Commodities") weights["Bonds"] = (weights["Bonds"] || 0) + v;
    }
  }

  if (input.numETFs < 10) {
    if (weights["Equity_Japan"] && weights["Equity_EM"]) {
      weights["Equity_EM_Japan"] = weights["Equity_Japan"] + weights["Equity_EM"];
      delete weights["Equity_Japan"];
      delete weights["Equity_EM"];
    }
  }

  let total = 0;
  for (const k in weights) {
    weights[k] = Math.round(weights[k] * 10) / 10;
    total += weights[k];
  }

  const keys = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);
  if (keys.length > 0) {
    const diff = Math.round((100 - total) * 10) / 10;
    if (diff !== 0) {
      weights[keys[0]] = Math.round((weights[keys[0]] + diff) * 10) / 10;
    }
  }

  const allocation: AssetAllocation[] = [];
  for (const [k, v] of Object.entries(weights)) {
    if (v <= 0) continue;
    let assetClass = "Equity";
    let region = k.replace("Equity_", "");
    if (k === "Bonds") { assetClass = "Fixed Income"; region = "Global"; }
    else if (k === "Cash") { assetClass = "Cash"; region = input.baseCurrency; }
    else if (k === "Commodities") { assetClass = "Commodities"; region = "Gold"; }
    else if (k === "RealEstate") { assetClass = "Real Estate"; region = "Global REITs"; }
    else if (k === "Crypto") { assetClass = "Digital Assets"; region = "Broad Crypto"; }
    else if (k === "Thematic") { assetClass = "Equity"; region = input.thematicPreference; }
    
    allocation.push({ assetClass, region, weight: v });
  }

  allocation.sort((a, b) => b.weight - a.weight);

  const etfImplementation: ETFImplementation[] = [];
  for (const alloc of allocation) {
    if (alloc.assetClass === "Cash") continue;
    etfImplementation.push({
      bucket: `${alloc.assetClass} - ${alloc.region}`,
      intent: de
        ? `Bietet Exposure zu ${alloc.region} innerhalb von ${alloc.assetClass}.`
        : `Provide ${alloc.region} exposure within ${alloc.assetClass}.`,
      exampleETF: getExampleETF(alloc.assetClass, alloc.region, input),
      rationale: de
        ? `Ausgewählt, um den Markt ${alloc.region} effizient abzubilden.`
        : `Selected to efficiently track the ${alloc.region} market.`
    });
  }

  const rationale = de
    ? [
        `Das Portfolio strebt eine Aufteilung von ${equityPct}% Aktien zu ${defensivePct}% defensiv an, abgestimmt auf ein Risikoprofil "${input.riskAppetite}" und einen Anlagehorizont von ${input.horizon} Jahren.`,
        `Aktien sind global diversifiziert mit einer strukturellen Allokation in US-Märkten, ausgeglichen durch ${input.baseCurrency !== "USD" ? "regionale Exposures" : "internationale Märkte"}.`,
        ...(input.includeCrypto ? [`Eine kleine Satelliten-Allokation von ${weights["Crypto"]}% in digitalen Vermögenswerten bietet asymmetrisches Aufwärtspotenzial.`] : []),
        ...(weights["Commodities"] > 0 ? [`Gold wird als Diversifikator gegen Geldentwertung und systemische Schocks beigemischt.`] : [])
      ]
    : [
        `The portfolio targets a ${equityPct}% / ${defensivePct}% equity-to-defensive split, aligned with a ${input.riskAppetite} risk profile and ${input.horizon}-year horizon.`,
        `Equities are globally diversified with a structural allocation to US markets, balanced by ${input.baseCurrency !== "USD" ? 'regional exposures' : 'international markets'}.`,
        ...(input.includeCrypto ? [`A small ${weights["Crypto"]}% satellite allocation to digital assets provides asymmetric upside potential.`] : []),
        ...(weights["Commodities"] > 0 ? [`Gold is included as a diversifier against fiat currency debasement and systemic shocks.`] : [])
      ];

  const risks = de
    ? [
        "Drawdown-Risiko: Aktien können in schweren Baissen 30-50% Verlust erleiden.",
        input.baseCurrency !== "USD" && !input.includeCurrencyHedging ? "Währungsrisiko: Ungesicherte Fremdwährungs-Aktienexposure schwankt mit Wechselkursen." : "",
        input.includeCrypto ? "Volatilitätsrisiko: Digitale Vermögenswerte können 80%+ Drawdowns und hohe regulatorische Unsicherheit erleiden." : "",
        "Inflationsrisiko: Liquidität und nominale Anleihen können in Hochinflationsphasen Kaufkraft verlieren."
      ].filter(Boolean)
    : [
        "Drawdown Risk: Equities can experience 30-50% drawdowns in severe bear markets.",
        input.baseCurrency !== "USD" && !input.includeCurrencyHedging ? "Currency Risk: Unhedged foreign equity exposure means returns will fluctuate with FX rates." : "",
        input.includeCrypto ? "Volatility Risk: Digital assets can experience 80%+ drawdowns and high regulatory uncertainty." : "",
        "Inflation Risk: Cash and nominal bonds may lose purchasing power in high inflation environments."
      ].filter(Boolean);

  const learning = de
    ? [
        input.horizon < 5 && equityPct > 50 ? "Horizontrisiko: Hohe Aktienquoten mit kurzem Horizont erhöhen das Risiko, Verluste zu realisieren, wenn Mittel während eines Abschwungs benötigt werden." : "",
        !input.includeCurrencyHedging && input.baseCurrency !== "USD" ? "Rolle der Währung: Ungesicherte Fremdwährungsaktien können als Diversifikator wirken, da lokale Währungen in globalen Marktpaniken oft schwächer werden." : "",
        weights["Bonds"] < 10 ? "Stabilisierungsfunktion: Niedrige Anleihenquoten bedeuten, dass das Portfolio stark auf Aktienrisikoprämien angewiesen ist und weniger natürliche Stoßdämpfer hat." : ""
      ].filter(Boolean)
    : [
        input.horizon < 5 && equityPct > 50 ? "Horizon Risk: High equity allocations with short horizons increase the chance of realizing losses if funds are needed during a downturn." : "",
        !input.includeCurrencyHedging && input.baseCurrency !== "USD" ? "Currency Role: Unhedged foreign equities can act as a diversifier, as local currencies often weaken during global market panics." : "",
        weights["Bonds"] < 10 ? "Stabilization Role: Low bond allocations mean the portfolio relies heavily on equity risk premiums and has fewer natural shock absorbers." : ""
      ].filter(Boolean);

  return {
    allocation,
    etfImplementation,
    rationale,
    risks,
    learning: learning.length > 0
      ? learning
      : [de ? "Diversifikation: Der einzige Free Lunch in der Finanzwelt." : "Diversification: The only free lunch in finance."]
  };
}
