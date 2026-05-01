
import {
  ALL_BUCKET_KEYS,
  getBucketKeyForIsin,
  getBucketMeta,
  getInstrumentByIsin,
  pickDefaultListing,
} from "./etfs";
import { profileFor } from "./lookthrough";
import {
  AssetAllocation,
  BaseCurrency,
  ETFImplementation,
  RiskAppetite,
  ValidationResult,
  ValidationSuggestion,
} from "./types";
import type { Lang } from "./i18n";

export interface PersonalPosition {
  isin: string;
  bucketKey: string;
  weight: number;
  manualMeta?: {
    assetClass: string;
    region: string;
    name?: string;
    currency?: string;
    terBps?: number;
  };
}

export interface PersonalPortfolio {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  totalWeight: number;
}

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

// Asset classes for which a geographic region carries no analytical
// signal:
//   - Commodities are fungible globally (gold is gold regardless of
//     where it is custodied).
//   - Cash is dimensioned by currency, not by geography.
//   - Digital Assets (crypto) are decentralised by construction.
// For these we normalise the stored region to "Global" inside the
// sleeve resolver, and the Explain manual-entry UI hides the Region
// selector altogether (see ExplainPortfolio.tsx). The normalisation
// here is the safety net: legacy saved portfolio files (and any old
// manualMeta blobs) flow through this resolver and end up tagged
// consistently regardless of what region happened to be stored at the
// time. We only normalise the manual-entry branch — catalog buckets
// are curated and trusted, so their declared region is preserved as-is.
export const NO_REGION_ASSET_CLASSES: ReadonlySet<string> = new Set([
  "Commodities",
  "Cash",
  "Digital Assets",
]);

