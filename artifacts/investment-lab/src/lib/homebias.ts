import { ETFImplementation, BaseCurrency } from "./types";
import { buildLookthrough } from "./lookthrough";

// MSCI ACWI / FTSE All-World approximate cap weights (Q4 2024 reference) for the
// aggregated home market of each base currency.
const NEUTRAL_HOME_CAP_WEIGHT_PCT: Record<Exclude<BaseCurrency, "USD">, number> = {
  CHF: 2.4,
  GBP: 3.5,
  EUR: 9.0,
};

// Geographic look-through keys that count as the home market for each base currency.
const HOME_GEO_KEYS: Record<Exclude<BaseCurrency, "USD">, string[]> = {
  CHF: ["Switzerland"],
  GBP: ["United Kingdom"],
  EUR: ["Eurozone", "Germany", "France", "Netherlands", "Italy", "Spain", "Other Europe"],
};

const HOME_LABEL: Record<Exclude<BaseCurrency, "USD">, { en: string; de: string }> = {
  CHF: { en: "Switzerland", de: "Schweiz" },
  GBP: { en: "United Kingdom", de: "Vereinigtes Königreich" },
  EUR: { en: "Eurozone", de: "Eurozone" },
};

// Recommended bias ranges expressed as % of the EQUITY sleeve (not total portfolio).
const RECOMMENDED_RANGE_OF_EQUITY: Record<
  Exclude<BaseCurrency, "USD">,
  { min: number; max: number }
> = {
  CHF: { min: 5, max: 15 },
  GBP: { min: 8, max: 20 },
  EUR: { min: 25, max: 45 },
};

export type HomeBiasVerdict =
  | "under"
  | "modest"
  | "pronounced"
  | "over"
  | "neutral";

export interface HomeBiasResult {
  applicable: boolean;
  baseCurrency: BaseCurrency;
  homeMarketLabel: string;
  homeShareOfPortfolioPct: number; // % of total portfolio
  homeShareOfEquityPct: number; // % of equity sleeve
  neutralCapWeightPct: number; // global cap weight of home market
  neutralShareOfPortfolioPct: number; // neutral × equity sleeve
  biasRatio: number; // homeShareOfPortfolio / neutralShareOfPortfolio
  recommendedRangeOfEquity: { min: number; max: number };
  verdict: HomeBiasVerdict;
  verdictLabel: string;
  pros: string[];
  cons: string[];
  recommendation: string;
}

