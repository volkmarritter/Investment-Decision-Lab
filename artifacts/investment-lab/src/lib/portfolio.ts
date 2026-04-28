import { PortfolioInput, AssetAllocation, PortfolioOutput, ETFImplementation, BaseCurrency } from "./types";
import { getETFDetails } from "./etfs";
import { Lang } from "./i18n";
import { CMA, AssetKey } from "./metrics";
import { resolvedHomeBias, getRiskFreeRate } from "./settings";
import { applyManualWeights, bucketKey, type ManualWeights } from "./manualWeights";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Canonical asset-class display order, used everywhere allocation rows are
// shown (Build table, ETF Implementation table, anything that consumes
// `output.allocation` / `output.etfImplementation` in row order).
//
// Order: Cash → Bonds → Equities → Commodities → REITs → Crypto.
// Within a class (e.g. multiple equity regions), rows are still sorted by
// weight descending as a stable tiebreaker.
// ---------------------------------------------------------------------------
const ASSET_CLASS_ORDER: Record<string, number> = {
  Cash: 0,
  "Fixed Income": 1,
  Equity: 2,
  Commodities: 3,
  "Real Estate": 4,
  "Digital Assets": 5,
};

function assetClassRank(c: string): number {
  return c in ASSET_CLASS_ORDER ? ASSET_CLASS_ORDER[c] : 99;
}

function sortAllocationCanonical(rows: AssetAllocation[]): void {
  rows.sort((a, b) => {
    const ra = assetClassRank(a.assetClass);
    const rb = assetClassRank(b.assetClass);
    if (ra !== rb) return ra - rb;
    return b.weight - a.weight;
  });
}

// ---------------------------------------------------------------------------
// Equity region weighting — principled, not fixed.
//
// Methodology (single source of truth = the same CMA used by metrics.ts):
//   1. Market-cap anchor:      raw_i = MCAP_i  (global market portfolio,
//                              MSCI-ACWI-style approximation).
//   2. Sharpe overlay:         × (Sharpe / 0.25)^0.4 (damped tilt to better
//                              risk-adjusted-return, never dominates).
//                              Sharpe uses the user-editable risk-free rate
//                              from settings (same RF as report metrics) —
//                              changing RF therefore moves bucket weights on
//                              the next "Generate Portfolio" click.
//   3. Home-bias overlay:      × home_factor on home region.
//   4. Long-horizon EM tilt:   × 1.3 on EM if horizon ≥ 10 years.
//   5. Sustainability theme:   × 0.85 on USA (theme reduces home-market tilt).
//   6. Concentration cap:      no region > 65% of equity sleeve; excess
//                              redistributed proportionally.
//
// The market-cap anchor is the canonical "neutral" portfolio in modern
// portfolio theory (Sharpe 1964); overlays are documented active tilts.
// ---------------------------------------------------------------------------
const EQUITY_REGION_CAP = 65;

// Approximate MSCI ACWI regional weights, USD/EUR base.
// The CHF and GBP variants carve a small slice (Switzerland / UK respectively)
// out of broad-Europe so the home market gets its own anchor slot. The two
// special-case anchors are otherwise structurally identical to the default —
// they only differ in which sub-region is broken out.
const MCAP_ANCHOR_DEFAULT: Record<string, number> = {
  USA: 0.60,
  Europe: 0.13,
  Japan: 0.05,
  EM: 0.11,
};
const MCAP_ANCHOR_CHF: Record<string, number> = {
  USA: 0.60,
  Europe: 0.10,
  Switzerland: 0.04,
  Japan: 0.05,
  EM: 0.11,
};
const MCAP_ANCHOR_GBP: Record<string, number> = {
  USA: 0.60,
  Europe: 0.10,
  UK: 0.04,
  Japan: 0.05,
  EM: 0.11,
};
const ANCHOR_BY_BASE: Record<BaseCurrency, Record<string, number>> = {
  USD: MCAP_ANCHOR_DEFAULT,
  EUR: MCAP_ANCHOR_DEFAULT,
  GBP: MCAP_ANCHOR_GBP,
  CHF: MCAP_ANCHOR_CHF,
};

