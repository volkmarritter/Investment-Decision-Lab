// ----------------------------------------------------------------------------
// Risk-free rate — per base currency.
// ----------------------------------------------------------------------------
// Replaces the previous single global RF (Task #32, 2026-04-26). Each base
// currency keeps its own RF because money-market yields diverge meaningfully
// across regions (CHF SARON ≈ 0.5%, EUR ESTR ≈ 2.5%, GBP SONIA ≈ 4.0%, USD
// T-Bills ≈ 4.25%). Sharpe, Alpha and the Sharpe-tilt step of equity
// construction all now thread `baseCurrency` so the appropriate RF is used
// in every calculation.
//
// Storage layout: a single JSON object under `idl.riskFreeRates` keyed by
// currency. Sanitized on every read (currency whitelist + value bounds).
// The old `idl.riskFreeRate` key (single global value) is dropped on module
// load — no value migration; new defaults take over.
//
// Type unification (Task #34, 2026-04-26): `RFCurrency` and `HomeBiasCurrency`
// are now type aliases of the canonical `BaseCurrency` from ./types. Typing
// `RF_DEFAULTS` / `HOME_BIAS_DEFAULTS` as `Record<BaseCurrency, number>`
// means TypeScript will refuse to compile if a new base currency (e.g. JPY)
// is added without supplying matching defaults here — closing the silent
// fallthrough hole that the previous hand-aligned literal unions allowed.

import type { BaseCurrency } from "./types";
import { APP_DEFAULTS } from "./appDefaults";

export type RFCurrency = BaseCurrency;

// Hard-coded ship-time fallback. Used when the operator-managed
// `app-defaults.json` does not specify a value for a given currency.
// Exportiert, damit die Admin-UI den Built-in-Fallback-Wert neben jedem
// Editor-Feld anzeigen kann (Aktuelle-Werte-Anzeige).
export const BUILT_IN_RF: Record<BaseCurrency, number> = {
  USD: 0.0425,
  EUR: 0.0250,
  GBP: 0.0400,
  CHF: 0.0050,
};

// Effective ship-wide defaults: built-in seed merged with the
// admin-managed overlay from `src/data/app-defaults.json` (Task #35,
// 2026-04-27). The admin-PR pane writes to that JSON; after the PR is
// merged and redeployed, every user picks up the new defaults via the
// bundle. Per-user overrides from the Methodology editor (localStorage)
// still layer on top of these in `getRiskFreeRates()`.
export const RF_DEFAULTS: Record<BaseCurrency, number> = (() => {
  const out = { ...BUILT_IN_RF };
  for (const [k, v] of Object.entries(APP_DEFAULTS.riskFreeRates)) {
    if (k in out) out[k as BaseCurrency] = v;
  }
  return out;
})();

export type RFOverrides = Partial<Record<RFCurrency, number>>;

const RF_KEY = "idl.riskFreeRates";
const RF_LEGACY_KEY = "idl.riskFreeRate"; // dropped on module load
const RF_EVENT = "idl-rf-changed";
// Derived from RF_DEFAULTS so the runtime whitelist can never drift from the
// compile-time type — adding a currency to BaseCurrency forces a new RF
// default which is then automatically allowed through the sanitiser.
const RF_VALID_KEYS = new Set<RFCurrency>(Object.keys(RF_DEFAULTS) as RFCurrency[]);
// Money-market yields realistically live in [0%, 20%]; clamp on read AND write.
const RF_MIN = 0;
const RF_MAX = 0.2;

function sanitizeRfValue(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(RF_MIN, Math.min(RF_MAX, v));
}

// One-time cleanup of the legacy single-global key. Runs at module load only;
// the value is intentionally NOT migrated — the new per-currency defaults
// (USD 4.25 / EUR 2.50 / GBP 4.00 / CHF 0.50) take over.
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(RF_LEGACY_KEY); } catch { /* ignore */ }
}

