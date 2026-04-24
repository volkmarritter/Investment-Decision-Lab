import type { PortfolioInput, BaseCurrency, PreferredExchange, ThematicPreference } from "./types";

export type PromptLang = "en" | "de";

const HOME_BIAS_LABEL: Record<PromptLang, Record<BaseCurrency, string>> = {
  en: { CHF: "Swiss", EUR: "Eurozone", GBP: "UK", USD: "US" },
  de: { CHF: "Schweizer", EUR: "Eurozonen-", GBP: "britischen", USD: "US-" },
};

const EXCHANGE_LINE: Record<PromptLang, Record<PreferredExchange, string>> = {
  en: {
    SIX: "Prefer ETFs tradable on SIX Swiss Exchange. If this is not possible, name the next-best alternative and explain the exception.",
    XETRA: "Prefer ETFs tradable on Xetra (Deutsche Boerse). If this is not possible, name the next-best alternative and explain the exception.",
    LSE: "Prefer ETFs tradable on London Stock Exchange (LSE). If this is not possible, name the next-best alternative and explain the exception.",
    Euronext: "Prefer ETFs tradable on Euronext Amsterdam. If this is not possible, name the next-best alternative and explain the exception.",
    None: "No specific exchange preference; pick the most liquid UCITS-compliant venue and justify the choice briefly.",
  },
  de: {
    SIX: "Bevorzuge ETFs, die an der SIX Swiss Exchange handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    XETRA: "Bevorzuge ETFs, die an der Xetra (Deutsche Boerse) handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    LSE: "Bevorzuge ETFs, die an der London Stock Exchange (LSE) handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    Euronext: "Bevorzuge ETFs, die an der Euronext Amsterdam handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    None: "Keine spezifische Boersenpraeferenz; waehle den liquidesten UCITS-konformen Handelsplatz und begruende die Wahl kurz.",
  },
};

const THEME_DESCRIPTION: Record<PromptLang, Record<Exclude<ThematicPreference, "None">, string>> = {
  en: {
    Technology: "broad technology / digital innovation",
    Healthcare: "global healthcare and biotechnology",
    Sustainability: "ESG / climate transition / sustainable investing",
    Cybersecurity: "cybersecurity and digital security",
  },
  de: {
    Technology: "breite Technologie / digitale Innovation",
    Healthcare: "globaler Gesundheitssektor und Biotechnologie",
    Sustainability: "ESG / Klimawende / nachhaltige Geldanlage",
    Cybersecurity: "Cybersecurity und digitale Sicherheit",
  },
};

const RISK_DE: Record<PortfolioInput["riskAppetite"], string> = {
  Low: "Niedrig",
  Moderate: "Moderat",
  High: "Hoch",
  "Very High": "Sehr hoch",
};

function horizonLabel(years: number, lang: PromptLang): string {
  const y = Math.max(1, Math.round(years));
  if (lang === "de") return y === 1 ? "1 Jahr" : `${y} Jahre`;
  return y === 1 ? "1 year" : `${y} years`;
}

function equityRange(targetEquityPct: number): { lo: number; hi: number } {
  const lo = Math.max(0, Math.round(targetEquityPct - 10));
  const hi = Math.min(100, Math.round(targetEquityPct + 10));
  return { lo, hi };
}

function etfCountRange(input: PortfolioInput): string {
  const max = Math.max(5, Math.round(input.numETFs));
  const min = input.numETFsMin && input.numETFsMin > 0
    ? Math.max(3, Math.round(input.numETFsMin))
    : Math.max(5, max - 3);
  return min === max ? `${max}` : `${min}-${max}`;
}

/**
 * Builds a self-contained, copy-paste AI prompt that asks an external CFA-style
 * LLM to construct a portfolio matching the user's current parameters.
 *
 * The prompt is purely textual — it is NOT used by the deterministic engine in
 * this app (which remains rule-based). It is provided as a convenience so the
 * user can compare the rule-based proposal against an external AI's output.
 *
 * @param input  current Build-Portfolio parameters
 * @param lang   "en" (default) or "de" — produces an English or German prompt
 */
export function buildAiPrompt(input: PortfolioInput, lang: PromptLang = "en"): string {
  return lang === "de" ? buildPromptDe(input) : buildPromptEn(input);
}

