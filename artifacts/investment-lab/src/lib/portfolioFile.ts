// ----------------------------------------------------------------------------
// portfolioFile.ts
// ----------------------------------------------------------------------------
// File-based export/import of saved portfolios.
//
// The wrapper around `SavedScenario` carries a stable format identifier, a
// schema version, the app name and an export timestamp so a third-party JSON
// file can be rejected cleanly with a friendly error and a future schema bump
// can be detected without crashing the parser.
//
// Wire format (v1):
//   {
//     "format": "investment-decision-lab.portfolio",
//     "schemaVersion": 1,
//     "app": "Investment Decision Lab",
//     "exportedAt": "2026-04-30T10:00:00.000Z",
//     "scenario": <SavedScenario>          // same shape as localStorage entries
//   }
//
// Validation here intentionally re-uses `runValidation` from lib/validation.ts
// — the engine already runs the same checks on Generate, so an imported file
// that the engine would reject is rejected up-front instead of producing
// a half-loaded UI state.
// ----------------------------------------------------------------------------

import type { PortfolioInput, BaseCurrency, RiskAppetite, PreferredExchange, ThematicPreference } from "./types";
import type { SavedScenario } from "./savedScenarios";
import type { ManualWeights } from "./manualWeights";
import type { ETFSlot } from "./etfSelection";
import { runValidation } from "./validation";
import { MAX_ALTERNATIVES_PER_BUCKET } from "./etfs";

export const PORTFOLIO_FILE_FORMAT = "investment-decision-lab.portfolio";
export const PORTFOLIO_FILE_SCHEMA_VERSION = 1;
export const PORTFOLIO_FILE_APP = "Investment Decision Lab";

export interface PortfolioFileV1 {
  format: typeof PORTFOLIO_FILE_FORMAT;
  schemaVersion: number;
  app: string;
  exportedAt: string;
  scenario: SavedScenario;
}

export type ImportErrorReason =
  | "invalid-json"
  | "wrong-format"
  | "future-version"
  | "missing-fields"
  | "invalid-input";

export interface ImportError {
  reason: ImportErrorReason;
  /** Optional engine-level message when reason === "invalid-input". */
  detail?: string;
}

export type ImportResult =
  | { ok: true; scenario: SavedScenario }
  | { ok: false; error: ImportError };

const VALID_BASE_CURRENCIES: ReadonlyArray<BaseCurrency> = ["USD", "EUR", "CHF", "GBP"];
const VALID_RISK_APPETITES: ReadonlyArray<RiskAppetite> = ["Low", "Moderate", "High", "Very High"];
const VALID_EXCHANGES: ReadonlyArray<PreferredExchange> = ["None", "LSE", "XETRA", "SIX"];
const VALID_THEMATICS: ReadonlyArray<ThematicPreference> = ["None", "Technology", "Healthcare", "Sustainability", "Cybersecurity"];

function isPortfolioInput(v: unknown): v is PortfolioInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.baseCurrency === "string" &&
    (VALID_BASE_CURRENCIES as ReadonlyArray<string>).includes(o.baseCurrency) &&
    typeof o.riskAppetite === "string" &&
    (VALID_RISK_APPETITES as ReadonlyArray<string>).includes(o.riskAppetite) &&
    typeof o.horizon === "number" &&
    Number.isFinite(o.horizon) &&
    typeof o.targetEquityPct === "number" &&
    Number.isFinite(o.targetEquityPct) &&
    typeof o.numETFs === "number" &&
    Number.isFinite(o.numETFs) &&
    typeof o.preferredExchange === "string" &&
    (VALID_EXCHANGES as ReadonlyArray<string>).includes(o.preferredExchange) &&
    typeof o.thematicPreference === "string" &&
    (VALID_THEMATICS as ReadonlyArray<string>).includes(o.thematicPreference) &&
    typeof o.includeCurrencyHedging === "boolean" &&
    typeof o.includeSyntheticETFs === "boolean" &&
    typeof o.includeCrypto === "boolean" &&
    typeof o.includeListedRealEstate === "boolean" &&
    typeof o.includeCommodities === "boolean"
  );
}

function isManualWeights(v: unknown): v is ManualWeights {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const [, w] of Object.entries(v as Record<string, unknown>)) {
    if (typeof w !== "number" || !Number.isFinite(w)) return false;
  }
  return true;
}

function isEtfSelections(v: unknown): v is Record<string, ETFSlot> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const [, slot] of Object.entries(v as Record<string, unknown>)) {
    if (
      typeof slot !== "number" ||
      !Number.isInteger(slot) ||
      slot < 1 ||
      slot > MAX_ALTERNATIVES_PER_BUCKET
    ) {
      return false;
    }
  }
  return true;
}

/** Strip filesystem-unfriendly characters from a scenario name. */
function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "portfolio";
}