// Home-bias overlay region per base currency. The numeric factor is now
// LIVE-EDITABLE via the Methodology tab — see settings.resolvedHomeBias.
// This map only encodes the (currency → home region) pairing; the multiplier
// itself is read at portfolio-build time so user overrides take effect on the
// next "Generate Portfolio" click.
const HOME_TILT_REGION: Record<BaseCurrency, string> = {
  USD: "USA",          // already dominant via anchor (default factor 1.0)
  EUR: "Europe",
  GBP: "UK",           // UK anchor is small (~4%), default factor 1.5
  CHF: "Switzerland",  // Swiss anchor is small (~4%), default factor 2.5
};

const REGION_TO_CMA: Record<string, AssetKey> = {
  USA: "equity_us",
  Europe: "equity_eu",
  UK: "equity_uk",
  Switzerland: "equity_ch",
  Japan: "equity_jp",
  EM: "equity_em",
};

export function computeEquityRegionWeights(input: PortfolioInput): Record<string, number> {
  const anchor = ANCHOR_BY_BASE[input.baseCurrency];
  const regions: string[] = Object.keys(anchor);

  // RF is read once per build call so all regions see a consistent value, even
  // if a CustomEvent fires mid-iteration. Same RF as report metrics — see the
  // header comment block above for the rationale.
  const rf = getRiskFreeRate(input.baseCurrency);
  const raw: Record<string, number> = {};
  for (const r of regions) {
    const c = CMA[REGION_TO_CMA[r]];
    const sharpe = (c.expReturn - rf) / c.vol;
    const sharpeMultiplier = Math.pow(Math.max(sharpe, 0.05) / 0.25, 0.4);
    raw[r] = anchor[r] * sharpeMultiplier;
  }

  const homeRegion = HOME_TILT_REGION[input.baseCurrency];
  const homeFactor = resolvedHomeBias(input.baseCurrency);
  if (raw[homeRegion] !== undefined) raw[homeRegion] *= homeFactor;

  if (input.horizon >= 10) raw["EM"] *= 1.3;
  if (input.thematicPreference === "Sustainability") raw["USA"] *= 0.85;

  let total = 0;
  for (const r of regions) total += raw[r];
  const w: Record<string, number> = {};
  for (const r of regions) w[r] = (raw[r] / total) * 100;

  for (let iter = 0; iter < 6; iter++) {
    let excess = 0;
    for (const r of regions) {
      if (w[r] > EQUITY_REGION_CAP) {
        excess += w[r] - EQUITY_REGION_CAP;
        w[r] = EQUITY_REGION_CAP;
      }
    }
    if (excess <= 0.01) break;
    const belowSum = regions
      .filter((r) => w[r] < EQUITY_REGION_CAP)
      .reduce((s, r) => s + w[r], 0);
    if (belowSum <= 0) break;
    for (const r of regions) {
      if (w[r] < EQUITY_REGION_CAP) w[r] += (w[r] / belowSum) * excess;
    }
  }

  return w;
}

/**
 * Returns the number of distinct allocation buckets the engine would produce
 * for these inputs WITHOUT applying the numETFs consolidation step.
 * Use this as the "natural" minimum number of ETFs needed to express the portfolio.
 */
export function computeNaturalBucketCount(input: PortfolioInput): number {
  const tmp = buildPortfolio({ ...input, numETFs: 15 }, "en");
  return tmp.allocation.length;
}

