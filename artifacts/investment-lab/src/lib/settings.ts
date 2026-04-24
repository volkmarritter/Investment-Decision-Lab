const RF_KEY = "idl.riskFreeRate";
const RF_EVENT = "idl-rf-changed";
const RF_DEFAULT = 0.025;

export function getRiskFreeRate(): number {
  if (typeof window === "undefined") return RF_DEFAULT;
  const raw = window.localStorage.getItem(RF_KEY);
  if (raw === null) return RF_DEFAULT;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0 || v > 0.2) return RF_DEFAULT;
  return v;
}

export function setRiskFreeRate(rate: number) {
  if (typeof window === "undefined") return;
  const clamped = Math.max(0, Math.min(0.2, rate));
  window.localStorage.setItem(RF_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: clamped }));
}

export function resetRiskFreeRate() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RF_KEY);
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: RF_DEFAULT }));
}

export function subscribeRiskFreeRate(cb: (rate: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (typeof detail === "number") cb(detail);
  };
  window.addEventListener(RF_EVENT, handler);
  return () => window.removeEventListener(RF_EVENT, handler);
}

export const RF_DEFAULT_RATE = RF_DEFAULT;

// ----------------------------------------------------------------------------
// CMA user overrides (per-asset-class μ / σ).
// ----------------------------------------------------------------------------
// Stored as { [assetKey]: { expReturn?: number, vol?: number } } in localStorage.
// Applied on top of the seed CMA + consensus values in metrics.ts at module
// load and whenever a CMA_EVENT fires. This is the "Option B" finance-pro
// hook: lets the user inject their own house view without code changes.

const CMA_KEY = "idl.cmaOverrides";
const CMA_EVENT = "idl-cma-changed";

export type CMAUserOverride = { expReturn?: number; vol?: number };
export type CMAUserOverrides = Record<string, CMAUserOverride>;

// Asset keys that user overrides may target. Anything outside this whitelist
// (typo, stale entry, tampering) is silently dropped on read.
const CMA_VALID_KEYS = new Set<string>([
  "equity_us", "equity_eu", "equity_ch", "equity_jp", "equity_em",
  "equity_thematic", "bonds", "cash", "gold", "reits", "crypto",
]);

function sanitizeOverrideEntry(v: unknown): CMAUserOverride | null {
  if (!v || typeof v !== "object") return null;
  const src = v as { expReturn?: unknown; vol?: unknown };
  const out: CMAUserOverride = {};
  if (typeof src.expReturn === "number" && Number.isFinite(src.expReturn)) {
    out.expReturn = Math.max(-0.5, Math.min(1, src.expReturn));
  }
  if (typeof src.vol === "number" && Number.isFinite(src.vol) && src.vol >= 0) {
    out.vol = Math.max(0, Math.min(2, src.vol));
  }
  return out.expReturn !== undefined || out.vol !== undefined ? out : null;
}

export function getCMAOverrides(): CMAUserOverrides {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(CMA_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Re-sanitize on every read so values written by older app versions or
    // tampered with manually still respect the bounds and key whitelist.
    const out: CMAUserOverrides = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!CMA_VALID_KEYS.has(k)) continue;
      const entry = sanitizeOverrideEntry(v);
      if (entry) out[k] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

export function setCMAOverrides(overrides: CMAUserOverrides) {
  if (typeof window === "undefined") return;
  // Strip any all-undefined entries so the editor can clear individual fields.
  const cleaned: CMAUserOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    const entry: CMAUserOverride = {};
    if (typeof v.expReturn === "number" && Number.isFinite(v.expReturn)) {
      entry.expReturn = Math.max(-0.5, Math.min(1, v.expReturn));
    }
    if (typeof v.vol === "number" && Number.isFinite(v.vol) && v.vol >= 0) {
      entry.vol = Math.max(0, Math.min(2, v.vol));
    }
    if (entry.expReturn !== undefined || entry.vol !== undefined) cleaned[k] = entry;
  }
  window.localStorage.setItem(CMA_KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent(CMA_EVENT, { detail: cleaned }));
}

export function resetCMAOverrides() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CMA_KEY);
  window.dispatchEvent(new CustomEvent(CMA_EVENT, { detail: {} }));
}

export function subscribeCMAOverrides(cb: (o: CMAUserOverrides) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") cb(detail as CMAUserOverrides);
  };
  window.addEventListener(CMA_EVENT, handler);
  return () => window.removeEventListener(CMA_EVENT, handler);
}
