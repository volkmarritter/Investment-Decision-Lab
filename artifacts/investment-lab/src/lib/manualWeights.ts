// Manual ETF weight overrides applied on top of the engine's natural
// allocation. Persisted in localStorage so they survive reloads and rebuilds,
// and broadcast via a custom event so the BuildPortfolio view reacts.
//
// Keying convention: a row's identity is `${assetClass} - ${region}` (the
// `bucket` string the engine already produces). This is stable across rebuilds
// because the engine derives the same bucket from the same input setting.
//
// Semantics:
//   - Each entry pins the weight of that bucket. The engine then redistributes
//     the residual (100 - sum_of_pinned) proportionally across the non-pinned
//     rows, preserving the engine's relative ranking on those rows.
//   - Stored entries for buckets not present in the current portfolio are kept
//     as-is (they re-apply if the bucket reappears later).
//   - Per-row weight is clamped to [0, 100]. If the sum of pinned weights is
//     >= 100, pinned rows are scaled down proportionally and non-pinned rows
//     are zeroed; the engine layer surfaces this via a flag the UI uses to
//     show a warning banner.

const STORAGE_KEY = "investment-lab.manualWeights.v1";
const CHANGE_EVENT = "manualWeightsChanged";

export type ManualWeights = Record<string, number>;