export function buildPortfolio(
  input: PortfolioInput,
  lang: Lang = "en",
  manualWeights?: ManualWeights,
): PortfolioOutput {
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
    const regionWeights = computeEquityRegionWeights(input);
    for (const [region, w] of Object.entries(regionWeights)) {
      if (w > 0) weights[`Equity_${region}`] = (w / 100) * coreEquity;
    }
  }

  if (reitPct > 0) weights["RealEstate"] = reitPct;
  if (cryptoPct > 0) weights["Crypto"] = cryptoPct;
  if (thematicPct > 0) weights["Thematic"] = thematicPct;

  let goldPct = 0;
  if (input.includeCommodities && input.riskAppetite !== "Low" && bondsPct > 0) {
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

  // Japan and EM are kept as separate buckets so the allocation always
  // distinguishes Developed-Market Japan from Emerging Markets exposure.

  // If the ETF budget (numETFs) is too small to give every equity region its
  // own slot, collapse equity into a global core + a home tilt. This preserves
  // total equity exposure and the home-currency bias while honouring the cap.
  const equityRegionKeys = ["Equity_USA", "Equity_Europe", "Equity_UK", "Equity_Switzerland", "Equity_Japan", "Equity_EM"];
  const presentEquity = equityRegionKeys.filter(k => (weights[k] || 0) > 0);
  if (Object.keys(weights).filter(k => (weights[k] || 0) > 0).length > input.numETFs && presentEquity.length >= 3) {
    const homeMap: Record<string, string> = {
      USD: "Equity_USA",
      EUR: "Equity_Europe",
      GBP: "Equity_UK",
      CHF: "Equity_Switzerland",
    };
    const homeKey = homeMap[input.baseCurrency];
    let homeSum = 0;
    let globalSum = 0;
    for (const k of presentEquity) {
      if (k === homeKey) homeSum += weights[k];
      else globalSum += weights[k];
      delete weights[k];
    }
    // For CHF/EUR/GBP without an existing home bucket, carve a small home tilt
    // from the global pool so the home bias survives consolidation.
    if (homeSum === 0 && (input.baseCurrency === "CHF" || input.baseCurrency === "EUR" || input.baseCurrency === "GBP")) {
      const tilt = Math.min(globalSum, input.baseCurrency === "CHF" ? 8 : 12);
      homeSum = tilt;
      globalSum -= tilt;
    }
    if (homeSum > 0) weights["Equity_Home"] = homeSum;
    if (globalSum > 0) weights["Equity_Global"] = globalSum;
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

  sortAllocationCanonical(allocation);

  // ---------------------------------------------------------------------------
  // Apply user-pinned weight overrides (if any). Pinned rows keep the user's
  // typed weight; remaining rows are scaled proportionally so the portfolio
  // still sums to 100%. Rows whose bucket has no override are unaffected
  // beyond the proportional rescale. See src/lib/manualWeights.ts.
  // ---------------------------------------------------------------------------
  if (manualWeights && Object.keys(manualWeights).length > 0) {
    const naturalRows = allocation.map((a) => ({
      bucket: bucketKey(a.assetClass, a.region),
      weight: a.weight,
    }));
    const adjusted = applyManualWeights(naturalRows, manualWeights);
    for (let i = 0; i < allocation.length; i++) {
      allocation[i].weight = adjusted.rows[i].weight;
      if (adjusted.rows[i].isManualOverride) {
        allocation[i].isManualOverride = true;
      }
    }
    // Re-apply the canonical asset-class order (Cash → Bonds → Equities →
    // Commodities → REITs → Crypto) with weight-desc as the intra-class
    // tiebreaker, so the table ordering stays stable across overrides.
    sortAllocationCanonical(allocation);
  }

  const etfImplementation: ETFImplementation[] = [];
  for (const alloc of allocation) {
    if (alloc.assetClass === "Cash") continue;
    const d = getETFDetails(alloc.assetClass, alloc.region, input);
    etfImplementation.push({
      bucket: `${alloc.assetClass} - ${alloc.region}`,
      assetClass: alloc.assetClass,
      weight: alloc.weight,
      isManualOverride: alloc.isManualOverride,
      intent: de
        ? `Bietet Exposure zu ${alloc.region} innerhalb von ${alloc.assetClass}.`
        : `Provide ${alloc.region} exposure within ${alloc.assetClass}.`,
      exampleETF: d.name,
      rationale: de
        ? `Ausgewählt, um den Markt ${alloc.region} effizient abzubilden.`
        : `Selected to efficiently track the ${alloc.region} market.`,
      isin: d.isin,
      ticker: d.ticker,
      exchange: d.exchange,
      terBps: d.terBps,
      domicile: d.domicile,
      replication: d.replication,
      distribution: d.distribution,
      currency: d.currency,
      comment: d.comment,
      catalogKey: d.catalogKey,
      selectedSlot: d.selectedSlot,
      selectableOptions: d.selectableOptions,
    });
  }

  const rationale = de
    ? [
        `Das Portfolio strebt eine Aufteilung von ${equityPct}% Aktien zu ${defensivePct}% defensiv an, abgestimmt auf ein Risikoprofil "${input.riskAppetite}" und einen Anlagehorizont von ${input.horizon} Jahren.`,
        `Aktien sind global diversifiziert mit einer strukturellen Allokation in US-Märkten, ausgeglichen durch ${input.baseCurrency !== "USD" ? "regionale Exposures" : "internationale Märkte"}.`,
        ...(input.includeCrypto ? [`Eine kleine Satelliten-Allokation von ${weights["Crypto"]}% in digitalen Vermögenswerten bietet asymmetrisches Aufwärtspotenzial.`] : []),
        ...(weights["Commodities"] > 0 ? [`Gold wird als Diversifikator gegen Geldentwertung und systemische Schocks beigemischt.`] : []),
        ...(input.includeSyntheticETFs && !(input.includeCurrencyHedging && input.baseCurrency !== "USD")
          ? [`Synthetische Replikation für US-Aktien: Das US-Aktien-Sleeve verwendet einen swap-basierten UCITS-ETF (Invesco S&P 500, IE00B3YCGJ38), um die 15%-Quellensteuer auf US-Dividenden zu eliminieren, der physisch replizierende, in Irland domizilierte Fonds unterliegen — strukturell ca. 20–30 Bp/Jahr Mehrertrag bei niedrigerer TER (5 Bp). Im Gegenzug wird ein kontrolliertes Kontrahentenrisiko gegenüber den Swap-Kontrahenten eingegangen, das durch tägliches Collateral-Management und die UCITS-10%-Grenze pro Kontrahent begrenzt ist. Synthetische Replikation wird bewusst nur dort eingesetzt, wo der Steuervorteil materiell ist; physisch replizierende ETFs werden für Europa, Japan, EM, Anleihen und Sachwerte beibehalten, um Transparenz und Robustheit zu wahren.`]
          : [])
      ]
    : [
        `The portfolio targets a ${equityPct}% / ${defensivePct}% equity-to-defensive split, aligned with a ${input.riskAppetite} risk profile and ${input.horizon}-year horizon.`,
        `Equities are globally diversified with a structural allocation to US markets, balanced by ${input.baseCurrency !== "USD" ? 'regional exposures' : 'international markets'}.`,
        ...(input.includeCrypto ? [`A small ${weights["Crypto"]}% satellite allocation to digital assets provides asymmetric upside potential.`] : []),
        ...(weights["Commodities"] > 0 ? [`Gold is included as a diversifier against fiat currency debasement and systemic shocks.`] : []),
        ...(input.includeSyntheticETFs && !(input.includeCurrencyHedging && input.baseCurrency !== "USD")
          ? [`Synthetic replication for US equity: the US equity sleeve uses a swap-based UCITS ETF (Invesco S&P 500, IE00B3YCGJ38) to eliminate the 15% withholding tax on US dividends that physical, Irish-domiciled funds incur — a structural pickup of roughly 20–30 bps per year on top of a lower TER (5 bps). In exchange, the portfolio takes controlled counterparty risk to the swap counterparties, mitigated by daily collateral and the UCITS 10%-per-counterparty cap. Synthetic replication is applied only where the tax advantage is material; physical replication is retained for Europe, Japan, EM, fixed income and real assets to preserve transparency and robustness.`]
          : [])
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

  const emPct = weights["Equity_EM"] || 0;
  const learning = de
    ? [
        input.horizon < 5 && equityPct > 50 ? "Horizontrisiko: Hohe Aktienquoten mit kurzem Horizont erhöhen das Risiko, Verluste zu realisieren, wenn Mittel während eines Abschwungs benötigt werden." : "",
        input.horizon >= 15 && equityPct >= 70 ? "Zeitdiversifikation: Lange Horizonte lassen die Aktienrisikoprämie über kurzfristige Volatilität dominieren — investiert bleiben schlägt Markt-Timing." : "",
        !input.includeCurrencyHedging && input.baseCurrency !== "USD" ? "Rolle der Währung: Ungesicherte Fremdwährungsaktien können als Diversifikator wirken, da lokale Währungen in globalen Marktpaniken oft schwächer werden." : "",
        input.includeCurrencyHedging ? "Hedging-Kosten: Währungsabsicherung beseitigt FX-Volatilität, kostet aber das Zinsdifferential — sinnvoll für Anleihen, umstritten für Aktien über lange Horizonte." : "",
        bondsPct < 10 ? "Stabilisierungsfunktion: Niedrige Anleihenquoten bedeuten, dass das Portfolio stark auf Aktienrisikoprämien angewiesen ist und weniger natürliche Stoßdämpfer hat." : "",
        cashPct > 8 ? "Opportunitätskosten: Cash schmälert reale Renditen über lange Horizonte; halten Sie nur, was für Liquidität und Rebalancing wirklich nötig ist." : "",
        input.includeCrypto ? "Positionsgrößenbestimmung: Selbst kleine Allokationen in hochvolatile Anlagen können das Portfoliorisiko spürbar verschieben — die Begrenzung auf 1–3 % spiegelt diese Asymmetrie wider." : "",
        input.includeCommodities && goldPct > 0 ? "Krisen-Hedge: Gold entkoppelt sich oft (nicht immer) in Liquiditätspaniken von Aktien — als Versicherung verstehen, nicht als Renditemotor." : "",
        input.includeListedRealEstate ? "Börsennotierte Immobilien: REITs verhalten sich kurzfristig wie Aktien, liefern aber langfristig Mietrendite-Exposure — kein Ersatz für Direktinvestitionen." : "",
        input.thematicPreference !== "None" ? "Konzentrations-Trade-off: Thematische ETFs opfern Diversifikation für Überzeugung; eine Begrenzung auf 5–10 % verhindert, dass sie die Rendite dominieren." : "",
        input.includeSyntheticETFs ? "Steuer-Drag: US-Quellensteuer auf Dividenden kostet ~30 Bp/Jahr — synthetische Replikation eliminiert dieses Leck via Total-Return-Swap, akzeptiert aber kontrolliertes Kontrahentenrisiko." : "",
        emPct >= 15 ? "Schwellenländer-Prämie: Höhere erwartete Renditen kommen mit Staats-, Währungs- und Governance-Risiken — lange Horizonte helfen, die Aktienrisikoprämie zu vereinnahmen." : "",
        input.numETFs >= 10 ? "Abnehmender Grenznutzen: Jenseits von ~10 ETFs erhöhen weitere Positionen die Komplexität, ohne die Diversifikation spürbar zu verbessern." : "",
        input.numETFs <= 4 ? "Operative Einfachheit: Ein 3–4-Fonds-Portfolio erfasst über 80 % des Diversifikationsvorteils und reduziert Rebalancing-Reibung." : ""
      ].filter(Boolean)
    : [
        input.horizon < 5 && equityPct > 50 ? "Horizon Risk: High equity allocations with short horizons increase the chance of realizing losses if funds are needed during a downturn." : "",
        input.horizon >= 15 && equityPct >= 70 ? "Time Diversification: Longer horizons let the equity risk premium dominate short-term volatility — staying invested beats market timing." : "",
        !input.includeCurrencyHedging && input.baseCurrency !== "USD" ? "Currency Role: Unhedged foreign equities can act as a diversifier, as local currencies often weaken during global market panics." : "",
        input.includeCurrencyHedging ? "Hedging Cost: Currency hedging removes FX volatility but costs the interest-rate differential — useful for bonds, debatable for equities over long horizons." : "",
        bondsPct < 10 ? "Stabilization Role: Low bond allocations mean the portfolio relies heavily on equity risk premiums and has fewer natural shock absorbers." : "",
        cashPct > 8 ? "Opportunity Cost: Cash drags real returns over long horizons; hold only what you need for liquidity and rebalancing." : "",
        input.includeCrypto ? "Position Sizing: Even small allocations to high-vol assets can meaningfully shift portfolio risk — capping at 1–3% reflects this asymmetry." : "",
        input.includeCommodities && goldPct > 0 ? "Crisis Hedge: Gold often (not always) decouples from equities during liquidity panics; treat it as insurance, not a return engine." : "",
        input.includeListedRealEstate ? "Listed Real Estate: REITs trade like equities short-term but provide rental-yield exposure long-term — they are not a substitute for direct property." : "",
        input.thematicPreference !== "None" ? "Concentration Trade-off: Thematic ETFs sacrifice diversification for conviction; capping at 5–10% prevents them from dominating returns." : "",
        input.includeSyntheticETFs ? "Tax Drag: US dividend withholding costs ~30 bps/yr — synthetic replication eliminates this leakage via total-return swap, accepting controlled counterparty risk." : "",
        emPct >= 15 ? "Emerging Markets Premium: Higher expected returns come with sovereign, currency and governance risks — long horizons help capture the equity risk premium." : "",
        input.numETFs >= 10 ? "Diminishing Returns: Beyond ~10 ETFs, additional positions add complexity without meaningfully improving diversification." : "",
        input.numETFs <= 4 ? "Operational Simplicity: A 3–4 fund portfolio captures 80%+ of the diversification benefit and reduces rebalancing friction." : ""
      ].filter(Boolean);

  return {
    allocation,
    etfImplementation,
    rationale,
    risks,
    learning: (learning.length > 0
      ? learning
      : [de ? "Diversifikation: Der einzige Free Lunch in der Finanzwelt." : "Diversification: The only free lunch in finance."]
    ).slice(0, 3)
  };
}