export function getRiskFreeRates(): Record<RFCurrency, number> {
  const out = { ...RF_DEFAULTS };
  if (typeof window === "undefined") return out;
  const raw = window.localStorage.getItem(RF_KEY);
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return out;
    for (const [k, v] of Object.entries(parsed)) {
      if (!RF_VALID_KEYS.has(k as RFCurrency)) continue;
      const s = sanitizeRfValue(v);
      if (s !== undefined) out[k as RFCurrency] = s;
    }
    return out;
  } catch {
    return out;
  }
}

export function getRiskFreeRateOverrides(): RFOverrides {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(RF_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: RFOverrides = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!RF_VALID_KEYS.has(k as RFCurrency)) continue;
      const s = sanitizeRfValue(v);
      if (s !== undefined) out[k as RFCurrency] = s;
    }
    return out;
  } catch {
    return {};
  }
}

export function getRiskFreeRate(ccy: RFCurrency): number {
  const all = getRiskFreeRates();
  return all[ccy];
}

export function setRiskFreeRate(ccy: RFCurrency, rate: number) {
  if (typeof window === "undefined") return;
  if (!RF_VALID_KEYS.has(ccy)) return;
  const s = sanitizeRfValue(rate);
  if (s === undefined) return;
  const current = getRiskFreeRateOverrides();
  current[ccy] = s;
  window.localStorage.setItem(RF_KEY, JSON.stringify(current));
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: getRiskFreeRates() }));
}

export function resetRiskFreeRate(ccy: RFCurrency) {
  if (typeof window === "undefined") return;
  if (!RF_VALID_KEYS.has(ccy)) return;
  const current = getRiskFreeRateOverrides();
  delete current[ccy];
  if (Object.keys(current).length === 0) {
    window.localStorage.removeItem(RF_KEY);
  } else {
    window.localStorage.setItem(RF_KEY, JSON.stringify(current));
  }
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: getRiskFreeRates() }));
}

export function resetAllRiskFreeRates() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RF_KEY);
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: getRiskFreeRates() }));
}

export function subscribeRiskFreeRate(cb: (rates: Record<RFCurrency, number>) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") cb(detail as Record<RFCurrency, number>);
  };
  window.addEventListener(RF_EVENT, handler);
  return () => window.removeEventListener(RF_EVENT, handler);
}

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
  "equity_us", "equity_eu", "equity_uk", "equity_ch", "equity_jp", "equity_em",
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

