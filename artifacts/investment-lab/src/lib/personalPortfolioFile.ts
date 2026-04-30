// ----------------------------------------------------------------------------
// personalPortfolioFile.ts
// ----------------------------------------------------------------------------
// File-based export/import of saved Explain (personal) portfolios.
//
// Mirrors `portfolioFile.ts` but for the Explain workspace shape
// (`SavedExplainPortfolio` / `ExplainWorkspace`). The two file formats are
// kept on separate `format` identifiers so a Build scenario file can never
// be silently misinterpreted as a personal portfolio (or vice-versa) — the
// payloads are structurally different and would crash a half-loaded UI.
//
// Wire format (v1):
//   {
//     "format": "investment-decision-lab.personal-portfolio",
//     "schemaVersion": 1,
//     "app": "Investment Decision Lab",
//     "exportedAt": "2026-04-30T10:00:00.000Z",
//     "portfolio": <SavedExplainPortfolio>
//   }
//
// Validation here intentionally re-uses `sanitizeWorkspace` from
// `savedExplainPortfolios.ts` as the structural normaliser, but adds
// strict up-front type checks so genuinely malformed files are rejected
// with a friendly reason rather than silently coerced into defaults
// (which is what the localStorage reader does — fine for stale local
// state, wrong for user-supplied imports).
// ----------------------------------------------------------------------------

import type { BaseCurrency, RiskAppetite } from "./types";
import type { PersonalPosition } from "./personalPortfolio";
import {
  type ExplainWorkspace,
  type SavedExplainPortfolio,
} from "./savedExplainPortfolios";

export const PERSONAL_PORTFOLIO_FILE_FORMAT =
  "investment-decision-lab.personal-portfolio";
export const PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION = 1;
export const PERSONAL_PORTFOLIO_FILE_APP = "Investment Decision Lab";

export interface PersonalPortfolioFileV1 {
  format: typeof PERSONAL_PORTFOLIO_FILE_FORMAT;
  schemaVersion: number;
  app: string;
  exportedAt: string;
  portfolio: SavedExplainPortfolio;
}

export type PersonalImportErrorReason =
  | "invalid-json"
  | "wrong-format"
  | "future-version"
  | "missing-fields";

export interface PersonalImportError {
  reason: PersonalImportErrorReason;
}

export type PersonalImportResult =
  | { ok: true; portfolio: SavedExplainPortfolio }
  | { ok: false; error: PersonalImportError };

const VALID_BASE_CURRENCIES: ReadonlyArray<BaseCurrency> = [
  "USD",
  "EUR",
  "CHF",
  "GBP",
];
const VALID_RISK_APPETITES: ReadonlyArray<RiskAppetite> = [
  "Low",
  "Moderate",
  "High",
  "Very High",
];

function isStrictPosition(v: unknown): v is PersonalPosition {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  if (typeof p.isin !== "string") return false;
  if (typeof p.bucketKey !== "string") return false;
  if (typeof p.weight !== "number" || !Number.isFinite(p.weight)) return false;
  if (p.manualMeta !== undefined) {
    if (!p.manualMeta || typeof p.manualMeta !== "object") return false;
    const mm = p.manualMeta as Record<string, unknown>;
    if (typeof mm.assetClass !== "string") return false;
    if (typeof mm.region !== "string") return false;
    if (mm.name !== undefined && typeof mm.name !== "string") return false;
    if (mm.currency !== undefined && typeof mm.currency !== "string") return false;
    if (
      mm.terBps !== undefined &&
      (typeof mm.terBps !== "number" || !Number.isFinite(mm.terBps))
    ) {
      return false;
    }
  }
  return true;
}

function isStrictWorkspace(v: unknown): v is ExplainWorkspace {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  if (w.v !== 1) return false;
  if (
    typeof w.baseCurrency !== "string" ||
    !(VALID_BASE_CURRENCIES as ReadonlyArray<string>).includes(w.baseCurrency)
  ) {
    return false;
  }
  if (
    typeof w.riskAppetite !== "string" ||
    !(VALID_RISK_APPETITES as ReadonlyArray<string>).includes(w.riskAppetite)
  ) {
    return false;
  }
  if (typeof w.horizon !== "number" || !Number.isFinite(w.horizon)) {
    return false;
  }
  if (typeof w.hedged !== "boolean") return false;
  if (typeof w.lookThroughView !== "boolean") return false;
  if (!Array.isArray(w.positions)) return false;
  for (const p of w.positions) {
    if (!isStrictPosition(p)) return false;
  }
  return true;
}