// ---------------------------------------------------------------------------
// English prompt
// ---------------------------------------------------------------------------
function buildPromptEn(input: PortfolioInput): string {
  const { lo, hi } = equityRange(input.targetEquityPct);
  const homeBias = HOME_BIAS_LABEL.en[input.baseCurrency];
  const exchangeLine = EXCHANGE_LINE.en[input.preferredExchange];
  const etfRange = etfCountRange(input);

  const eligibleSatellites: string[] = [];
  if (input.includeCommodities) eligibleSatellites.push("- Commodities / Precious Metals");
  if (input.includeListedRealEstate) eligibleSatellites.push("- Listed Real Estate (REITs)");
  if (input.includeCrypto) eligibleSatellites.push("- Crypto Assets");
  if (input.thematicPreference !== "None") {
    const desc = THEME_DESCRIPTION.en[input.thematicPreference];
    eligibleSatellites.push(`- Thematic Equity (${input.thematicPreference} - ${desc})`);
  }
  const satellitesBlock = eligibleSatellites.length > 0
    ? `Satellites:\n${eligibleSatellites.join("\n")}`
    : "Satellites: none requested by the investor.";

  const coreLines = [
    "- Cash / Money Market",
    "- Bonds",
    input.baseCurrency === "CHF"
      ? "- Equities by region: USA, Europe ex-CH, Switzerland (CH), Japan, and Emerging Markets"
      : "- Equities by region: USA, Europe, Japan, and Emerging Markets",
  ].join("\n");

  const hedgingLine = input.includeCurrencyHedging
    ? "11. State clearly whether currency hedging should be used, where it should be applied, and why."
    : `11. The investor does NOT want broad currency hedging on equity positions. Only consider hedging where it is structurally important (e.g. foreign-currency bond exposures in the ${input.baseCurrency} base portfolio). Justify any hedging recommendation.`;

  const syntheticLine = input.includeSyntheticETFs
    ? "13. Include synthetic ETFs where they provide structural advantages, particularly in terms of market efficiency and reduced withholding tax leakage (e.g., for US equity exposure). Ensure transparency and robustness. Reflect and explain their use clearly in section C) Summary of Key Design Decisions (e.g., where they are applied and why)."
    : "13. Use physical replication only. Do NOT include synthetic / swap-based ETFs even if they would be structurally advantageous; the investor has opted out of synthetic replication.";

  const lookThroughLine = input.lookThroughView
    ? "12. Where relevant, perform a look-through of the selected ETFs to assess underlying exposures, particularly when broad market indices (e.g. global equity indices) are used for asset allocation. If relevant, include a look-through asset allocation overview after Table 1 to reflect underlying exposures."
    : "12. A detailed look-through is not required. A short note on any obvious overlap between selected ETFs is sufficient.";

  return `Role:
You act as an independent CFA-level portfolio strategist.

Objective:
Create a broadly diversified, return-oriented reference portfolio for an investor with:
- Base currency: ${input.baseCurrency}
- Risk appetite: ${input.riskAppetite}
- Investment horizon: ${horizonLabel(input.horizon, "en")}
- Equity allocation between ${lo}% and ${hi}%

Execution mode:
- Focus on speed and clarity.
- Apply a pragmatic, heuristic portfolio construction approach.
- Keep reasoning concise and avoid unnecessary complexity.
- Do not perform extensive internal validation loops.
- Prioritise a clean, intuitive, and implementable result.

Portfolio construction approach:
Construct a well-diversified portfolio using sound portfolio design principles.
- Combine asset classes with different risk and return characteristics.
- Use diversification to improve the overall risk-return profile.
- Avoid unnecessary overlap and concentration.
- Aim for a balanced mix of growth drivers and stabilising elements.

Eligible asset classes:
Core Asset Classes:
${coreLines}
${satellitesBlock}

Requirements and constraints:
1. Do not override the stated constraints. If a constraint cannot be met, explain why and propose the closest feasible alternative.
2. Use ETFs only for implementation.
3. ${exchangeLine}
4. Prefer liquid, low-cost, broad ETFs. Prefer UCITS-compliant ETFs where they are available and consistent with the selected exchange. Avoid niche products unless clearly justified.
5. Use as few ETFs as practical within the target range of ${etfRange} positions in total without sacrificing diversification or implementation robustness.
6. Prioritize cost efficiency, diversification, and practical implementability.
7. Do not make tactical market forecasts, market-timing calls, or short-term return predictions.
8. Decide using rules and portfolio design principles such as diversification, risk control, costs, and implementability.
9. Make sensible, explicit, and minimal standard assumptions if information is missing, and flag uncertainty transparently instead of pretending to be precise.
10. Address ${homeBias} home bias explicitly and explain whether it is warranted or should be limited.
${hedgingLine}
${lookThroughLine}
${syntheticLine}
14. Ensure the portfolio is well diversified across asset classes and risk drivers, and avoid concentration in a single source of risk.
15. Write the full answer in clear English.

Output format:
A) Table 1: Target allocation
Columns: Group: Cash, Bonds, Equities, Satellites | Asset class | Target weight | Purpose / role in the portfolio (1-2 sentences).
After Table 1, add a short "Percentage allocation per group" overview that sums the target weights by group: Cash, Bonds, Equities, and Satellites (commodities, listed real estate, crypto, and thematic equity all belong to the Satellites group). Ensure the group totals reconcile with the target allocation and add up to 100%.

B) Table 2: ETF implementation (for each position)
Columns: Asset class | Target weight | ETF name | ISIN | Ticker (exchange) | TER | Domicile | Replication | Distribution / accumulation | Share class currency | Short comment (1 sentence on fit, liquidity, or tracking quality).
After Table 2, add a short regulatory and tax suitability note: ETF selections are preliminary implementation examples only. ETF domicile, investor tax residence, regulatory client classification, PRIIPs/KID/KIID availability, local offering restrictions, tax reporting status, withholding-tax effects, US-person/PFIC risks, and US estate-tax considerations have not been verified unless explicitly stated. Final product eligibility and suitability must be checked by the relevant platform, distributor, custodian, or qualified adviser.

C) Brief summary (6-10 concise bullet points) covering the key assumptions and design decisions, including equity exposure, regional mix, concentration risks, home bias, excluded asset classes, commodities / precious metals, listed real estate, and crypto assets where relevant.

D) Consolidated currency overview of the total portfolio after hedging.

E) The ten largest equity holdings on a look-through basis and their portfolio weights. Use the latest available ETF holdings or index factsheets for the look-through analysis and do not rely on stale model memory. If current market-cap leadership differs from the ranking shown, explain the reason, for example ETF mix, regional allocation, factor tilt, or data date.

F) Rebalancing concept including trigger, frequency, and tolerance bands.

G) Rough cost estimate expressed as weighted TER for the full portfolio.

H) Portfolio rationale (brief)
Provide a short explanation of how diversification improves the portfolio's overall risk-return profile.

Closing instruction:
Add an investment disclaimer at the end of the answer according to recognized best-practice standards.
`;
}