// Reset just one asset class back to its seed/consensus default. Symmetric to
// `resetRiskFreeRate(ccy)` so the editor UI can offer a per-row reset action
// instead of forcing the user into an all-or-nothing wipe.
export function resetCMAOverride(key: string) {
  if (typeof window === "undefined") return;
  if (!CMA_VALID_KEYS.has(key)) return;
  const current = getCMAOverrides();
  if (current[key] === undefined) return;
  delete current[key];
  if (Object.keys(current).length === 0) {
    window.localStorage.removeItem(CMA_KEY);
  } else {
    window.localStorage.setItem(CMA_KEY, JSON.stringify(current));
  }
  window.dispatchEvent(new CustomEvent(CMA_EVENT, { detail: current }));
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

// ----------------------------------------------------------------------------
// Home-bias overlay overrides (per base currency).
// ----------------------------------------------------------------------------
// The portfolio engine multiplies the home-region market-cap weight by a
// base-currency-specific factor (see portfolio.ts → HOME_TILT). Defaults are:
//   USD → 1.0 (USA already dominant)
//   EUR → 1.5 (Europe)
//   GBP → 1.5 (United Kingdom — UK is carved out of Europe in MCAP_ANCHOR_GBP)
//   CHF → 2.5 (Switzerland anchor is small, needs more tilt)
// User can override these per currency at runtime. Stored in localStorage; a
// custom event lets components re-build their portfolio.

const HB_KEY = "idl.homeBiasOverrides";
const HB_EVENT = "idl-homebias-changed";

export type HomeBiasCurrency = BaseCurrency;
export type HomeBiasOverrides = Partial<Record<HomeBiasCurrency, number>>;

// Hard-coded ship-time fallback. Used when the operator-managed
// `app-defaults.json` does not specify a value for a given currency.
// Exportiert, damit die Admin-UI den Built-in-Fallback-Wert neben jedem
// Editor-Feld anzeigen kann (Aktuelle-Werte-Anzeige).
export const BUILT_IN_HB: Record<BaseCurrency, number> = {
  USD: 1.0,
  EUR: 1.5,
  GBP: 1.5,
  CHF: 2.5,
};

// Effective ship-wide defaults: built-in seed merged with the
// admin-managed overlay from `src/data/app-defaults.json` (Task #35,
// 2026-04-27). Same two-layer pattern as RF_DEFAULTS above.
export const HOME_BIAS_DEFAULTS: Record<BaseCurrency, number> = (() => {
  const out = { ...BUILT_IN_HB };
  for (const [k, v] of Object.entries(APP_DEFAULTS.homeBias)) {
    if (k in out) out[k as BaseCurrency] = v;
  }
  return out;
})();

// Derived from HOME_BIAS_DEFAULTS so the runtime whitelist can never drift
// from the compile-time type — see RF_VALID_KEYS for the same pattern.
const HB_VALID_KEYS = new Set<HomeBiasCurrency>(Object.keys(HOME_BIAS_DEFAULTS) as HomeBiasCurrency[]);
// Sanity bounds: a multiplier ≤ 0 would zero-out the home region; > 5 is
// economically unreasonable. Both ends matter — clamp on read AND on write.
const HB_MIN = 0;
const HB_MAX = 5;

function sanitizeHbValue(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(HB_MIN, Math.min(HB_MAX, v));
}

export function getHomeBiasOverrides(): HomeBiasOverrides {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(HB_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: HomeBiasOverrides = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!HB_VALID_KEYS.has(k as HomeBiasCurrency)) continue;
      const s = sanitizeHbValue(v);
      if (s !== undefined) out[k as HomeBiasCurrency] = s;
    }
    return out;
  } catch {
    return {};
  }
}

// Returns the resolved home-bias factor for a given currency, applying any
// user override on top of the engine default.
export function resolvedHomeBias(ccy: HomeBiasCurrency): number {
  const ov = getHomeBiasOverrides();
  return ov[ccy] !== undefined ? ov[ccy]! : HOME_BIAS_DEFAULTS[ccy];
}

export function setHomeBiasOverrides(overrides: HomeBiasOverrides) {
  if (typeof window === "undefined") return;
  const cleaned: HomeBiasOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!HB_VALID_KEYS.has(k as HomeBiasCurrency)) continue;
    const s = sanitizeHbValue(v);
    if (s !== undefined) cleaned[k as HomeBiasCurrency] = s;
  }
  window.localStorage.setItem(HB_KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent(HB_EVENT, { detail: cleaned }));
}

export function resetHomeBiasOverrides() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(HB_KEY);
  window.dispatchEvent(new CustomEvent(HB_EVENT, { detail: {} }));
}

// Reset just one currency back to its HOME_BIAS_DEFAULTS value. Symmetric to
// `resetRiskFreeRate(ccy)` so the editor UI can offer per-currency revert
// instead of forcing an all-or-nothing wipe.
export function resetHomeBiasOverride(ccy: HomeBiasCurrency) {
  if (typeof window === "undefined") return;
  if (!HB_VALID_KEYS.has(ccy)) return;
  const current = getHomeBiasOverrides();
  if (current[ccy] === undefined) return;
  delete current[ccy];
  if (Object.keys(current).length === 0) {
    window.localStorage.removeItem(HB_KEY);
  } else {
    window.localStorage.setItem(HB_KEY, JSON.stringify(current));
  }
  window.dispatchEvent(new CustomEvent(HB_EVENT, { detail: current }));
}

