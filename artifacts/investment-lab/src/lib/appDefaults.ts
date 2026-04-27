// ----------------------------------------------------------------------------
// appDefaults.ts
// ----------------------------------------------------------------------------
// Loads `src/data/app-defaults.json` and exposes a typed, validated view of
// the operator-managed global defaults. The JSON is bundled at build time —
// the frontend stays static. Per-user overrides (Methodology editor,
// localStorage) layer on top of these values, so this file represents the
// "ship-wide" defaults that apply to anyone who has not customised their
// own copy.
//
// The file may be partial (or even empty `{}`). Anything missing or
// invalid silently falls back to the in-code seed in `settings.ts` /
// `metrics.ts`. This keeps a fresh checkout of the repo working with no
// extra config and means a malformed admin PR cannot brick the engine.
// ----------------------------------------------------------------------------

import raw from "@/data/app-defaults.json";

export type AppDefaultsFile = {
  _meta?: {
    lastUpdated?: string | null;
    lastUpdatedBy?: string | null;
    comment?: string | null;
  };
  riskFreeRates?: Partial<Record<string, number>>;
  homeBias?: Partial<Record<string, number>>;
  cma?: Partial<Record<string, { expReturn?: number; vol?: number }>>;
};

// Whitelisted base-currency codes / asset keys accepted in the JSON.
// Anything outside is silently dropped on read so a typo in the admin PR
// cannot fan out into the engine as a "ghost" currency or asset. Asset
// keys mirror metrics.ts's `AssetKey` exactly.
const RF_KEYS = new Set(["USD", "EUR", "GBP", "CHF"]);
const HB_KEYS = new Set(["USD", "EUR", "GBP", "CHF"]);
const ASSET_KEYS = new Set([
  "equity_us",
  "equity_eu",
  "equity_uk",
  "equity_ch",
  "equity_jp",
  "equity_em",
  "equity_thematic",
  "bonds",
  "cash",
  "gold",
  "reits",
  "crypto",
]);

// Reasonable hard bounds matching the Methodology editor's runtime checks.
// We don't trust the JSON — even if the operator merged a PR the value
// might be a typo (e.g. 425 instead of 4.25 → 4.25 fraction).
function clampRf(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 0.2) return undefined;
  return v;
}

function clampHb(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 5) return undefined;
  return v;
}

function clampMu(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < -0.5 || v > 1) return undefined;
  return v;
}

function clampSigma(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 2) return undefined;
  return v;
}

export type SanitizedAppDefaults = {
  riskFreeRates: Record<string, number>;
  homeBias: Record<string, number>;
  cma: Record<string, { expReturn?: number; vol?: number }>;
};

export function sanitizeAppDefaults(input: unknown): SanitizedAppDefaults {
  const out: SanitizedAppDefaults = { riskFreeRates: {}, homeBias: {}, cma: {} };
  if (!input || typeof input !== "object") return out;

  const obj = input as AppDefaultsFile;

  if (obj.riskFreeRates && typeof obj.riskFreeRates === "object") {
    for (const [k, v] of Object.entries(obj.riskFreeRates)) {
      if (!RF_KEYS.has(k)) continue;
      const c = clampRf(v);
      if (c !== undefined) out.riskFreeRates[k] = c;
    }
  }

  if (obj.homeBias && typeof obj.homeBias === "object") {
    for (const [k, v] of Object.entries(obj.homeBias)) {
      if (!HB_KEYS.has(k)) continue;
      const c = clampHb(v);
      if (c !== undefined) out.homeBias[k] = c;
    }
  }

  if (obj.cma && typeof obj.cma === "object") {
    for (const [k, v] of Object.entries(obj.cma)) {
      if (!ASSET_KEYS.has(k)) continue;
      if (!v || typeof v !== "object") continue;
      const entry: { expReturn?: number; vol?: number } = {};
      const mu = clampMu((v as { expReturn?: unknown }).expReturn);
      const sg = clampSigma((v as { vol?: unknown }).vol);
      if (mu !== undefined) entry.expReturn = mu;
      if (sg !== undefined) entry.vol = sg;
      if (entry.expReturn !== undefined || entry.vol !== undefined) out.cma[k] = entry;
    }
  }

  return out;
}

// Resolved at module-load time. Consumers (settings.ts, metrics.ts, the
// Admin UI's "current values" panel) all read the same singleton so they
// never drift.
export const APP_DEFAULTS: SanitizedAppDefaults = sanitizeAppDefaults(raw);

export function getAppDefaultsMeta(): AppDefaultsFile["_meta"] {
  return (raw as AppDefaultsFile)._meta ?? {};
}
