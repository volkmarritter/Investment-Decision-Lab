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
