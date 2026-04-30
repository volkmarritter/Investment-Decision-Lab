// ----------------------------------------------------------------------------
// etfOverrides.ts
// ----------------------------------------------------------------------------
// Local, per-browser overrides of the curated ETF catalog. Stored in
// localStorage so the user's "swap this bucket's ETF" decisions survive
// page reloads but do not affect anyone else (no server roundtrip, no PR).
//
// Wired into getETFDetails() in etfs.ts: when a bucket key has an
// override, the engine returns the user's chosen ETF everywhere
// downstream (recommendations table, fee summary, Monte-Carlo cost
// basis, etc.). Resetting an override falls back to the curated catalog
// + the weekly justETF snapshot layer.
// ----------------------------------------------------------------------------

import type { ETFRecord, ExchangeCode } from "./etfs";

const KEY = "il.etfOverrides.v1";
const EVENT = "il-etf-overrides-changed";

const VALID_EXCHANGES: ExchangeCode[] = ["LSE", "XETRA", "SIX", "Euronext"];
const VALID_REPLICATION: ETFRecord["replication"][] = [
  "Physical",
  "Physical (sampled)",
  "Synthetic",
];
const VALID_DISTRIBUTION: ETFRecord["distribution"][] = [
  "Accumulating",
  "Distributing",
];

// Defensive parse: anything that doesn't look like a full ETFRecord is
// dropped silently rather than crashing the engine. The override layer
// must NEVER throw — it's read on every recommendation render.
//
// Also exported as `sanitizeETFRecord` so the file-import path
// (`portfolioFile.ts`) can reuse the same validation rules without
// duplicating the field-by-field guards.
function sanitize(raw: unknown): ETFRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name : null;
  const isin = typeof r.isin === "string" ? r.isin : null;
  const terBps = typeof r.terBps === "number" ? r.terBps : null;
  const domicile = typeof r.domicile === "string" ? r.domicile : null;
  const currency = typeof r.currency === "string" ? r.currency : null;
  const comment = typeof r.comment === "string" ? r.comment : "";

  const replication = VALID_REPLICATION.includes(
    r.replication as ETFRecord["replication"],
  )
    ? (r.replication as ETFRecord["replication"])
    : null;
  const distribution = VALID_DISTRIBUTION.includes(
    r.distribution as ETFRecord["distribution"],
  )
    ? (r.distribution as ETFRecord["distribution"])
    : null;
  const defaultExchange = VALID_EXCHANGES.includes(
    r.defaultExchange as ExchangeCode,
  )
    ? (r.defaultExchange as ExchangeCode)
    : null;

  const listings: ETFRecord["listings"] = {};
  if (r.listings && typeof r.listings === "object") {
    for (const [exch, val] of Object.entries(
      r.listings as Record<string, unknown>,
    )) {
      if (!VALID_EXCHANGES.includes(exch as ExchangeCode)) continue;
      if (val && typeof val === "object") {
        const t = (val as Record<string, unknown>).ticker;
        if (typeof t === "string" && t.length > 0) {
          listings[exch as ExchangeCode] = { ticker: t };
        }
      }
    }
  }

  if (
    name === null ||
    isin === null ||
    terBps === null ||
    domicile === null ||
    currency === null ||
    replication === null ||
    distribution === null ||
    defaultExchange === null ||
    Object.keys(listings).length === 0
  ) {
    return null;
  }

  const out: ETFRecord = {
    name,
    isin,
    terBps,
    domicile,
    replication,
    distribution,
    currency,
    comment,
    listings,
    defaultExchange,
  };
  if (typeof r.aumMillionsEUR === "number") out.aumMillionsEUR = r.aumMillionsEUR;
  if (typeof r.inceptionDate === "string") out.inceptionDate = r.inceptionDate;
  return out;
}

function readAll(): Record<string, ETFRecord> {
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
    const out: Record<string, ETFRecord> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const sane = sanitize(v);
      if (sane) out[k] = sane;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ETFRecord>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(all).length === 0) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    }
  } catch {
    // Quota / private mode — best-effort only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: all }));
}

export function getETFOverrides(): Record<string, ETFRecord> {
  return readAll();
}

// Single-key lookup used by the engine on every render — kept tiny so
// the hot path is just one localStorage get + one JSON parse.
export function getUserETFOverride(key: string): ETFRecord | null {
  const all = readAll();
  return all[key] ?? null;
}

export function setETFOverride(key: string, entry: ETFRecord): void {
  const sane = sanitize(entry);
  if (!sane) return;
  const all = readAll();
  all[key] = sane;
  writeAll(all);
}

export function clearETFOverride(key: string): void {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}

export function clearAllETFOverrides(): void {
  writeAll({});
}

/**
 * Re-export of the internal sanitiser so the file-import path
 * (`portfolioFile.ts`) can validate untrusted ETFRecord payloads using
 * exactly the same rules the localStorage layer uses.
 */
export const sanitizeETFRecord = sanitize;

/**
 * Merge the given override map into the user's existing localStorage
 * overrides. Each entry is sanitised individually; invalid entries are
 * dropped silently. Existing keys are overwritten by incoming values
 * (file import wins). The change event fires once at the end so
 * subscribers don't get N re-renders for an N-entry import.
 *
 * Returns the number of entries that were actually applied (after
 * sanitisation), so the caller can show a meaningful toast count.
 */
export function mergeETFOverrides(
  incoming: Record<string, ETFRecord>,
): number {
  if (!incoming || typeof incoming !== "object") return 0;
  const all = readAll();
  let applied = 0;
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const sane = sanitize(value);
    if (!sane) continue;
    all[key] = sane;
    applied += 1;
  }
  if (applied > 0) writeAll(all);
  return applied;
}

export function subscribeETFOverrides(
  cb: (all: Record<string, ETFRecord>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") {
      cb(detail as Record<string, ETFRecord>);
    }
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
