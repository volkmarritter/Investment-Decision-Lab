// ----------------------------------------------------------------------------
// etfSelection.ts
// ----------------------------------------------------------------------------
// Per-bucket ETF picker state.
//
// The curated catalog (lib/etfs.ts) exposes 1 default ETF + up to
// MAX_ALTERNATIVES_PER_BUCKET alternatives for selected major buckets
// (Equity-Global, Equity-USA, Equity-Europe, Equity-EM,
// FixedIncome-Global, Commodities-Gold). The user can switch a bucket
// to an alternative via a small dropdown in the ETF Implementation
// table on the Build tab.
//
// Selections are stored in localStorage so they survive page reloads
// without server state. Storage shape: Record<catalogKey, slotIndex>
// where slotIndex is an integer in [1, MAX_ALTERNATIVES_PER_BUCKET].
// Slot 0 is the default and is never persisted — its absence is the
// signal "use the default", and clearing a key removes the entry
// entirely. This keeps the storage blob small and means the very first
// render after a fresh checkout sees no slots set, exactly the same as
// a clean state.
//
// Cross-component coordination uses a CustomEvent so the BuildPortfolio
// rebuild effect can react to picker changes without prop-drilling.
// Mirrors the etfOverrides.ts pattern (same in-tab event broadcast).
//
// Resolution precedence in lib/etfs.ts:
//   1. Methodology override → fully replaces alternatives panel
//   2. THIS module's selection → picks among curated alternatives
//   3. Curated default
// See getETFDetails() for the exact wiring.
// ----------------------------------------------------------------------------

import { MAX_ALTERNATIVES_PER_BUCKET } from "./etfs";

const KEY = "il.etfSelection.v1";
const EVENT = "il-etf-selection-changed";

// Slot index in [0, MAX_ALTERNATIVES_PER_BUCKET]. 0 is the default and
// never gets persisted; 1..N point at alternatives[N-1]. Typed loosely
// as `number` rather than a literal union because the upper bound is
// data-driven (cap can grow without TS-type churn across the codebase).
export type ETFSlot = number;

// Defensive parse: every value must be a positive integer no larger
// than MAX_ALTERNATIVES_PER_BUCKET. Anything else (legacy values, JSON
// corruption, hand-edits, slot 0 written by older code, slots beyond
// today's cap) is dropped silently — slot 0 is the implicit default
// and has no business being persisted, and out-of-range slots would
// just be clamped back to the cap on read by clampSlot() anyway.
function readAll(): Record<string, ETFSlot> {
  if (typeof window === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ETFSlot> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        v >= 1 &&
        v <= MAX_ALTERNATIVES_PER_BUCKET
      ) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ETFSlot>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(all).length === 0) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    }
  } catch {
    // Quota / private mode — best-effort only, mirrors etfOverrides.ts.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: all }));
}

// Single-key lookup — kept tiny since it's called once per bucket on
// every getETFDetails() invocation (i.e. on every render of the ETF
// Implementation table and every dependent metric). Returns 0 (the
// implicit default) when nothing is stored.
export function getETFSelection(key: string): ETFSlot {
  if (typeof window === "undefined") return 0;
  const all = readAll();
  return all[key] ?? 0;
}

export function getAllETFSelections(): Record<string, ETFSlot> {
  return readAll();
}

// Setting slot 0 is equivalent to clearing the override (back to
// default). Doing so via setETFSelection(key, 0) keeps the call sites
// simpler than asking them to branch on slot===0.
export function setETFSelection(key: string, slot: ETFSlot): void {
  const all = readAll();
  if (slot === 0) {
    if (!(key in all)) return;
    delete all[key];
  } else {
    all[key] = slot;
  }
  writeAll(all);
}

export function clearETFSelection(key: string): void {
  setETFSelection(key, 0);
}

export function clearAllETFSelections(): void {
  writeAll({});
}

export function subscribeETFSelections(
  cb: (all: Record<string, ETFSlot>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") {
      cb(detail as Record<string, ETFSlot>);
    }
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