// ---------------------------------------------------------------------------
// German prompt
// ---------------------------------------------------------------------------
function buildPromptDe(input: PortfolioInput): string {
  const { lo, hi } = equityRange(input.targetEquityPct);
  const homeBias = HOME_BIAS_LABEL.de[input.baseCurrency];
  const exchangeLine = EXCHANGE_LINE.de[input.preferredExchange];
  const etfRange = etfCountRange(input);
  const risk = RISK_DE[input.riskAppetite];

  const eligibleSatellites: string[] = [];
  if (input.includeCommodities) eligibleSatellites.push("- Rohstoffe / Edelmetalle");
  if (input.includeListedRealEstate) eligibleSatellites.push("- Boersennotierte Immobilien (REITs)");
  if (input.includeCrypto) eligibleSatellites.push("- Krypto-Assets");
  if (input.thematicPreference !== "None") {
    const desc = THEME_DESCRIPTION.de[input.thematicPreference];
    eligibleSatellites.push(`- Thematische Aktien (${input.thematicPreference} - ${desc})`);
  }
  const satellitesBlock = eligibleSatellites.length > 0
    ? `Satelliten:\n${eligibleSatellites.join("\n")}`
    : "Satelliten: vom Anleger nicht gewuenscht.";

  const coreLines = [
    "- Cash / Geldmarkt",
    "- Anleihen",
    input.baseCurrency === "CHF"
      ? "- Aktien nach Region: USA, Europa ex-CH, Schweiz (CH), Japan und Schwellenlaender"
      : "- Aktien nach Region: USA, Europa, Japan und Schwellenlaender",
  ].join("\n");

  const hedgingLine = input.includeCurrencyHedging
    ? "11. Erlaeutere klar, ob Waehrungsabsicherung eingesetzt werden soll, wo sie angewendet werden soll und warum."
    : `11. Der Anleger wuenscht KEINE breite Waehrungsabsicherung auf Aktienpositionen. Beruecksichtige Hedging nur dort, wo es strukturell wichtig ist (z. B. Fremdwaehrungs-Anleihen im ${input.baseCurrency}-Basisportfolio). Begruende jede Hedging-Empfehlung.`;

  const syntheticLine = input.includeSyntheticETFs
    ? "13. Setze synthetische ETFs ein, wo sie strukturelle Vorteile bieten, insbesondere hinsichtlich Markteffizienz und reduzierter Quellensteuer-Leakage (z. B. bei US-Aktien-Exposure). Achte auf Transparenz und Robustheit. Erlaeutere ihren Einsatz klar in Abschnitt C) Zusammenfassung der wesentlichen Designentscheidungen (wo sie eingesetzt werden und warum)."
    : "13. Verwende ausschliesslich physische Replikation. Setze KEINE synthetischen / Swap-basierten ETFs ein, auch wenn sie strukturelle Vorteile haetten; der Anleger hat sich gegen synthetische Replikation entschieden.";

  const lookThroughLine = input.lookThroughView
    ? "12. Fuehre, wo sinnvoll, eine Look-Through-Analyse der ausgewaehlten ETFs durch, um die zugrundeliegenden Exposures zu beurteilen, insbesondere wenn breite Marktindizes (z. B. globale Aktienindizes) fuer die Allokation genutzt werden. Falls relevant, ergaenze nach Tabelle 1 eine Look-Through-Allokationsuebersicht."
    : "12. Eine detaillierte Look-Through-Analyse ist nicht erforderlich. Ein kurzer Hinweis auf offensichtliche Ueberschneidungen zwischen den gewaehlten ETFs reicht aus.";

  return `Rolle:
Du agierst als unabhaengiger Portfolio-Stratege auf CFA-Niveau.

Ziel:
Erstelle ein breit diversifiziertes, renditeorientiertes Referenzportfolio fuer einen Anleger mit:
- Basiswaehrung: ${input.baseCurrency}
- Risikoneigung: ${risk}
- Anlagehorizont: ${horizonLabel(input.horizon, "de")}
- Aktienallokation zwischen ${lo}% und ${hi}%

Bearbeitungsmodus:
- Fokus auf Geschwindigkeit und Klarheit.
- Wende einen pragmatischen, heuristischen Konstruktionsansatz an.
- Halte die Begruendung knapp und vermeide unnoetige Komplexitaet.
- Fuehre keine ausgedehnten internen Validierungsschleifen durch.
- Priorisiere ein sauberes, intuitives und umsetzbares Ergebnis.

Konstruktionsansatz:
Konstruiere ein gut diversifiziertes Portfolio nach soliden Portfolio-Design-Prinzipien.
- Kombiniere Anlageklassen mit unterschiedlichen Risiko- und Renditeprofilen.
- Nutze Diversifikation, um das Gesamtrisiko-Rendite-Profil zu verbessern.
- Vermeide unnoetige Ueberschneidungen und Konzentration.
- Strebe eine ausgewogene Mischung aus Wachstumstreibern und stabilisierenden Elementen an.

Zulaessige Anlageklassen:
Kern-Anlageklassen:
${coreLines}
${satellitesBlock}

Vorgaben und Beschraenkungen:
1. Setze die genannten Vorgaben nicht ausser Kraft. Falls eine Vorgabe nicht erfuellt werden kann, begruende dies und schlage die naechstbeste Alternative vor.
2. Verwende ausschliesslich ETFs fuer die Umsetzung.
3. ${exchangeLine}
4. Bevorzuge liquide, kostenguenstige, breit aufgestellte ETFs. Bevorzuge UCITS-konforme ETFs, sofern sie verfuegbar und mit der gewaehlten Boerse vereinbar sind. Vermeide Nischenprodukte, sofern nicht klar begruendet.
5. Verwende so wenige ETFs wie praktikabel innerhalb der Zielspanne von ${etfRange} Positionen insgesamt, ohne Diversifikation oder Umsetzungsstabilitaet zu opfern.
6. Priorisiere Kosteneffizienz, Diversifikation und praktische Umsetzbarkeit.
7. Triff keine taktischen Marktprognosen, Market-Timing-Aussagen oder kurzfristigen Renditeprognosen.
8. Entscheide auf Basis von Regeln und Portfolio-Design-Prinzipien wie Diversifikation, Risikokontrolle, Kosten und Umsetzbarkeit.
9. Treffe sinnvolle, explizite und minimale Standardannahmen, falls Informationen fehlen, und kennzeichne Unsicherheit transparent, statt eine Praezision vorzutaeuschen.
10. Adressiere den ${homeBias}Home-Bias explizit und erlaeutere, ob er gerechtfertigt oder begrenzt werden sollte.
${hedgingLine}
${lookThroughLine}
${syntheticLine}
14. Stelle sicher, dass das Portfolio ueber Anlageklassen und Risikotreiber hinweg gut diversifiziert ist und keine Konzentration in einer einzelnen Risikoquelle aufweist.
15. Verfasse die gesamte Antwort in klarem Deutsch.

Ausgabeformat:
A) Tabelle 1: Zielallokation
Spalten: Gruppe: Cash, Anleihen, Aktien, Satelliten | Anlageklasse | Zielgewicht | Zweck / Rolle im Portfolio (1-2 Saetze).
Ergaenze nach Tabelle 1 eine kurze Uebersicht "Prozentuale Allokation je Gruppe", die die Zielgewichte je Gruppe summiert: Cash, Anleihen, Aktien und Satelliten (Rohstoffe, boersennotierte Immobilien, Krypto und thematische Aktien gehoeren alle zur Satelliten-Gruppe). Stelle sicher, dass die Gruppensummen mit der Zielallokation uebereinstimmen und in Summe 100% ergeben.

B) Tabelle 2: ETF-Umsetzung (je Position)
Spalten: Anlageklasse | Zielgewicht | ETF-Name | ISIN | Ticker (Boerse) | TER | Domizil | Replikation | Ausschuettung / Thesaurierung | Anteilsklassen-Waehrung | Kurzkommentar (1 Satz zu Eignung, Liquiditaet oder Tracking-Qualitaet).
Ergaenze nach Tabelle 2 einen kurzen regulatorischen und steuerlichen Eignungshinweis: Die ETF-Auswahl stellt nur vorlaeufige Umsetzungsbeispiele dar. ETF-Domizil, Steueransaessigkeit des Anlegers, regulatorische Kundenklassifizierung, PRIIPs/KID/KIID-Verfuegbarkeit, lokale Vertriebsbeschraenkungen, steuerlicher Meldestatus, Quellensteuereffekte, US-Person/PFIC-Risiken sowie US-Erbschaftsteuer-Aspekte wurden nicht geprueft, sofern nicht ausdruecklich angegeben. Die endgueltige Produktzulassung und -eignung ist durch die jeweilige Plattform, den Vertrieb, die Depotbank oder einen qualifizierten Berater zu pruefen.

C) Kurze Zusammenfassung (6-10 praegnante Bullet Points) zu den wesentlichen Annahmen und Designentscheidungen, einschliesslich Aktienquote, regionaler Mischung, Konzentrationsrisiken, Home-Bias, ausgeschlossener Anlageklassen, Rohstoffe / Edelmetalle, boersennotierter Immobilien und Krypto-Assets, soweit relevant.

D) Konsolidierte Waehrungsuebersicht des Gesamtportfolios nach Hedging.

E) Die zehn groessten Aktienpositionen auf Look-Through-Basis und ihre Portfoliogewichte. Verwende fuer die Look-Through-Analyse die aktuellsten verfuegbaren ETF-Bestaende oder Index-Factsheets und stuetze dich nicht auf veralteten Modellspeicher. Falls die aktuelle Marktkapitalisierungsrangfolge von der gezeigten abweicht, erlaeutere die Ursache (z. B. ETF-Mix, regionale Allokation, Faktor-Tilt oder Datenstand).

F) Rebalancing-Konzept inkl. Trigger, Frequenz und Toleranzbaender.

G) Grobe Kostenschaetzung als gewichteter TER fuer das Gesamtportfolio.

H) Portfolio-Rationale (kurz)
Erlaeutere kurz, wie Diversifikation das Gesamtrisiko-Rendite-Profil verbessert.

Schlussanweisung:
Fuege am Ende der Antwort einen Anlage-Disclaimer nach anerkannten Best-Practice-Standards an.
`;
}
