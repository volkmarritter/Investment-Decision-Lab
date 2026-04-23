import type { PortfolioInput, BaseCurrency, PreferredExchange, ThematicPreference } from "./types";

const HOME_BIAS_LABEL: Record<BaseCurrency, string> = {
  CHF: "Swiss",
  EUR: "Eurozone",
  GBP: "UK",
  USD: "US",
};

const EXCHANGE_LINE: Record<PreferredExchange, string> = {
  SIX: "Prefer ETFs tradable on SIX Swiss Exchange. If this is not possible, name the next-best alternative and explain the exception.",
  XETRA: "Prefer ETFs tradable on Xetra (Deutsche Boerse). If this is not possible, name the next-best alternative and explain the exception.",
  LSE: "Prefer ETFs tradable on London Stock Exchange (LSE). If this is not possible, name the next-best alternative and explain the exception.",
  None: "No specific exchange preference; pick the most liquid UCITS-compliant venue and justify the choice briefly.",
};

const THEME_DESCRIPTION: Record<Exclude<ThematicPreference, "None">, string> = {
  Technology: "broad technology / digital innovation",
  Healthcare: "global healthcare and biotechnology",
  Sustainability: "ESG / climate transition / sustainable investing",
  Cybersecurity: "cybersecurity and digital security",
};

function horizonLabel(years: number): string {
  if (years >= 10) return ">=10 years";
  if (years >= 7) return "7-9 years";
  if (years >= 4) return "4-6 years";
  return `${years} years`;
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
 */
export function buildAiPrompt(input: PortfolioInput): string {
  const { lo, hi } = equityRange(input.targetEquityPct);
  const homeBias = HOME_BIAS_LABEL[input.baseCurrency];
  const exchangeLine = EXCHANGE_LINE[input.preferredExchange];
  const etfRange = etfCountRange(input);

  const eligibleSatellites: string[] = [];
  if (input.includeCommodities) eligibleSatellites.push("- Commodities / Precious Metals");
  if (input.includeListedRealEstate) eligibleSatellites.push("- Listed Real Estate (REITs)");
  if (input.includeCrypto) eligibleSatellites.push("- Crypto Assets");
  if (input.thematicPreference !== "None") {
    const desc = THEME_DESCRIPTION[input.thematicPreference];
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
- Investment horizon: ${horizonLabel(input.horizon)}
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
