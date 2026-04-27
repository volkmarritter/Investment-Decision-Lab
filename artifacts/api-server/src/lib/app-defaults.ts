// ----------------------------------------------------------------------------
// app-defaults.ts (api-server)
// ----------------------------------------------------------------------------
// Validation + file-shape helpers for the operator-managed global defaults
// that ship with the investment-lab bundle (`src/data/app-defaults.json`).
// The /admin pane edits these via a GitHub PR; after merge + redeploy every
// user picks up the new values. Per-user localStorage overrides from the
// Methodology editor still layer on top in the frontend.
//
// The validator is STRICT (unlike the frontend's silent sanitiser) — when
// an admin submits new defaults we want to surface bad input loudly so it
// never reaches a PR. Bounds intentionally match the Methodology editor
// and the frontend's appDefaults.ts sanitiser.
// ----------------------------------------------------------------------------

export const RF_CURRENCIES = ["USD", "EUR", "GBP", "CHF"] as const;
export const HB_CURRENCIES = ["USD", "EUR", "GBP", "CHF"] as const;

export const ASSET_KEYS = [
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
] as const;

export type RfCurrency = (typeof RF_CURRENCIES)[number];
export type HbCurrency = (typeof HB_CURRENCIES)[number];
export type AssetKey = (typeof ASSET_KEYS)[number];

export interface AppDefaultsMeta {
  lastUpdated?: string | null;
  lastUpdatedBy?: string | null;
  comment?: string | null;
}

export interface AppDefaults {
  _meta?: AppDefaultsMeta;
  riskFreeRates?: Partial<Record<RfCurrency, number>>;
  homeBias?: Partial<Record<HbCurrency, number>>;
  cma?: Partial<Record<AssetKey, { expReturn?: number; vol?: number }>>;
}

const RF_SET = new Set<string>(RF_CURRENCIES);
const HB_SET = new Set<string>(HB_CURRENCIES);
const ASSET_SET = new Set<string>(ASSET_KEYS);

const RF_MIN = 0;
const RF_MAX = 0.2;
const HB_MIN = 0;
const HB_MAX = 5;
const MU_MIN = -0.5;
const MU_MAX = 1;
const SIGMA_MIN = 0;
const SIGMA_MAX = 2;

export interface ValidationOk {
  ok: true;
  value: AppDefaults;
}
export interface ValidationErr {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkNumber(
  v: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${path}: must be a finite number, got ${describe(v)}`);
    return undefined;
  }
  if (v < min || v > max) {
    errors.push(`${path}: must be in [${min}, ${max}], got ${v}`);
    return undefined;
  }
  return v;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function validateAppDefaults(input: unknown): ValidationResult {
  const errors: string[] = [];
  const out: AppDefaults = {};

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["payload must be a JSON object"] };
  }

  // _meta — purely informational, accept liberal shapes but coerce types.
  if (input._meta !== undefined) {
    if (!isPlainObject(input._meta)) {
      errors.push("_meta: must be an object");
    } else {
      const meta: AppDefaultsMeta = {};
      const m = input._meta;
      if (m.lastUpdated !== undefined && m.lastUpdated !== null) {
        if (typeof m.lastUpdated !== "string") {
          errors.push("_meta.lastUpdated: must be a string or null");
        } else {
          meta.lastUpdated = m.lastUpdated;
        }
      }
      if (m.lastUpdatedBy !== undefined && m.lastUpdatedBy !== null) {
        if (typeof m.lastUpdatedBy !== "string") {
          errors.push("_meta.lastUpdatedBy: must be a string or null");
        } else {
          meta.lastUpdatedBy = m.lastUpdatedBy;
        }
      }
      if (m.comment !== undefined && m.comment !== null) {
        if (typeof m.comment !== "string") {
          errors.push("_meta.comment: must be a string or null");
        } else {
          meta.comment = m.comment;
        }
      }
      out._meta = meta;
    }
  }

  if (input.riskFreeRates !== undefined) {
    if (!isPlainObject(input.riskFreeRates)) {
      errors.push("riskFreeRates: must be an object");
    } else {
      const rf: Partial<Record<RfCurrency, number>> = {};
      for (const [k, v] of Object.entries(input.riskFreeRates)) {
        if (!RF_SET.has(k)) {
          errors.push(`riskFreeRates.${k}: unknown currency`);
          continue;
        }
        const n = checkNumber(v, RF_MIN, RF_MAX, `riskFreeRates.${k}`, errors);
        if (n !== undefined) rf[k as RfCurrency] = n;
      }
      out.riskFreeRates = rf;
    }
  }

  if (input.homeBias !== undefined) {
    if (!isPlainObject(input.homeBias)) {
      errors.push("homeBias: must be an object");
    } else {
      const hb: Partial<Record<HbCurrency, number>> = {};
      for (const [k, v] of Object.entries(input.homeBias)) {
        if (!HB_SET.has(k)) {
          errors.push(`homeBias.${k}: unknown currency`);
          continue;
        }
        const n = checkNumber(v, HB_MIN, HB_MAX, `homeBias.${k}`, errors);
        if (n !== undefined) hb[k as HbCurrency] = n;
      }
      out.homeBias = hb;
    }
  }

  if (input.cma !== undefined) {
    if (!isPlainObject(input.cma)) {
      errors.push("cma: must be an object");
    } else {
      const cma: Partial<Record<AssetKey, { expReturn?: number; vol?: number }>> = {};
      for (const [k, v] of Object.entries(input.cma)) {
        if (!ASSET_SET.has(k)) {
          errors.push(`cma.${k}: unknown asset key`);
          continue;
        }
        if (!isPlainObject(v)) {
          errors.push(`cma.${k}: must be an object`);
          continue;
        }
        const entry: { expReturn?: number; vol?: number } = {};
        if (v.expReturn !== undefined && v.expReturn !== null) {
          const n = checkNumber(v.expReturn, MU_MIN, MU_MAX, `cma.${k}.expReturn`, errors);
          if (n !== undefined) entry.expReturn = n;
        }
        if (v.vol !== undefined && v.vol !== null) {
          const n = checkNumber(v.vol, SIGMA_MIN, SIGMA_MAX, `cma.${k}.vol`, errors);
          if (n !== undefined) entry.vol = n;
        }
        if (entry.expReturn !== undefined || entry.vol !== undefined) {
          cma[k as AssetKey] = entry;
        }
      }
      out.cma = cma;
    }
  }

  // Reject unknown top-level keys so a typo can't silently disappear into
  // the JSON file and confuse a future reader of the diff.
  const ALLOWED_TOP = new Set(["_meta", "riskFreeRates", "homeBias", "cma"]);
  for (const k of Object.keys(input)) {
    if (!ALLOWED_TOP.has(k)) {
      errors.push(`unknown top-level key: ${k}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

// Produce the JSON string we will commit. Keeps the same human-friendly
// layout (2-space indent + trailing newline) as the existing data files.
export function renderAppDefaultsFile(value: AppDefaults): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// Stamps the _meta block immediately before commit so the PR diff makes
// the audit trail obvious. Caller passes the operator label (defaults to
// "admin"); date is UTC YYYY-MM-DD.
export function stampMeta(value: AppDefaults, by: string | null = null): AppDefaults {
  const today = new Date().toISOString().slice(0, 10);
  const prevComment = value._meta?.comment ?? null;
  return {
    ...value,
    _meta: {
      lastUpdated: today,
      lastUpdatedBy: by ?? "admin",
      comment: prevComment,
    },
  };
}
