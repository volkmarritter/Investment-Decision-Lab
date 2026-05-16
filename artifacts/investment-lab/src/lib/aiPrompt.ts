import type { PortfolioInput, BaseCurrency, PreferredExchange, ThematicPreference } from "./types";

export type PromptLang = "en" | "de";
export type PromptMode = "basic" | "pro";

const HOME_BIAS_LABEL: Record<PromptLang, Record<BaseCurrency, string>> = {
  en: { CHF: "Swiss", EUR: "Eurozone", GBP: "UK", USD: "US" },
  de: { CHF: "Schweizer", EUR: "Eurozonen-", GBP: "britischen", USD: "US-" },
};

const EXCHANGE_LINE: Record<PromptLang, Record<PreferredExchange, string>> = {
  en: {
    SIX: "Prefer ETFs tradable on SIX Swiss Exchange. If this is not possible, name the next-best alternative and explain the exception.",
    XETRA: "Prefer ETFs tradable on Xetra (Deutsche Boerse). If this is not possible, name the next-best alternative and explain the exception.",
    LSE: "Prefer ETFs tradable on London Stock Exchange (LSE). If this is not possible, name the next-best alternative and explain the exception.",
    None: "No specific exchange preference; pick the most liquid UCITS-compliant venue and justify the choice briefly.",
  },
  de: {
    SIX: "Bevorzuge ETFs, die an der SIX Swiss Exchange handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    XETRA: "Bevorzuge ETFs, die an der Xetra (Deutsche Boerse) handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
    LSE: "Bevorzuge ETFs, die an der London Stock Exchange (LSE) handelbar sind. Falls dies nicht moeglich ist, nenne die naechstbeste Alternative und begruende die Ausnahme.",
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
 * @param mode   "basic" (default) heuristic / quick variant, or "pro" for the
 *               stricter mean-variance / efficient-frontier variant with a
 *               mandatory pre-answer validation gate and a deeper rationale
 *               section
 */
export function buildAiPrompt(
  input: PortfolioInput,
  lang: PromptLang = "en",
  mode: PromptMode = "basic",
): string {
  return lang === "de" ? buildPromptDe(input, mode) : buildPromptEn(input, mode);
}

// ---------------------------------------------------------------------------
// English prompt
// ---------------------------------------------------------------------------
function buildPromptEn(input: PortfolioInput, mode: PromptMode): string {
  const { lo, hi } = equityRange(input.targetEquityPct);
  const homeBias = HOME_BIAS_LABEL.en[input.baseCurrency];
  const exchangeLine = EXCHANGE_LINE.en[input.preferredExchange];
  const etfRange = etfCountRange(input);

  const eligibleSatellites: string[] = [];
  if (input.includeListedRealEstate) eligibleSatellites.push("- Listed Real Estate (REITs)");
  if (input.includeCrypto) eligibleSatellites.push("- Crypto Assets");
  const satellitesBlock = eligibleSatellites.length > 0
    ? `Satellites:\n${eligibleSatellites.join("\n")}`
    : "Satellites: none requested by the investor.";

  const equityLine = input.baseCurrency === "CHF"
    ? "- Equities by region: USA, Europe ex-CH, Switzerland (CH), Japan, and Emerging Markets"
    : input.baseCurrency === "GBP"
    ? "- Equities by region: USA, Europe ex-UK, United Kingdom (UK), Japan, and Emerging Markets"
    : "- Equities by region: USA, Europe, Japan, and Emerging Markets";
  const thematicEquityLine = input.thematicPreference !== "None"
    ? `\n- Thematic equity tilt within the equity sleeve: ${input.thematicPreference} (${THEME_DESCRIPTION.en[input.thematicPreference]}) — small theme-tilted slice carved out of equity (counts toward the equity allocation, not as a satellite)`
    : "";
  const commoditiesCoreLine = input.includeCommodities
    ? "\n- Commodities / Precious Metals"
    : "";
  const coreLines = [
    "- Cash / Money Market",
    "- Bonds",
    equityLine + thematicEquityLine,
  ].join("\n") + commoditiesCoreLine;

  const hedgingLine = input.includeCurrencyHedging
    ? "7. State clearly whether currency hedging should be used, where it should be applied, and why."
    : input.hedgeForeignBonds !== false
      ? "7. The investor does NOT want broad currency hedging on equity positions. Only consider hedging where it is structurally important (e.g. foreign-currency bond exposures in the CHF base portfolio). Justify any hedging recommendation."
      : "7. The investor does NOT want currency hedging on any positions.";

  const lookThroughLine = input.lookThroughView
    ? "8. Where relevant, perform a look-through of the selected ETFs to assess underlying exposures, particularly when broad market indices (e.g. global equity indices) are used for asset allocation. If relevant, include a look-through asset allocation overview after Table 1 to reflect underlying exposures."
    : "8. A detailed look-through is not required. A short note on any obvious overlap between selected ETFs is sufficient.";

  const syntheticLine = input.includeSyntheticETFs
    ? "9. Include synthetic ETFs where they provide structural advantages, particularly in terms of market efficiency and reduced withholding tax leakage (e.g., for US equity exposure). Ensure transparency and robustness. Reflect and explain their use clearly in section C) Summary of Key Design Decisions (e.g., where they are applied and why)."
    : "9. Use physical replication only. Do NOT include synthetic / swap-based ETFs even if they would be structurally advantageous; the investor has opted out of synthetic replication.";

  const executionModeBlock = mode === "pro"
    ? `Execution mode (MANDATORY reasoning discipline):
- Follow the steps in the order they are given; do not reorder or skip any of them.
- Justify every allocation decision with at least one of: diversification benefit, risk-contribution impact, or implementation efficiency.
- Make the reasoning structured and explicit; reference the specific assumption or constraint that drives each choice.
- Do not produce generic narration, marketing language, or filler commentary.`
    : `Execution mode:
- Focus on speed and clarity.
- Apply a pragmatic, heuristic portfolio construction approach.
- Keep reasoning concise and avoid unnecessary complexity.
- Do not perform extensive internal validation loops.
- Prioritise a clean, intuitive, and implementable result.`;

  const constructionBlock = mode === "pro"
    ? `Portfolio construction methodology (mean-variance / efficient frontier):
- Base allocations on long-term return, volatility, and correlation assumptions for each asset class.
- Include an asset class only when it improves the portfolio's risk-return profile; drop it otherwise.
- Approximate the efficient frontier by combining low-correlated assets, avoiding redundant exposures, and balancing risk contributions across the portfolio.
- For the targeted return level, minimise risk; equivalently, for the targeted risk level, maximise expected return.
- Make the trade-offs (return vs. risk vs. diversification) explicit when they drive a sizing decision.`
    : `Portfolio construction approach:
Construct a well-diversified portfolio using sound portfolio design principles.
- Combine asset classes with different risk and return characteristics.
- Use diversification to improve the overall risk-return profile.
- Avoid unnecessary overlap and concentration.
- Aim for a balanced mix of growth drivers and stabilising elements.`;

  const internalValidationBlock = mode === "pro"
    ? `\nInternal validation (MANDATORY before final answer):
Before presenting the final answer, run an explicit self-check and correct any issue you find:
- Verify that all tables are internally consistent (group totals reconcile, weights sum to 100%, identifiers in Table 1 and Table 2 match).
- Confirm there are no unjustified redundant exposures (no two ETFs covering essentially the same exposure without a clear reason).
- Confirm minimum position sizes are respected and no position is implementation-irrelevant.
- Confirm the portfolio cannot be simplified further without materially reducing diversification quality.
- If any check fails, correct the construction before presenting the final answer; do not surface the issue without resolving it.
`
    : "";

  const sectionH = mode === "pro"
    ? `H) Portfolio construction rationale (Efficient Frontier perspective)
Explain concisely, with direct reference to this specific allocation, how it sits relative to an efficient portfolio. Cover:
- relative return expectations across the chosen asset classes (qualitative ranking, not point estimates),
- volatility relationships between the sleeves,
- the correlation structure that drives the diversification benefit,
- the key diversification drivers in this allocation,
- how the chosen mix improves risk-adjusted returns versus a naive single-asset or equal-weight benchmark,
- the trade-offs versus a purely theoretical optimal portfolio (constraints such as ETF universe, exchange preference, home bias, hedging policy),
- and why this allocation is close to an efficient portfolio given those real-world constraints.
Stay concise and tied to the actual allocation; do not restate generic efficient-frontier theory.`
    : `H) Portfolio rationale (brief)
Provide a short explanation of how diversification improves the portfolio's overall risk-return profile.`;

  return `Role:
You act as an independent CFA-level portfolio strategist.

Objective:
Create a broadly diversified, return-oriented reference portfolio for an investor with:
- Base currency: ${input.baseCurrency}
- Risk appetite: ${input.riskAppetite}
- Investment horizon: ${horizonLabel(input.horizon, "en")}
- Equity allocation between ${lo}% and ${hi}%

${executionModeBlock}

${constructionBlock}
${internalValidationBlock}
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
6. Address ${homeBias} home bias explicitly and explain whether it is warranted or should be limited.
${hedgingLine}
${lookThroughLine}
${syntheticLine}
10. Ensure the portfolio is well diversified across asset classes and risk drivers, and avoid concentration in a single source of risk.
11. Critical ETF validation requirement (MANDATORY):
Before finalising the answer, verify every ETF/ETP identifier against reliable current sources, for example:
- official issuer factsheets,
- SIX Swiss Exchange,
- justETF,
- Deutsche Boerse,
- issuer product pages.
Never rely purely on model memory for:
- ISINs,
- tickers,
- exchange listings,
- ETF names,
- share classes.
For every instrument perform:
a) ISIN <-> ETF name validation
b) Ticker <-> exchange validation
c) Asset class <-> ETF consistency validation
d) Replication method validation
e) UCITS status validation where applicable
If an identifier cannot be verified with high confidence:
- explicitly state uncertainty,
- do not guess,
- and propose a verified alternative.
12. Final consistency checks (MANDATORY):
- all ISINs are unique
- all ETFs are verified as currently active and tradable to the best of available sources
- exchange preference constraint is respected or exceptions explicitly explained
13. Write the full answer in clear English.

Output format:
A) Table 1: Target allocation
Columns: Group: Cash, Bonds, Equities, Commodities, Satellites | Asset class | Target weight | Purpose / role in the portfolio (1-2 sentences).
After Table 1, add a short "Percentage allocation per group" overview that sums the target weights by group: Cash, Bonds, Equities, Commodities, and Satellites. Ensure the group totals reconcile with the target allocation and add up to 100%.

B) Table 2: ETF implementation (for each position)
Columns: Asset class | Target weight | ETF name | ISIN | Ticker (exchange) | TER | Domicile | Replication | Distribution / accumulation | Share class currency | Short comment (1 sentence on fit, liquidity, or tracking quality).
After Table 2, add a short regulatory and tax suitability note: ETF selections are preliminary implementation examples only. ETF domicile, investor tax residence, regulatory client classification, PRIIPs/KID/KIID availability, local offering restrictions, tax reporting status, withholding-tax effects, US-person/PFIC risks, and US estate-tax considerations have not been verified unless explicitly stated. Final product eligibility and suitability must be checked by the relevant platform, distributor, custodian, or qualified adviser.

C) Brief summary (6-10 concise bullet points) covering the key assumptions and design decisions, including equity exposure, regional mix, concentration risks, home bias, excluded asset classes, commodities / precious metals, listed real estate, and crypto assets where relevant.

D) Consolidated currency overview of the total portfolio after hedging.

E) The ten largest equity holdings on a look-through basis and their portfolio weights. Use the latest available ETF holdings or index factsheets for the look-through analysis and do not rely on stale model memory. If current market-cap leadership differs from the ranking shown, explain the reason, for example ETF mix, regional allocation, factor tilt, or data date.

F) Rebalancing concept including trigger, frequency, and tolerance bands.

G) Rough cost estimate expressed as weighted TER for the full portfolio.

${sectionH}

I) ETF implementation import file for the Investment Decision Lab "Explain my Portfolio" tab
Provide a plain-text import block (no table, no markdown fences) using exactly the following per-line format, one position per line:
ISIN;weight
- Use the ISIN exactly as in Table 2.
- weight is the target weight as a plain number without the percent sign and without a thousands separator (use a dot as the decimal separator, e.g. 32.5).
- One position per line; no header row, no trailing commentary inside the block.
- The weights across all lines must sum to 100.

Closing instruction:
Add an investment disclaimer at the end of the answer according to recognized best-practice standards.
`;
}

// ---------------------------------------------------------------------------
// German prompt
// ---------------------------------------------------------------------------
function buildPromptDe(input: PortfolioInput, mode: PromptMode): string {
  const { lo, hi } = equityRange(input.targetEquityPct);
  const homeBias = HOME_BIAS_LABEL.de[input.baseCurrency];
  const exchangeLine = EXCHANGE_LINE.de[input.preferredExchange];
  const etfRange = etfCountRange(input);
  const risk = RISK_DE[input.riskAppetite];

  const eligibleSatellites: string[] = [];
  if (input.includeListedRealEstate) eligibleSatellites.push("- Boersennotierte Immobilien (REITs)");
  if (input.includeCrypto) eligibleSatellites.push("- Krypto-Assets");
  const satellitesBlock = eligibleSatellites.length > 0
    ? `Satelliten:\n${eligibleSatellites.join("\n")}`
    : "Satelliten: vom Anleger nicht gewuenscht.";

  const equityLine = input.baseCurrency === "CHF"
    ? "- Aktien nach Region: USA, Europa ex-CH, Schweiz (CH), Japan und Schwellenlaender"
    : input.baseCurrency === "GBP"
    ? "- Aktien nach Region: USA, Europa ex-UK, Vereinigtes Koenigreich (UK), Japan und Schwellenlaender"
    : "- Aktien nach Region: USA, Europa, Japan und Schwellenlaender";
  const thematicEquityLine = input.thematicPreference !== "None"
    ? `\n- Thematischer Aktien-Tilt innerhalb des Aktien-Sleeves: ${input.thematicPreference} (${THEME_DESCRIPTION.de[input.thematicPreference]}) — kleiner themenorientierter Anteil aus dem Aktien-Sleeve (zaehlt zur Aktienquote, nicht zu den Satelliten)`
    : "";
  const commoditiesCoreLine = input.includeCommodities
    ? "\n- Rohstoffe / Edelmetalle"
    : "";
  const coreLines = [
    "- Cash / Geldmarkt",
    "- Anleihen",
    equityLine + thematicEquityLine,
  ].join("\n") + commoditiesCoreLine;

  const hedgingLine = input.includeCurrencyHedging
    ? "7. Erlaeutere klar, ob Waehrungsabsicherung eingesetzt werden soll, wo sie angewendet werden soll und warum."
    : input.hedgeForeignBonds !== false
      ? "7. Der Anleger wuenscht KEINE breite Waehrungsabsicherung auf Aktienpositionen. Eine Absicherung ist nur zu beruecksichtigen, wo sie strukturell wichtig ist (z. B. Fremdwaehrungs-Anleihenexpositionen im CHF-Basisportfolio). Jede Absicherungsempfehlung ist zu begruenden."
      : "7. Der Anleger wuenscht KEINE Waehrungsabsicherung auf irgendwelchen Positionen.";

  const lookThroughLine = input.lookThroughView
    ? "8. Fuehre, wo sinnvoll, eine Look-Through-Analyse der ausgewaehlten ETFs durch, um die zugrundeliegenden Exposures zu beurteilen, insbesondere wenn breite Marktindizes (z. B. globale Aktienindizes) fuer die Allokation genutzt werden. Falls relevant, ergaenze nach Tabelle 1 eine Look-Through-Allokationsuebersicht."
    : "8. Eine detaillierte Look-Through-Analyse ist nicht erforderlich. Ein kurzer Hinweis auf offensichtliche Ueberschneidungen zwischen den gewaehlten ETFs reicht aus.";

  const syntheticLine = input.includeSyntheticETFs
    ? "9. Setze synthetische ETFs ein, wo sie strukturelle Vorteile bieten, insbesondere hinsichtlich Markteffizienz und reduzierter Quellensteuer-Leakage (z. B. bei US-Aktien-Exposure). Achte auf Transparenz und Robustheit. Erlaeutere ihren Einsatz klar in Abschnitt C) Zusammenfassung der wesentlichen Designentscheidungen (wo sie eingesetzt werden und warum)."
    : "9. Verwende ausschliesslich physische Replikation. Setze KEINE synthetischen / Swap-basierten ETFs ein, auch wenn sie strukturelle Vorteile haetten; der Anleger hat sich gegen synthetische Replikation entschieden.";

  const executionModeBlock = mode === "pro"
    ? `Bearbeitungsmodus (VERPFLICHTENDE Begruendungs-Disziplin):
- Bearbeite die Schritte in der vorgegebenen Reihenfolge; weder umordnen noch ueberspringen.
- Begruende jede Allokationsentscheidung mit mindestens einem von: Diversifikationsnutzen, Wirkung auf den Risikobeitrag oder Umsetzungseffizienz.
- Halte die Begruendung strukturiert und explizit; verweise auf die konkrete Annahme oder Vorgabe, die jede Entscheidung treibt.
- Keine generische Erzaehlung, kein Marketing-Sprech, keine Fuelltexte.`
    : `Bearbeitungsmodus:
- Fokus auf Geschwindigkeit und Klarheit.
- Wende einen pragmatischen, heuristischen Konstruktionsansatz an.
- Halte die Begruendung knapp und vermeide unnoetige Komplexitaet.
- Fuehre keine ausgedehnten internen Validierungsschleifen durch.
- Priorisiere ein sauberes, intuitives und umsetzbares Ergebnis.`;

  const constructionBlock = mode === "pro"
    ? `Konstruktionsmethodik (Mean-Variance / Efficient Frontier):
- Stuetze die Allokation auf langfristige Annahmen zu Rendite, Volatilitaet und Korrelation je Anlageklasse.
- Nimm eine Anlageklasse nur dann auf, wenn sie das Rendite-Risiko-Profil des Portfolios verbessert; sonst weglassen.
- Naehere die Efficient Frontier an, indem du gering korrelierte Anlagen kombinierst, redundante Exposures vermeidest und Risikobeitraege ueber das Portfolio ausbalancierst.
- Minimiere bei gegebenem Renditeziel das Risiko bzw. maximiere bei gegebenem Risikoniveau die erwartete Rendite.
- Mache die Trade-offs (Rendite vs. Risiko vs. Diversifikation) explizit, sobald sie eine Sizing-Entscheidung treiben.`
    : `Konstruktionsansatz:
Konstruiere ein gut diversifiziertes Portfolio nach soliden Portfolio-Design-Prinzipien.
- Kombiniere Anlageklassen mit unterschiedlichen Risiko- und Renditeprofilen.
- Nutze Diversifikation, um das Gesamtrisiko-Rendite-Profil zu verbessern.
- Vermeide unnoetige Ueberschneidungen und Konzentration.
- Strebe eine ausgewogene Mischung aus Wachstumstreibern und stabilisierenden Elementen an.`;

  const internalValidationBlock = mode === "pro"
    ? `\nInterne Validierung (VERPFLICHTEND vor der finalen Antwort):
Fuehre vor der finalen Antwort eine explizite Selbstpruefung durch und korrigiere jeden gefundenen Mangel:
- Pruefe, dass alle Tabellen in sich konsistent sind (Gruppensummen stimmen, Gewichte summieren sich zu 100%, Kennungen in Tabelle 1 und Tabelle 2 stimmen ueberein).
- Stelle sicher, dass keine ungerechtfertigten redundanten Exposures bestehen (keine zwei ETFs, die im Wesentlichen dasselbe Exposure ohne klaren Grund abdecken).
- Stelle sicher, dass Mindestpositionsgroessen eingehalten werden und keine Position umsetzungstechnisch irrelevant ist.
- Stelle sicher, dass das Portfolio nicht weiter vereinfacht werden kann, ohne die Diversifikationsqualitaet wesentlich zu mindern.
- Falls eine Pruefung fehlschlaegt, korrigiere die Konstruktion vor der finalen Antwort; bringe das Problem nicht ungeloest an die Oberflaeche.
`
    : "";

  const sectionH = mode === "pro"
    ? `H) Portfolio-Konstruktionsrationale (Sicht der Efficient Frontier)
Erlaeutere knapp und mit direktem Bezug auf diese konkrete Allokation, wo sie relativ zu einem effizienten Portfolio steht. Behandle dabei:
- relative Renditeerwartungen der gewaehlten Anlageklassen (qualitative Reihenfolge, keine Punktschaetzungen),
- Volatilitaetsbeziehungen zwischen den Sleeves,
- die Korrelationsstruktur, die den Diversifikationsnutzen treibt,
- die wesentlichen Diversifikationstreiber dieser Allokation,
- wie die gewaehlte Mischung das risikoadjustierte Ergebnis gegenueber einer naiven Einzelanlage oder Gleichgewichtung verbessert,
- die Trade-offs gegenueber einem rein theoretisch optimalen Portfolio (Restriktionen wie ETF-Universum, Boersenpraeferenz, Home-Bias, Hedging-Politik),
- und warum diese Allokation unter den realen Restriktionen nahe an einem effizienten Portfolio liegt.
Bleibe knapp und an die tatsaechliche Allokation gebunden; keine generische Wiederholung der Efficient-Frontier-Theorie.`
    : `H) Portfolio-Rationale (kurz)
Erlaeutere kurz, wie Diversifikation das Gesamtrisiko-Rendite-Profil verbessert.`;

  return `Rolle:
Du agierst als unabhaengiger Portfolio-Stratege auf CFA-Niveau.

Ziel:
Erstelle ein breit diversifiziertes, renditeorientiertes Referenzportfolio fuer einen Anleger mit:
- Basiswaehrung: ${input.baseCurrency}
- Risikoneigung: ${risk}
- Anlagehorizont: ${horizonLabel(input.horizon, "de")}
- Aktienallokation zwischen ${lo}% und ${hi}%

${executionModeBlock}

${constructionBlock}
${internalValidationBlock}
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
6. Adressiere den ${homeBias}Home-Bias explizit und erlaeutere, ob er gerechtfertigt oder begrenzt werden sollte.
${hedgingLine}
${lookThroughLine}
${syntheticLine}
10. Stelle sicher, dass das Portfolio ueber Anlageklassen und Risikotreiber hinweg gut diversifiziert ist und keine Konzentration in einer einzelnen Risikoquelle aufweist.
11. Kritische ETF-Validierungsanforderung (VERPFLICHTEND):
Verifiziere vor Fertigstellung der Antwort jede ETF-/ETP-Kennung gegen verlaessliche, aktuelle Quellen, zum Beispiel:
- offizielle Emittenten-Factsheets,
- SIX Swiss Exchange,
- justETF,
- Deutsche Boerse,
- Produktseiten der Emittenten.
Verlasse dich niemals ausschliesslich auf das Modellgedaechtnis fuer:
- ISINs,
- Ticker,
- Boersennotierungen,
- ETF-Namen,
- Anteilsklassen.
Fuehre fuer jedes Instrument durch:
a) ISIN <-> ETF-Name-Validierung
b) Ticker <-> Boersen-Validierung
c) Anlageklasse <-> ETF-Konsistenzpruefung
d) Validierung der Replikationsmethode
e) UCITS-Status-Validierung, soweit anwendbar
Falls eine Kennung nicht mit hoher Sicherheit verifiziert werden kann:
- benenne die Unsicherheit explizit,
- rate nicht,
- und schlage eine verifizierte Alternative vor.
12. Abschliessende Konsistenzpruefungen (VERPFLICHTEND):
- alle ISINs sind eindeutig
- alle ETFs sind nach bestem verfuegbarem Wissen aktiv und handelbar
- die Boersenpraeferenz wird respektiert oder Ausnahmen werden ausdruecklich erlaeutert
13. Verfasse die gesamte Antwort in klarem Deutsch.

Ausgabeformat:
A) Tabelle 1: Zielallokation
Spalten: Gruppe: Cash, Anleihen, Aktien, Rohstoffe, Satelliten | Anlageklasse | Zielgewicht | Zweck / Rolle im Portfolio (1-2 Saetze).
Ergaenze nach Tabelle 1 eine kurze Uebersicht "Prozentuale Allokation je Gruppe", die die Zielgewichte je Gruppe summiert: Cash, Anleihen, Aktien, Rohstoffe und Satelliten. Stelle sicher, dass die Gruppensummen mit der Zielallokation uebereinstimmen und in Summe 100% ergeben.

B) Tabelle 2: ETF-Umsetzung (je Position)
Spalten: Anlageklasse | Zielgewicht | ETF-Name | ISIN | Ticker (Boerse) | TER | Domizil | Replikation | Ausschuettung / Thesaurierung | Anteilsklassen-Waehrung | Kurzkommentar (1 Satz zu Eignung, Liquiditaet oder Tracking-Qualitaet).
Ergaenze nach Tabelle 2 einen kurzen regulatorischen und steuerlichen Eignungshinweis: Die ETF-Auswahl stellt nur vorlaeufige Umsetzungsbeispiele dar. ETF-Domizil, Steueransaessigkeit des Anlegers, regulatorische Kundenklassifizierung, PRIIPs/KID/KIID-Verfuegbarkeit, lokale Vertriebsbeschraenkungen, steuerlicher Meldestatus, Quellensteuereffekte, US-Person/PFIC-Risiken sowie US-Erbschaftsteuer-Aspekte wurden nicht geprueft, sofern nicht ausdruecklich angegeben. Die endgueltige Produktzulassung und -eignung ist durch die jeweilige Plattform, den Vertrieb, die Depotbank oder einen qualifizierten Berater zu pruefen.

C) Kurze Zusammenfassung (6-10 praegnante Bullet Points) zu den wesentlichen Annahmen und Designentscheidungen, einschliesslich Aktienquote, regionaler Mischung, Konzentrationsrisiken, Home-Bias, ausgeschlossener Anlageklassen, Rohstoffe / Edelmetalle, boersennotierter Immobilien und Krypto-Assets, soweit relevant.

D) Konsolidierte Waehrungsuebersicht des Gesamtportfolios nach Hedging.

E) Die zehn groessten Aktienpositionen auf Look-Through-Basis und ihre Portfoliogewichte. Verwende fuer die Look-Through-Analyse die aktuellsten verfuegbaren ETF-Bestaende oder Index-Factsheets und stuetze dich nicht auf veralteten Modellspeicher. Falls die aktuelle Marktkapitalisierungsrangfolge von der gezeigten abweicht, erlaeutere die Ursache (z. B. ETF-Mix, regionale Allokation, Faktor-Tilt oder Datenstand).

F) Rebalancing-Konzept inkl. Trigger, Frequenz und Toleranzbaender.

G) Grobe Kostenschaetzung als gewichteter TER fuer das Gesamtportfolio.

${sectionH}

I) ETF-Umsetzungs-Importdatei fuer den Tab "Mein Portfolio erklaeren" des Investment Decision Lab
Liefere einen reinen Text-Importblock (keine Tabelle, keine Markdown-Codefences) im exakt folgenden Format, eine Position pro Zeile:
ISIN;weight
- Verwende die ISIN exakt wie in Tabelle 2.
- weight ist das Zielgewicht als reine Zahl ohne Prozentzeichen und ohne Tausendertrennzeichen (Punkt als Dezimaltrennzeichen, z. B. 32.5).
- Eine Position pro Zeile; keine Kopfzeile, kein Begleittext innerhalb des Blocks.
- Die Gewichte aller Zeilen muessen in Summe 100 ergeben.

Schlussanweisung:
Fuege am Ende der Antwort einen Anlage-Disclaimer nach anerkannten Best-Practice-Standards an.
`;
}