/** Strip filesystem-unfriendly characters from a portfolio name. */
function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "personal-portfolio";
}

export function buildPersonalPortfolioFilename(name?: string): string {
  if (name && name.trim()) {
    return `investment-lab-personal-portfolio-${sanitizeFilename(name)}.json`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `investment-lab-personal-portfolio-${today}.json`;
}

/**
 * Build a `SavedExplainPortfolio` from the live workspace + a chosen name.
 * Used by the export-current-state path so the UI doesn't have to reach
 * into `saveExplainPortfolio` (which would also push to localStorage).
 */
export function buildPersonalPortfolioForExport(
  name: string,
  workspace: ExplainWorkspace,
): SavedExplainPortfolio {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`,
    name,
    createdAt: Date.now(),
    workspace: {
      ...workspace,
      positions: workspace.positions.map((p) => ({
        ...p,
        ...(p.manualMeta ? { manualMeta: { ...p.manualMeta } } : {}),
      })),
    },
  };
}

export function serializePersonalPortfolioFile(
  portfolio: SavedExplainPortfolio,
): PersonalPortfolioFileV1 {
  return {
    format: PERSONAL_PORTFOLIO_FILE_FORMAT,
    schemaVersion: PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION,
    app: PERSONAL_PORTFOLIO_FILE_APP,
    exportedAt: new Date().toISOString(),
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      createdAt: portfolio.createdAt,
      workspace: {
        ...portfolio.workspace,
        positions: portfolio.workspace.positions.map((p) => ({
          ...p,
          ...(p.manualMeta ? { manualMeta: { ...p.manualMeta } } : {}),
        })),
      },
    },
  };
}

/**
 * Trigger a browser download of the given personal portfolio as a JSON
 * file. Returns the filename used so the caller can reference it in a
 * toast.
 */
export function downloadPersonalPortfolioAsFile(
  portfolio: SavedExplainPortfolio,
): string {
  const wrapper = serializePersonalPortfolioFile(portfolio);
  const filename = buildPersonalPortfolioFilename(portfolio.name);
  const blob = new Blob([JSON.stringify(wrapper, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Parse a raw file string into a `SavedExplainPortfolio`. Validates the
 * wrapper, the workspace shape, and each position individually. Files
 * that pass shape validation but carry weights that don't sum to 100%
 * are still accepted — the user can fine-tune after loading, just like
 * an in-progress session restored from localStorage.
 */
export function parsePersonalPortfolioFile(raw: string): PersonalImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: { reason: "invalid-json" } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: { reason: "wrong-format" } };
  }
  const o = parsed as Record<string, unknown>;
  if (o.format !== PERSONAL_PORTFOLIO_FILE_FORMAT) {
    return { ok: false, error: { reason: "wrong-format" } };
  }
  if (typeof o.app !== "string" || o.app !== PERSONAL_PORTFOLIO_FILE_APP) {
    return { ok: false, error: { reason: "wrong-format" } };
  }
  if (typeof o.schemaVersion !== "number" || !Number.isFinite(o.schemaVersion)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (o.schemaVersion > PERSONAL_PORTFOLIO_FILE_SCHEMA_VERSION) {
    return { ok: false, error: { reason: "future-version" } };
  }
  const pf = o.portfolio;
  if (!pf || typeof pf !== "object" || Array.isArray(pf)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  const p = pf as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (!isStrictWorkspace(p.workspace)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }

  const workspace = p.workspace as ExplainWorkspace;
  const horizon = Math.max(1, Math.min(40, Math.floor(workspace.horizon)));

  const portfolio: SavedExplainPortfolio = {
    id:
      typeof p.id === "string" && p.id
        ? p.id
        : typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`,
    name: p.name.trim(),
    createdAt:
      typeof p.createdAt === "number" && Number.isFinite(p.createdAt)
        ? p.createdAt
        : Date.now(),
    workspace: {
      v: 1,
      baseCurrency: workspace.baseCurrency,
      riskAppetite: workspace.riskAppetite,
      horizon,
      hedged: workspace.hedged,
      lookThroughView: workspace.lookThroughView,
      positions: workspace.positions.map((pos) => ({
        ...pos,
        ...(pos.manualMeta ? { manualMeta: { ...pos.manualMeta } } : {}),
      })),
    },
  };

  return { ok: true, portfolio };
}

/** Read a `File` object via the FileReader API. */
export function readPersonalPortfolioFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("File reader returned non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File reader error"));
    reader.readAsText(file);
  });
}