export function evaluateHomeBias(
  etfs: ETFImplementation[],
  baseCurrency: BaseCurrency,
  lang: "en" | "de" = "en"
): HomeBiasResult {
  const de = lang === "de";

  if (baseCurrency === "USD") {
    return {
      applicable: false,
      baseCurrency,
      homeMarketLabel: "United States",
      homeShareOfPortfolioPct: 0,
      homeShareOfEquityPct: 0,
      neutralCapWeightPct: 0,
      neutralShareOfPortfolioPct: 0,
      biasRatio: 0,
      recommendedRangeOfEquity: { min: 0, max: 0 },
      verdict: "neutral",
      verdictLabel: "",
      pros: [],
      cons: [],
      recommendation: "",
    };
  }

  const lt = buildLookthrough(etfs, lang, baseCurrency);
  const homeKeys = HOME_GEO_KEYS[baseCurrency];
  const equityTotal = lt.equityWeightTotal;

  // Sum home-country share of equity sleeve (geoEquity is normalised to 100% of equity).
  let homeShareOfEquity = 0;
  for (const [k, v] of lt.geoEquity) {
    if (homeKeys.includes(k)) homeShareOfEquity += v;
  }
  const homeShareOfPortfolio = (homeShareOfEquity * equityTotal) / 100;
  const neutralCap = NEUTRAL_HOME_CAP_WEIGHT_PCT[baseCurrency];
  const neutralShareOfPortfolio = (neutralCap * equityTotal) / 100;
  const biasRatio = neutralShareOfPortfolio > 0 ? homeShareOfPortfolio / neutralShareOfPortfolio : 0;

  let verdict: HomeBiasVerdict;
  if (biasRatio < 1.0) verdict = "under";
  else if (biasRatio <= 2.5) verdict = "modest";
  else if (biasRatio <= 5.0) verdict = "pronounced";
  else verdict = "over";

  const verdictLabel = (() => {
    if (de) {
      switch (verdict) {
        case "under": return "Unterrepräsentiert (kein Home Bias)";
        case "modest": return "Moderater Home Bias";
        case "pronounced": return "Ausgeprägter Home Bias";
        case "over": return "Übergewichteter Home Bias";
        default: return "";
      }
    } else {
      switch (verdict) {
        case "under": return "Under-allocated (no home bias)";
        case "modest": return "Modest home bias";
        case "pronounced": return "Pronounced home bias";
        case "over": return "Over-allocated home bias";
        default: return "";
      }
    }
  })();

  const homeLabel = de ? HOME_LABEL[baseCurrency].de : HOME_LABEL[baseCurrency].en;

  // Pros / cons are partially currency-specific so users see relevant nuance.
  const proList: string[] = [];
  const conList: string[] = [];

  // Generic pros (apply to any non-USD base)
  proList.push(
    de
      ? `Währungs-Match: Ausgaben, Mieten, Hypotheken und langfristige Verbindlichkeiten lauten in ${baseCurrency} — eine Heimat-Aktienquote reduziert das FX-Risiko zwischen Vermögen und Liquiditätsbedarf.`
      : `Currency match: spending, rent, mortgages and long-dated liabilities are in ${baseCurrency} — a home-equity tilt reduces the FX mismatch between assets and cash needs.`
  );
  proList.push(
    de
      ? `Quellensteuer-Effizienz: Auf Dividenden inländischer Aktien fällt typischerweise keine endgültige ausländische Quellensteuer an, was die Nettorendite gegenüber dem ausländischen Pendant um 15-30 Bp/Jahr verbessern kann.`
      : `Withholding-tax efficiency: dividends from domestic stocks typically incur no permanent foreign WHT, which can improve net yield by 15-30 bps/yr versus the foreign equivalent.`
  );
  proList.push(
    de
      ? `Verständlichkeit: Bekanntheit der heimischen Unternehmen erleichtert Monitoring, Unternehmensnachrichten und Steuererklärung.`
      : `Familiarity: known domestic companies make monitoring, news interpretation and tax reporting simpler.`
  );

  // Generic cons
  conList.push(
    de
      ? `Konzentrationsrisiko: Der heimische Markt entspricht nur ~${neutralCap.toFixed(1)}% des globalen Aktienmarktes — jede Übergewichtung darüber hinaus geht zulasten der globalen Diversifikation.`
      : `Concentration risk: the home market is only ~${neutralCap.toFixed(1)}% of the global equity market — any tilt above that comes at the cost of global diversification.`
  );
  conList.push(
    de
      ? `Domestische Rezessions-Korrelation: Schwächt sich die heimische Wirtschaft ab, fallen Lohn/Job-Sicherheit und Portfolio gleichzeitig — ein klassisches "double-down"-Risiko.`
      : `Domestic recession correlation: when the home economy weakens, salary/job security and the portfolio fall together — a classic "double-down" risk.`
  );

  // Currency-specific colour
  if (baseCurrency === "CHF") {
    conList.push(
      de
        ? `Sektor-Schiefe: Der SPI ist zu ~50% Healthcare + Consumer Staples (Nestlé, Roche, Novartis) und nur ~4% Tech — der gewünschte Defensivcharakter geht mit einer großen Zyklus-/Tech-Lücke einher.`
        : `Sector skew: the SPI is ~50% Health Care + Consumer Staples (Nestlé, Roche, Novartis) and only ~4% Tech — the desired defensive character comes with a large cyclical/tech gap.`
    );
    conList.push(
      de
        ? `Einzeltitel-Klumpenrisiko: Nestlé, Roche und Novartis machen zusammen ~50% des SPI aus — eine 10%-SPI-Allokation entspricht ~5% in nur drei Aktien.`
        : `Single-stock concentration: Nestlé, Roche and Novartis together represent ~50% of the SPI — a 10% SPI allocation equals ~5% in just three stocks.`
    );
    proList.push(
      de
        ? `35% Schweizer Verrechnungssteuer ist für Schweizer Steueransässige vollständig rückforderbar, wodurch der heimische Aktienanteil steuerlich besonders effizient ist.`
        : `The 35% Swiss withholding tax is fully reclaimable for Swiss tax residents, making the domestic equity sleeve particularly tax-efficient.`
    );
  } else if (baseCurrency === "GBP") {
    conList.push(
      de
        ? `Sektor-Schiefe: Der FTSE 100 ist stark in Energie, Banken, Bergbau und Konsumgütern — Tech und Wachstumsthemen sind unterrepräsentiert.`
        : `Sector skew: the FTSE 100 is heavy in energy, banks, mining and consumer staples — tech and growth themes are under-represented.`
    );
    conList.push(
      de
        ? `Einzeltitel-Klumpenrisiko: Die fünf größten Werte (Shell, AstraZeneca, HSBC, BP, Unilever) machen ~30% des FTSE 100 aus.`
        : `Single-stock concentration: the five largest names (Shell, AstraZeneca, HSBC, BP, Unilever) make up ~30% of the FTSE 100.`
    );
  } else if (baseCurrency === "EUR") {
    conList.push(
      de
        ? `Sektor-Schiefe: Industrials, Luxusgüter und Banken dominieren; US-typische Mega-Cap-Tech fehlt fast vollständig.`
        : `Sector skew: industrials, luxury and banks dominate; US-style mega-cap tech is almost absent.`
    );
    conList.push(
      de
        ? `Wachstumslücke: Über die letzten 15 Jahre hat die Eurozone deutlich hinter dem MSCI World zurückgelegen — eine starke Übergewichtung zementiert dieses Risiko.`
        : `Growth gap: over the last 15 years the Eurozone has materially underperformed the MSCI World — a heavy overweight cements that risk going forward.`
    );
  }

  // Recommendation text
  const range = RECOMMENDED_RANGE_OF_EQUITY[baseCurrency];
  let recommendation = "";
  if (verdict === "under") {
    recommendation = de
      ? `Die aktuelle Heimat-Allokation (${homeShareOfEquity.toFixed(1)}% des Aktienanteils) liegt unter dem typisch sinnvollen Bereich von ${range.min}-${range.max}%. Für einen ${baseCurrency}-basierten Anleger ist eine moderate Heimataufstockung (Währungs-Match, Steuereffizienz) in der Regel sinnvoll.`
      : `Current home allocation (${homeShareOfEquity.toFixed(1)}% of equity sleeve) sits below the typically sensible range of ${range.min}-${range.max}%. For a ${baseCurrency}-based investor a modest home top-up (currency match, tax efficiency) is generally warranted.`;
  } else if (verdict === "modest") {
    recommendation = de
      ? `Mit ${homeShareOfEquity.toFixed(1)}% des Aktienanteils (Faktor ~${biasRatio.toFixed(1)}× gegenüber globalem Cap-Gewicht) liegt die Heimat-Übergewichtung im typisch warranted Bereich von ${range.min}-${range.max}%. Vorteile (FX-Match, Steuern) überwiegen, ohne die globale Diversifikation wesentlich zu schwächen.`
      : `At ${homeShareOfEquity.toFixed(1)}% of the equity sleeve (≈${biasRatio.toFixed(1)}× the global cap weight) the home tilt sits in the typically warranted range of ${range.min}-${range.max}%. The benefits (FX match, tax) outweigh the cost without materially weakening global diversification.`;
  } else if (verdict === "pronounced") {
    recommendation = de
      ? `${homeShareOfEquity.toFixed(1)}% des Aktienanteils (Faktor ~${biasRatio.toFixed(1)}× gegenüber globalem Cap-Gewicht) liegen über dem typisch ratsamen Bereich (${range.min}-${range.max}%). Die heimischen Vorteile bleiben relevant, doch Konzentrations- und Sektor-Schiefe-Risiken werden zunehmend bindend — Reduzierung Richtung ${range.max}% prüfen, sofern keine spezifische Begründung (z. B. konzentrierte CHF-Verbindlichkeiten) vorliegt.`
      : `${homeShareOfEquity.toFixed(1)}% of the equity sleeve (≈${biasRatio.toFixed(1)}× the global cap weight) is above the typically advisable range (${range.min}-${range.max}%). The home benefits remain relevant, but concentration and sector-skew risks become binding — consider trimming towards ${range.max}% unless a specific rationale (e.g. concentrated ${baseCurrency} liabilities) justifies more.`;
  } else if (verdict === "over") {
    recommendation = de
      ? `${homeShareOfEquity.toFixed(1)}% des Aktienanteils (Faktor ~${biasRatio.toFixed(1)}× gegenüber globalem Cap-Gewicht) stellen einen ausgeprägten Home Bias dar, der die Vorteile aufzehrt: Konzentration auf wenige Einzeltitel, Sektor-Schiefe und Wachstumslücke gegenüber dem Weltmarkt. Eine Reduzierung in Richtung ${range.max}% wird empfohlen.`
      : `${homeShareOfEquity.toFixed(1)}% of the equity sleeve (≈${biasRatio.toFixed(1)}× the global cap weight) is a heavy home bias whose costs outweigh the benefits: single-stock concentration, sector skew and a growth gap versus the world index. Trimming towards ${range.max}% is recommended.`;
  }

  return {
    applicable: true,
    baseCurrency,
    homeMarketLabel: homeLabel,
    homeShareOfPortfolioPct: homeShareOfPortfolio,
    homeShareOfEquityPct: homeShareOfEquity,
    neutralCapWeightPct: neutralCap,
    neutralShareOfPortfolioPct: neutralShareOfPortfolio,
    biasRatio,
    recommendedRangeOfEquity: range,
    verdict,
    verdictLabel,
    pros: proList,
    cons: conList,
    recommendation,
  };
}