export function buildPortfolioFilename(scenarioName?: string): string {
  if (scenarioName && scenarioName.trim()) {
    return `investment-lab-portfolio-${sanitizeFilename(scenarioName)}.json`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `investment-lab-portfolio-${today}.json`;
}

/**
 * Serialise a `SavedScenario` into the wrapper format. Used by all three
 * call-sites (Build current state, Compare slot state, existing saved row).
 */
export function serializePortfolioFile(scenario: SavedScenario): PortfolioFileV1 {
  const wrapper: PortfolioFileV1 = {
    format: PORTFOLIO_FILE_FORMAT,
    schemaVersion: PORTFOLIO_FILE_SCHEMA_VERSION,
    app: PORTFOLIO_FILE_APP,
    exportedAt: new Date().toISOString(),
    scenario: {
      id: scenario.id,
      name: scenario.name,
      createdAt: scenario.createdAt,
      input: { ...scenario.input },
    },
  };
  if (scenario.manualWeights && Object.keys(scenario.manualWeights).length > 0) {
    wrapper.scenario.manualWeights = { ...scenario.manualWeights };
  }
  if (scenario.etfSelections && Object.keys(scenario.etfSelections).length > 0) {
    wrapper.scenario.etfSelections = { ...scenario.etfSelections };
  }
  return wrapper;
}

/** Convenience: build a `SavedScenario` from any of the three contexts. */
export function buildScenarioForExport(
  name: string,
  input: PortfolioInput,
  manualWeights?: ManualWeights,
  etfSelections?: Record<string, ETFSlot>,
): SavedScenario {
  const scenario: SavedScenario = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
    name,
    createdAt: Date.now(),
    input: { ...input },
  };
  if (manualWeights && Object.keys(manualWeights).length > 0) {
    scenario.manualWeights = { ...manualWeights };
  }
  if (etfSelections && Object.keys(etfSelections).length > 0) {
    scenario.etfSelections = { ...etfSelections };
  }
  return scenario;
}

/**
 * Trigger a browser download of the given scenario as a JSON file. Returns
 * the filename used so the caller can reference it in a toast if needed.
 */
export function downloadScenarioAsFile(scenario: SavedScenario): string {
  const wrapper = serializePortfolioFile(scenario);
  const filename = buildPortfolioFilename(scenario.name);
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
  // Defer the revoke so the browser can finish initiating the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Parse a raw file string into a `SavedScenario`. The wrapper, format, and
 * scenario payload are validated up-front; the engine's `runValidation` is
 * then run on the input so a file the engine would reject (e.g. equity ETFs
 * out of range, horizon = 0) is rejected here too.
 */
export function parsePortfolioFile(raw: string): ImportResult {
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
  if (o.format !== PORTFOLIO_FILE_FORMAT) {
    return { ok: false, error: { reason: "wrong-format" } };
  }
  // The wrapper carries an explicit app name so a file produced by an
  // unrelated tool that happens to reuse the same `format` string can still
  // be rejected cleanly. Mismatch is treated as a wrong-format error so the
  // user sees the same friendly "not a valid Investment Decision Lab
  // portfolio" toast.
  if (typeof o.app !== "string" || o.app !== PORTFOLIO_FILE_APP) {
    return { ok: false, error: { reason: "wrong-format" } };
  }
  if (typeof o.schemaVersion !== "number" || !Number.isFinite(o.schemaVersion)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (o.schemaVersion > PORTFOLIO_FILE_SCHEMA_VERSION) {
    return { ok: false, error: { reason: "future-version" } };
  }
  const sc = o.scenario;
  if (!sc || typeof sc !== "object" || Array.isArray(sc)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  const s = sc as Record<string, unknown>;
  if (typeof s.name !== "string" || s.name.trim().length === 0) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (!isPortfolioInput(s.input)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (s.manualWeights !== undefined && !isManualWeights(s.manualWeights)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }
  if (s.etfSelections !== undefined && !isEtfSelections(s.etfSelections)) {
    return { ok: false, error: { reason: "missing-fields" } };
  }

  const input = s.input as PortfolioInput;
  // Reuse the same engine-side validation. If the engine would reject the
  // input on Generate, reject the file too with the first error message so
  // the user sees a meaningful explanation in the toast detail.
  const validation = runValidation({
    ...input,
    // lookThroughView and numETFsMin are optional in older saves — fill in
    // the same defaults the engine uses elsewhere so validation can run.
    lookThroughView: input.lookThroughView ?? true,
    numETFsMin: input.numETFsMin ?? input.numETFs,
  });
  if (!validation.isValid) {
    return {
      ok: false,
      error: {
        reason: "invalid-input",
        detail: validation.errors[0]?.message,
      },
    };
  }

  const scenario: SavedScenario = {
    id: typeof s.id === "string" && s.id ? s.id : (
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`
    ),
    name: s.name.trim(),
    createdAt: typeof s.createdAt === "number" && Number.isFinite(s.createdAt) ? s.createdAt : Date.now(),
    input: { ...input },
  };
  if (s.manualWeights && Object.keys(s.manualWeights as object).length > 0) {
    scenario.manualWeights = { ...(s.manualWeights as ManualWeights) };
  }
  if (s.etfSelections && Object.keys(s.etfSelections as object).length > 0) {
    scenario.etfSelections = { ...(s.etfSelections as Record<string, ETFSlot>) };
  }
  return { ok: true, scenario };
}

/** Read a `File` object via the FileReader API. */
export function readFileAsText(file: File): Promise<string> {
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