export function subscribeHomeBiasOverrides(cb: (o: HomeBiasOverrides) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") cb(detail as HomeBiasOverrides);
  };
  window.addEventListener(HB_EVENT, handler);
  return () => window.removeEventListener(HB_EVENT, handler);
}

// ----------------------------------------------------------------------------
// Last-built portfolio allocation (shared across tabs).
// Populated by the Build tab whenever the engine produces an output, cleared
// when the user resets. Read by any tab (e.g. Methodology) that wants to
// reflect the current portfolio's holdings — for example, marking which rows
// of the static correlation matrix are actually held. Lives in-memory only;
// not persisted to localStorage so it disappears on full page reload, which
// is the desired behaviour (the Methodology reference matrix should not show
// stale "held" markers from a previous session).
// ----------------------------------------------------------------------------
const LAST_ALLOC_EVENT = "idl-last-allocation-changed";
type LastAllocItem = { assetClass: string; region: string; weight: number };
let lastAllocation: LastAllocItem[] | null = null;

export function setLastAllocation(allocation: LastAllocItem[] | null): void {
  if (typeof window === "undefined") return;
  lastAllocation = allocation && allocation.length > 0
    ? allocation.map((a) => ({ assetClass: a.assetClass, region: a.region, weight: a.weight }))
    : null;
  window.dispatchEvent(new CustomEvent(LAST_ALLOC_EVENT, { detail: lastAllocation }));
}

export function getLastAllocation(): LastAllocItem[] | null {
  // Defensive copy so external consumers cannot mutate the internal in-memory
  // store by reference (e.g. a Methodology consumer accidentally re-sorting
  // the array would otherwise also reorder what BuildPortfolio sees on next read).
  return lastAllocation
    ? lastAllocation.map((a) => ({ assetClass: a.assetClass, region: a.region, weight: a.weight }))
    : null;
}

export function subscribeLastAllocation(cb: (a: LastAllocItem[] | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    cb(detail ?? null);
  };
  window.addEventListener(LAST_ALLOC_EVENT, handler);
  return () => window.removeEventListener(LAST_ALLOC_EVENT, handler);
}

// ----------------------------------------------------------------------------
// Cross-tab publish/subscribe for the user's last-built ETF implementation.
// Mirrors the lastAllocation pattern above and lives alongside it: published by
// BuildPortfolio whenever `output` changes; consumed by Methodology so the
// reference correlation matrix can route exposures via the look-through-aware
// router (mapAllocationToAssetsLookthrough) when the user has actually built
// a portfolio. Without this, Methodology would still route the Europe ETF row
// purely as continental EU and disagree with the TE-Contribution table for
// the same allocation. Like lastAllocation, in-memory only — fresh on reload.
// ----------------------------------------------------------------------------
const LAST_ETF_IMPL_EVENT = "idl-last-etf-implementation-changed";
// Kept loose (`unknown[]`) at the boundary because settings.ts must not import
// from src/lib/types (would create a Methodology → settings → types → metrics
// → settings cycle). Consumers re-cast to ETFImplementation[] at the call site.
let lastEtfImplementation: unknown[] | null = null;

export function setLastEtfImplementation(impl: unknown[] | null): void {
  if (typeof window === "undefined") return;
  lastEtfImplementation = impl && impl.length > 0 ? [...impl] : null;
  window.dispatchEvent(new CustomEvent(LAST_ETF_IMPL_EVENT, { detail: lastEtfImplementation }));
}

export function getLastEtfImplementation(): unknown[] | null {
  // Defensive copy so consumers can't mutate the internal store. Inner objects
  // are not cloned because ETFImplementation is treated as immutable everywhere
  // it's read (engine builds it once per portfolio).
  return lastEtfImplementation ? [...lastEtfImplementation] : null;
}