export function bucketKey(assetClass: string, region: string): string {
  return `${assetClass} - ${region}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadManualWeights(): ManualWeights {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ManualWeights = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = Math.max(0, Math.min(100, v));
      }
    }
    return out;
  } catch (error) {
    console.error("Failed to read manual weight overrides", error);
    return {};
  }
}

function persist(next: ManualWeights): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (error) {
    console.error("Failed to write manual weight overrides", error);
  }
}

export function setManualWeight(bucket: string, weight: number): ManualWeights {
  const clamped = Math.max(0, Math.min(100, Math.round(weight * 10) / 10));
  const next = { ...loadManualWeights(), [bucket]: clamped };
  persist(next);
  return next;
}

export function clearManualWeight(bucket: string): ManualWeights {
  const next = { ...loadManualWeights() };
  delete next[bucket];
  persist(next);
  return next;
}

export function clearAllManualWeights(): void {
  persist({});
}

// ---------------------------------------------------------------------------
// Pure parser for any user-typed numeric input. Exported (and unit-tested)
// because `<input type="number">` silently strips locale-comma decimals on
// mobile keyboards (Swiss / German / French), so any component reading a
// decimal value should use a plain text input + `inputMode="decimal"` and
// route every keystroke through here. Returns null for inputs that cannot be
// coerced into a finite number; the caller decides what to do (revert vs
// clear vs treat as zero).
//
// The whitelist regex deliberately allows three mobile-friendly partial forms
// that all parse to a sensible number:
//   - "12"           → 12       (integer)
//   - "12.5" / "12,5"→ 12.5     (full decimal, dot or comma separator)
//   - "12." / "12,"  → 12       (trailing separator — common mid-edit state)
//   - ".5"  / ",5"   → 0.5      (leading separator — also a mid-edit state)
// Anything else (empty, garbage, multiple separators, letters) returns null.
//
// Audit (numeric inputs in the lab):
//   FIXED to text + inputMode=decimal + parseDecimalInput:
//     - BuildPortfolio   "ManualWeightCell"          (Task #12, baseline)
//     - FeeEstimator     "Investment Amount"
//     - MonteCarlo       "Investment Amount"
//     - ExplainPortfolio "Weight %" cell (positions table)
//   KEPT as <input type="number"> on purpose (integer-only fields where the
//   desktop spinner is still wanted, and where a user has no reason to type a
//   decimal at all — so the comma bug cannot fire):
//     - BuildPortfolio   "Horizon (Years)"           (1–40, integer)
//     - BuildPortfolio   "Target Equity Allocation"  (0–100, slider step=1)
//     - BuildPortfolio   "Number of ETFs Min / Max"  (3–15, integer)
//     - ComparePortfolios mirrors of the three above (same rationale)
//     - Methodology editors (CMA μ/σ, home-bias, risk-free rate) — admin-only,
//       outside the build/explain hot path; tracked as a follow-up sweep.
// ---------------------------------------------------------------------------
export interface ParseDecimalInputOptions {
  /** Lower bound (inclusive). Values below are clamped up. Default: no min. */
  min?: number;
  /** Upper bound (inclusive). Values above are clamped down. Default: no max. */
  max?: number;
  /** Round to this many decimal places before clamping. Default: no rounding. */
  decimals?: number;
}

export function parseDecimalInput(
  raw: string,
  opts: ParseDecimalInputOptions = {},
): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Either: optional sign + digits + optional (separator + optional digits),
  // or:     optional sign + separator + digits.
  if (!/^[+-]?(\d+[.,]?\d*|[.,]\d+)$/.test(trimmed)) return null;
  const parsed = parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  let v = parsed;
  if (typeof opts.decimals === "number" && opts.decimals >= 0) {
    const f = Math.pow(10, opts.decimals);
    v = Math.round(v * f) / f;
  }
  if (typeof opts.min === "number") v = Math.max(opts.min, v);
  if (typeof opts.max === "number") v = Math.min(opts.max, v);
  return v;
}

// Backward-compatible alias used by the manual ETF weight cell. Pinned weights
// live in [0, 100] and round to 0.1% to match the storage convention.
export function parseManualWeightInput(raw: string): number | null {
  return parseDecimalInput(raw, { min: 0, max: 100, decimals: 1 });
}

export function subscribeManualWeights(cb: (w: ManualWeights) => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => cb(loadManualWeights());
  window.addEventListener(CHANGE_EVENT, handler);
  // Cross-tab sync via the native storage event.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(loadManualWeights());
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

// ---------------------------------------------------------------------------
// Pure application step. Exported separately from the storage helpers so it
// is trivially testable from vitest without touching localStorage.
// ---------------------------------------------------------------------------

export interface ApplyResult {
  rows: Array<{ bucket: string; weight: number; isManualOverride: boolean }>;
  /** True if pinned weights sum to >= 100 and non-pinned rows had to be zeroed. */
  saturated: boolean;
  /** Sum of user-typed pinned weights (before any normalization). */
  pinnedSum: number;
  /** Number of overrides that applied to a bucket present in the allocation. */
  appliedCount: number;
  /** Override keys that did not match any current bucket (kept in storage). */
  staleKeys: string[];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Apply manual pinned weights to a natural allocation. Returns one entry per
 * input row, in the same order, with the post-redistribution weight and a flag
 * marking pinned rows. The output weights always sum to 100.0 (within float
 * rounding) when the input naturally sums to a positive number; rounding drift
 * is absorbed by the largest-weight row.
 */
export function applyManualWeights(
  natural: Array<{ bucket: string; weight: number }>,
  overrides: ManualWeights,
): ApplyResult {
  const presentKeys = new Set(natural.map((r) => r.bucket));
  const staleKeys = Object.keys(overrides).filter((k) => !presentKeys.has(k));

  const pinned: number[] = new Array(natural.length).fill(0);
  const isPinned: boolean[] = new Array(natural.length).fill(false);
  let pinnedSum = 0;
  let appliedCount = 0;
  for (let i = 0; i < natural.length; i++) {
    const ov = overrides[natural[i].bucket];
    if (typeof ov === "number" && Number.isFinite(ov)) {
      const v = Math.max(0, Math.min(100, ov));
      pinned[i] = v;
      isPinned[i] = true;
      pinnedSum += v;
      appliedCount++;
    }
  }

  const out: ApplyResult["rows"] = natural.map((r) => ({
    bucket: r.bucket,
    weight: r.weight,
    isManualOverride: false,
  }));

  if (appliedCount === 0) {
    return { rows: out, saturated: false, pinnedSum: 0, appliedCount: 0, staleKeys };
  }

  const saturated = pinnedSum >= 100;

  if (saturated) {
    // Scale pinned weights proportionally so they sum to exactly 100; zero out
    // non-pinned rows. Avoid divide-by-zero when every pinned value is 0.
    const scale = pinnedSum > 0 ? 100 / pinnedSum : 0;
    for (let i = 0; i < natural.length; i++) {
      out[i].weight = isPinned[i] ? round1(pinned[i] * scale) : 0;
      out[i].isManualOverride = isPinned[i];
    }
  } else {
    const residual = 100 - pinnedSum; // > 0
    let nonPinnedNaturalSum = 0;
    for (let i = 0; i < natural.length; i++) {
      if (!isPinned[i]) nonPinnedNaturalSum += Math.max(0, natural[i].weight);
    }
    if (nonPinnedNaturalSum <= 0) {
      // No non-pinned rows have positive weight — distribute residual evenly
      // across the (zero-weight) non-pinned rows if any exist; otherwise the
      // pinned rows sum < 100 and we scale them up to fill.
      const nonPinnedCount = natural.length - appliedCount;
      if (nonPinnedCount > 0) {
        const each = round1(residual / nonPinnedCount);
        for (let i = 0; i < natural.length; i++) {
          out[i].weight = isPinned[i] ? round1(pinned[i]) : each;
          out[i].isManualOverride = isPinned[i];
        }
      } else {
        const scale = pinnedSum > 0 ? 100 / pinnedSum : 0;
        for (let i = 0; i < natural.length; i++) {
          out[i].weight = round1(pinned[i] * scale);
          out[i].isManualOverride = true;
        }
      }
    } else {
      const scale = residual / nonPinnedNaturalSum;
      for (let i = 0; i < natural.length; i++) {
        if (isPinned[i]) {
          out[i].weight = round1(pinned[i]);
          out[i].isManualOverride = true;
        } else {
          out[i].weight = round1(Math.max(0, natural[i].weight) * scale);
          out[i].isManualOverride = false;
        }
      }
    }
  }

  // Fix rounding drift on the largest non-pinned row, falling back to the
  // largest pinned row if all rows are pinned.
  let totalAfter = 0;
  for (const r of out) totalAfter += r.weight;
  const drift = round1(100 - totalAfter);
  if (drift !== 0) {
    let target = -1;
    let bestW = -Infinity;
    for (let i = 0; i < out.length; i++) {
      if (!isPinned[i] && out[i].weight > bestW) {
        bestW = out[i].weight;
        target = i;
      }
    }
    if (target < 0) {
      for (let i = 0; i < out.length; i++) {
        if (out[i].weight > bestW) {
          bestW = out[i].weight;
          target = i;
        }
      }
    }
    if (target >= 0) out[target].weight = round1(out[target].weight + drift);
  }

  return { rows: out, saturated, pinnedSum, appliedCount, staleKeys };
}