export function assetClassNeedsRegion(assetClass: string): boolean {
  return !NO_REGION_ASSET_CLASSES.has(assetClass);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function resolveSleeve(
  p: PersonalPosition,
): { assetClass: string; region: string } | undefined {
  if (p.bucketKey) {
    const meta = getBucketMeta(p.bucketKey);
    if (meta) return { assetClass: meta.assetClass, region: meta.region };
  }
  if (p.manualMeta && p.manualMeta.assetClass) {
    const ac = p.manualMeta.assetClass;
    // For region-less asset classes (Commodities, Cash, Digital Assets)
    // we collapse the region to "Global" regardless of what the stored
    // value happens to be — the Explain UI hides the Region selector
    // for these classes, so any non-"Global" value here would only
    // come from a legacy saved file and would otherwise leak into
    // sleeve grouping ("Gold | Europe") and exports nonsensically.
    if (!assetClassNeedsRegion(ac)) {
      return { assetClass: ac, region: "Global" };
    }
    if (p.manualMeta.region) {
      return { assetClass: ac, region: p.manualMeta.region };
    }
  }
  return undefined;
}

export function synthesizePersonalPortfolio(
  positions: ReadonlyArray<PersonalPosition>,
  baseCurrency: BaseCurrency,
  lang: Lang = "en",
): PersonalPortfolio {
  const de = lang === "de";

  const sleeveWeights = new Map<string, { assetClass: string; region: string; weight: number }>();
  for (const p of positions) {
    if (!Number.isFinite(p.weight) || p.weight <= 0) continue;
    const sleeve = resolveSleeve(p);
    if (!sleeve) continue;
    const key = `${sleeve.assetClass}|${sleeve.region}`;
    const existing = sleeveWeights.get(key);
    if (existing) existing.weight += p.weight;
    else sleeveWeights.set(key, { ...sleeve, weight: p.weight });
  }

  const allocation: AssetAllocation[] = [];
  for (const sleeve of sleeveWeights.values()) {
    allocation.push({
      assetClass: sleeve.assetClass,
      region: sleeve.region,
      weight: round1(sleeve.weight),
    });
  }
  allocation.sort((a, b) => {
    const ra = assetClassRank(a.assetClass);
    const rb = assetClassRank(b.assetClass);
    if (ra !== rb) return ra - rb;
    return b.weight - a.weight;
  });

  const etfImplementation: ETFImplementation[] = [];
  for (const p of positions) {
    if (!Number.isFinite(p.weight) || p.weight <= 0) continue;
    const sleeve = resolveSleeve(p);
    if (!sleeve) continue;
    const inst = getInstrumentByIsin(p.isin);
    if (inst) {
      const { ticker, exchange } = pickDefaultListing(inst);
      etfImplementation.push({
        bucket: `${sleeve.assetClass} - ${sleeve.region}`,
        assetClass: sleeve.assetClass,
        weight: round1(p.weight),
        intent: de
          ? `Selbst gewählter ETF im Sleeve ${sleeve.assetClass} / ${sleeve.region}.`
          : `User-picked ETF in the ${sleeve.assetClass} / ${sleeve.region} sleeve.`,
        exampleETF: inst.name,
        rationale: de
          ? `Vom Anwender bestätigte Position (ISIN ${inst.isin}).`
          : `User-confirmed holding (ISIN ${inst.isin}).`,
        isin: inst.isin,
        ticker,
        exchange,
        terBps: inst.terBps,
        domicile: inst.domicile,
        replication: inst.replication,
        distribution: inst.distribution,
        currency: inst.currency,
        comment: inst.comment,
        catalogKey: p.bucketKey,
        selectedSlot: 0,
        selectableOptions: [],
      });
    } else if (p.manualMeta) {
      const mm = p.manualMeta;
      // Off-catalog manual entry: opportunistically pull metadata from
      // the same sources the live preview uses so the ETF Implementation
      // table reflects what we know rather than the bare manualMeta. The
      // catalog lookup above (`inst`) returned undefined for this branch,
      // so it's redundant here — we only need the pool. The pool gives
      // us a freshness stamp (`breakdownsAsOf` / `topHoldingsAsOf`)
      // which we surface in the comment so the operator can tell at a
      // glance whether the look-through cards downstream are using
      // up-to-date data for this position.
      const pool = profileFor(p.isin);
      const poolStamp =
        pool?.breakdownsAsOf ?? pool?.topHoldingsAsOf ?? null;
      const comment = pool
        ? de
          ? `Manuell erfasst — Pool-Look-Through aus justETF${
              poolStamp ? ` (Stand: ${poolStamp.slice(0, 10)})` : ""
            }.`
          : `Manually entered — pool look-through from justETF${
              poolStamp ? ` (as of ${poolStamp.slice(0, 10)})` : ""
            }.`
        : de
          ? "Manuell erfasst — keine Katalog-Look-Through-Daten verfügbar."
          : "Manually entered — no catalog look-through data available.";
      etfImplementation.push({
        bucket: `${sleeve.assetClass} - ${sleeve.region}`,
        assetClass: sleeve.assetClass,
        weight: round1(p.weight),
        intent: de
          ? `Manuell erfasster ETF im Sleeve ${sleeve.assetClass} / ${sleeve.region}.`
          : `Manually entered ETF in the ${sleeve.assetClass} / ${sleeve.region} sleeve.`,
        exampleETF: mm.name ?? p.isin,
        rationale: de
          ? `Manuell erfasste Position (ISIN ${p.isin}).`
          : `Manually entered holding (ISIN ${p.isin}).`,
        isin: p.isin,
        ticker: "",
        exchange: "",
        terBps: typeof mm.terBps === "number" ? mm.terBps : 0,
        domicile: "",
        replication: "",
        distribution: "Accumulating",
        currency: mm.currency ?? baseCurrency,
        comment,
        catalogKey: "",
        selectedSlot: 0,
        selectableOptions: [],
      });
    }
  }

  let totalWeight = 0;
  for (const row of allocation) totalWeight += row.weight;
  totalWeight = round1(totalWeight);

  return { allocation, etfImplementation, totalWeight };
}


const RISK_EQUITY_CAP: Record<RiskAppetite, number> = {
  "Low": 40,
  "Moderate": 70,
  "High": 90,
  "Very High": 100,
};

export function runExplainValidation(
  positions: ReadonlyArray<PersonalPosition>,
  riskAppetite: RiskAppetite,
  baseCurrency: BaseCurrency,
  lang: Lang = "en",
): ValidationResult {
  const de = lang === "de";
  const errors: ValidationSuggestion[] = [];
  const warnings: ValidationSuggestion[] = [];
  void baseCurrency;

  if (positions.length === 0) {
    warnings.push({
      message: de
        ? "Keine Positionen erfasst."
        : "No positions entered yet.",
      suggestion: de
        ? "Fügen Sie mindestens einen ETF aus dem Katalog hinzu, um die Analyse zu starten."
        : "Add at least one ETF from the catalog to start the analysis.",
    });
    return { errors, warnings, isValid: false };
  }

  let sum = 0;
  for (const p of positions) sum += Number.isFinite(p.weight) ? p.weight : 0;
  const sumRounded = round1(sum);
  if (Math.abs(sumRounded - 100) > 0.5) {
    errors.push({
      message: de
        ? `Summe der Gewichte beträgt ${sumRounded.toFixed(1)}%, nicht 100%.`
        : `Weights sum to ${sumRounded.toFixed(1)}%, not 100%.`,
      suggestion: de
        ? "Passen Sie die Gewichte so an, dass die Summe genau 100% ergibt."
        : "Adjust the weights so they sum to exactly 100%.",
    });
  }

  for (const p of positions) {
    if (!p.isin && Number.isFinite(p.weight) && p.weight > 0) {
      errors.push({
        message: de
          ? `Position ohne ausgewählten ETF (Gewicht ${round1(p.weight)}%).`
          : `Row has no ETF selected (weight ${round1(p.weight)}%).`,
        suggestion: de
          ? "Wählen Sie einen ETF aus dem Katalog oder entfernen Sie die Zeile."
          : "Pick an ETF from the catalog or remove the row.",
      });
    }
  }
  const completed = positions.filter((p) => !!p.isin);

  for (const p of completed) {
    if (!Number.isFinite(p.weight) || p.weight <= 0 || p.weight > 100) {
      errors.push({
        message: de
          ? `Ungültiges Gewicht für ISIN ${p.isin} (${p.weight}%).`
          : `Invalid weight for ISIN ${p.isin} (${p.weight}%).`,
        suggestion: de
          ? "Jede Position muss ein Gewicht zwischen 0,1% und 100% haben."
          : "Each position must carry a weight between 0.1% and 100%.",
      });
    }
  }

  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const p of completed) {
    if (seen.has(p.isin)) dups.add(p.isin);
    seen.add(p.isin);
  }
  for (const isin of dups) {
    errors.push({
      message: de
        ? `Doppelte ISIN ${isin} im Portfolio.`
        : `Duplicate ISIN ${isin} in the portfolio.`,
      suggestion: de
        ? "Fassen Sie doppelte Einträge zu einer einzigen Position zusammen."
        : "Merge the duplicates into a single position.",
    });
  }

  let equityPct = 0;
  for (const p of completed) {
    const sleeve = resolveSleeve(p);
    if (!sleeve) continue;
    if (sleeve.assetClass === "Equity" || sleeve.assetClass === "Real Estate" || sleeve.assetClass === "Digital Assets") {
      equityPct += p.weight;
    }
  }
  const cap = RISK_EQUITY_CAP[riskAppetite];
  if (equityPct > cap + 15) {
    errors.push({
      message: de
        ? `Risiko-Aktien-Quote (${round1(equityPct)}%) übersteigt das Maximum für Risikoprofil "${riskAppetite}" deutlich.`
        : `Risk-asset weight (${round1(equityPct)}%) significantly exceeds the maximum for a ${riskAppetite} risk profile.`,
      suggestion: de
        ? `Reduzieren Sie die Aktien-/REIT-/Krypto-Quote auf ${cap}% oder weniger, oder erhöhen Sie das Risikoprofil.`
        : `Reduce equity / REITs / crypto exposure to ${cap}% or below, or raise the risk profile.`,
    });
  } else if (equityPct > cap) {
    warnings.push({
      message: de
        ? `Risiko-Aktien-Quote (${round1(equityPct)}%) liegt über dem Richtwert ${cap}% für Risikoprofil "${riskAppetite}".`
        : `Risk-asset weight (${round1(equityPct)}%) is above the ${cap}% guideline for a ${riskAppetite} risk profile.`,
      suggestion: de
        ? "Erwägen Sie eine kleine Verlagerung in Anleihen-ETFs zur besseren Profil-Konsistenz."
        : "Consider shifting a small slice into bond ETFs for better profile consistency.",
    });
  }

  const presentByCore = new Map<string, { hedged: boolean; unhedged: boolean }>();
  for (const p of completed) {
    if (!p.bucketKey) continue;
    const meta = getBucketMeta(p.bucketKey);
    if (!meta) continue;
    const coreKey = `${meta.assetClass}|${meta.region}`;
    const cur = presentByCore.get(coreKey) ?? { hedged: false, unhedged: false };
    if (meta.hedged) cur.hedged = true;
    else cur.unhedged = true;
    presentByCore.set(coreKey, cur);
  }
  for (const [coreKey, flags] of presentByCore.entries()) {
    if (flags.hedged && flags.unhedged) {
      const [ac, region] = coreKey.split("|");
      warnings.push({
        message: de
          ? `Sowohl gehedgte als auch ungehedgte ${ac}-${region}-ETFs vorhanden.`
          : `Both hedged and unhedged ${ac} ${region} ETFs are present.`,
        suggestion: de
          ? "Vermeiden Sie das gleichzeitige Halten beider Varianten desselben Sleeves; es verwässert die Hedging-Logik."
          : "Avoid holding both variants of the same sleeve at once; it dilutes the hedging logic.",
      });
    }
  }

  for (const p of completed) {
    if (!p.bucketKey && p.manualMeta) continue;
    const live = getBucketKeyForIsin(p.isin);
    if (!live) {
      warnings.push({
        message: de
          ? `ISIN ${p.isin} ist nicht mehr im Katalog registriert.`
          : `ISIN ${p.isin} is no longer registered in the catalog.`,
        suggestion: de
          ? "Entfernen Sie die Position oder wählen Sie einen aktuellen Ersatz aus dem Katalog."
          : "Remove the position or pick a current replacement from the catalog.",
      });
    } else if (live !== p.bucketKey) {
      warnings.push({
        message: de
          ? `ISIN ${p.isin} wurde im Katalog vom Sleeve "${p.bucketKey}" zu "${live}" verschoben.`
          : `ISIN ${p.isin} has been moved in the catalog from sleeve "${p.bucketKey}" to "${live}".`,
        suggestion: de
          ? "Wählen Sie den ETF erneut aus, damit die Analyse den aktuellen Sleeve verwendet."
          : "Re-pick this ETF so the analysis uses the current sleeve.",
      });
    }
  }

  for (const p of completed) {
    if (!p.bucketKey && p.manualMeta) continue;
    if (!p.bucketKey && !p.manualMeta) {
      errors.push({
        message: de
          ? `Position ohne Sleeve-Zuordnung (ISIN ${p.isin}).`
          : `Position has no sleeve assignment (ISIN ${p.isin}).`,
        suggestion: de
          ? "Wählen Sie den ETF aus dem Katalog oder erfassen Sie ihn manuell mit Asset-Klasse und Region."
          : "Pick the ETF from the catalog or enter it manually with asset class and region.",
      });
      continue;
    }
    if (ALL_BUCKET_KEYS.indexOf(p.bucketKey) < 0) {
      errors.push({
        message: de
          ? `Unbekannter Bucket "${p.bucketKey}" für ISIN ${p.isin}.`
          : `Unknown bucket "${p.bucketKey}" for ISIN ${p.isin}.`,
        suggestion: de
          ? "Entfernen Sie die Position und wählen Sie sie neu aus dem Katalog."
          : "Remove this position and re-pick it from the catalog.",
      });
    }
  }

  return { errors, warnings, isValid: errors.length === 0 };
}

export function normalizeWeights(
  positions: ReadonlyArray<PersonalPosition>,
): PersonalPosition[] {
  const out = positions.map((p) => ({ ...p }));
  if (out.length === 0) return out;

  let total = 0;
  for (const p of out) {
    if (Number.isFinite(p.weight) && p.weight > 0) total += p.weight;
  }
  if (total <= 0) return out;

  const scale = 100 / total;
  let runningSum = 0;
  let largestIdx = -1;
  let largestWeight = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const raw = out[i].weight > 0 ? out[i].weight * scale : 0;
    out[i].weight = round1(raw);
    runningSum += out[i].weight;
    if (out[i].weight > largestWeight) {
      largestWeight = out[i].weight;
      largestIdx = i;
    }
  }
  if (largestIdx >= 0) {
    const residual = round1(100 - runningSum);
    if (residual !== 0) {
      out[largestIdx].weight = round1(out[largestIdx].weight + residual);
    }
  }
  return out;
}