export function subscribeLastEtfImplementation(
  cb: (impl: unknown[] | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    cb(detail ?? null);
  };
  window.addEventListener(LAST_ETF_IMPL_EVENT, handler);
  return () => window.removeEventListener(LAST_ETF_IMPL_EVENT, handler);
}

// ----------------------------------------------------------------------------
// Cross-tab publish/subscribe for the user's last Build PortfolioInput
// (form values) and last manual-weights snapshot. Mirrors the in-memory
// pattern of the channels above. Used by the Compare tab to auto-link
// Slot A to whatever the user has currently configured in Build, so the
// two views stay in sync without copy/paste of the same settings.
//
// Like the channels above, lives in-memory only — fresh on full page
// reload — and uses defensive copies at the boundary.
// Boundary types are deliberately loose (unknown / Record<string, number>)
// to avoid an import cycle with src/lib/types and src/lib/manualWeights.
// Consumers re-cast to PortfolioInput / ManualWeights at the call site.
// ----------------------------------------------------------------------------
const LAST_BUILD_INPUT_EVENT = "idl-last-build-input-changed";
let lastBuildInput: Record<string, unknown> | null = null;

export function setLastBuildInput(input: Record<string, unknown> | null): void {
  if (typeof window === "undefined") return;
  lastBuildInput = input ? { ...input } : null;
  window.dispatchEvent(new CustomEvent(LAST_BUILD_INPUT_EVENT, { detail: lastBuildInput }));
}

export function getLastBuildInput(): Record<string, unknown> | null {
  return lastBuildInput ? { ...lastBuildInput } : null;
}

export function subscribeLastBuildInput(
  cb: (input: Record<string, unknown> | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    cb(detail ?? null);
  };
  window.addEventListener(LAST_BUILD_INPUT_EVENT, handler);
  return () => window.removeEventListener(LAST_BUILD_INPUT_EVENT, handler);
}

const LAST_BUILD_MANUAL_WEIGHTS_EVENT = "idl-last-build-manual-weights-changed";
let lastBuildManualWeights: Record<string, number> | null = null;

export function setLastBuildManualWeights(w: Record<string, number> | null): void {
  if (typeof window === "undefined") return;
  lastBuildManualWeights = w && Object.keys(w).length > 0 ? { ...w } : null;
  window.dispatchEvent(
    new CustomEvent(LAST_BUILD_MANUAL_WEIGHTS_EVENT, { detail: lastBuildManualWeights }),
  );
}

export function getLastBuildManualWeights(): Record<string, number> | null {
  return lastBuildManualWeights ? { ...lastBuildManualWeights } : null;
}

export function subscribeLastBuildManualWeights(
  cb: (w: Record<string, number> | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    cb(detail ?? null);
  };
  window.addEventListener(LAST_BUILD_MANUAL_WEIGHTS_EVENT, handler);
  return () => window.removeEventListener(LAST_BUILD_MANUAL_WEIGHTS_EVENT, handler);
}

// ----------------------------------------------------------------------------
// UI preference: Build tab "Rationale & Key Risks" collapsible open/closed.
// ----------------------------------------------------------------------------
// Persisted in localStorage so a user who collapses the explainer once does
// not have to collapse it again on every rebuild or reload (Task #85).
// Default for first-time users is OPEN — only an explicit collapse flips the
// stored value to false. Stored as the literal strings "true"/"false" rather
// than JSON to keep it trivial and avoid parse failures from older values.
const RATIONALE_RISKS_OPEN_KEY = "idl.buildRationaleRisksOpen";

export function getBuildRationaleRisksOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(RATIONALE_RISKS_OPEN_KEY);
    if (raw === null) return true;
    // Anything other than the explicit "false" sentinel resolves to open so
    // a corrupted/legacy value doesn't surprise the user with a hidden block.
    return raw !== "false";
  } catch {
    return true;
  }
}

export function setBuildRationaleRisksOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RATIONALE_RISKS_OPEN_KEY, open ? "true" : "false");
  } catch {
    /* ignore quota / disabled storage */
  }
}
