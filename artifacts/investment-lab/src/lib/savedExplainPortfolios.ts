import { useCallback, useEffect, useState } from "react";
import type { BaseCurrency, RiskAppetite } from "./types";
import type { PersonalPosition } from "./personalPortfolio";

const STORAGE_KEY = "investment-lab.savedExplainPortfolios.v1";
const CHANGE_EVENT = "savedExplainPortfoliosChanged";

/**
 * The full Explain-tab workspace snapshot, mirrored from the localStorage
 * shape persisted under "investment-lab.explainPortfolio.v1". Saved
 * portfolios wrap one of these so a user can keep multiple named "real
 * holdings" workspaces in parallel — e.g. current allocation, a
 * "what-if" rebalance, an old portfolio for comparison — independently of
 * Build's scenario slot store.
 */
export interface ExplainWorkspace {
  v: 1;
  baseCurrency: BaseCurrency;
  riskAppetite: RiskAppetite;
  horizon: number;
  hedged: boolean;
  lookThroughView: boolean;
  positions: PersonalPosition[];
}

export interface SavedExplainPortfolio {
  id: string;
  name: string;
  createdAt: number;
  workspace: ExplainWorkspace;
}

const VALID_CURRENCIES: BaseCurrency[] = ["USD", "EUR", "CHF", "GBP"];
const VALID_RISK: RiskAppetite[] = ["Low", "Moderate", "High", "Very High"];

function isPosition(p: unknown): p is PersonalPosition {
  if (!p || typeof p !== "object") return false;
  const pp = p as Record<string, unknown>;
  return (
    typeof pp.isin === "string" &&
    typeof pp.bucketKey === "string" &&
    typeof pp.weight === "number"
  );
}

function sanitizeWorkspace(raw: unknown): ExplainWorkspace | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (w.v !== 1) return null;
  const baseCurrency = VALID_CURRENCIES.includes(w.baseCurrency as BaseCurrency)
    ? (w.baseCurrency as BaseCurrency)
    : "USD";
  const riskAppetite = VALID_RISK.includes(w.riskAppetite as RiskAppetite)
    ? (w.riskAppetite as RiskAppetite)
    : "Moderate";
  const horizon = Number.isFinite(w.horizon)
    ? Math.max(1, Math.min(40, Math.floor(w.horizon as number)))
    : 10;
  const positions = Array.isArray(w.positions)
    ? (w.positions as unknown[]).filter(isPosition).map((p) => {
        const pos = p as PersonalPosition;
        const out: PersonalPosition = {
          isin: pos.isin,
          bucketKey: pos.bucketKey,
          weight: pos.weight,
        };
        if (
          pos.manualMeta &&
          typeof pos.manualMeta === "object" &&
          typeof pos.manualMeta.assetClass === "string" &&
          typeof pos.manualMeta.region === "string"
        ) {
          out.manualMeta = {
            assetClass: pos.manualMeta.assetClass,
            region: pos.manualMeta.region,
            ...(typeof pos.manualMeta.name === "string"
              ? { name: pos.manualMeta.name }
              : {}),
            ...(typeof pos.manualMeta.currency === "string"
              ? { currency: pos.manualMeta.currency }
              : {}),
            ...(typeof pos.manualMeta.terBps === "number"
              ? { terBps: pos.manualMeta.terBps }
              : {}),
          };
        }
        return out;
      })
    : [];
  return {
    v: 1,
    baseCurrency,
    riskAppetite,
    horizon,
    hedged: !!w.hedged,
    lookThroughView: w.lookThroughView !== false,
    positions,
  };
}

function isSavedExplain(raw: unknown): raw is SavedExplainPortfolio {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return false;
  if (typeof r.createdAt !== "number") return false;
  return sanitizeWorkspace(r.workspace) !== null;
}

export function listSavedExplainPortfolios(): SavedExplainPortfolio[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned: SavedExplainPortfolio[] = [];
    for (const item of parsed) {
      if (!isSavedExplain(item)) continue;
      const workspace = sanitizeWorkspace(item.workspace);
      if (!workspace) continue;
      cleaned.push({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
        workspace,
      });
    }
    return cleaned.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error("Failed to read saved Explain portfolios", error);
    return [];
  }
}

function persistAll(items: SavedExplainPortfolio[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (error) {
    console.error("Failed to persist saved Explain portfolios", error);
  }
}

export function saveExplainPortfolio(
  name: string,
  workspace: ExplainWorkspace,
): SavedExplainPortfolio {
  const cleaned = sanitizeWorkspace(workspace) ?? workspace;
  const entry: SavedExplainPortfolio = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    workspace: cleaned,
  };
  const updated = [entry, ...listSavedExplainPortfolios()];
  persistAll(updated);
  return entry;
}

export function deleteSavedExplainPortfolio(id: string): void {
  const updated = listSavedExplainPortfolios().filter((s) => s.id !== id);
  persistAll(updated);
}

export function renameSavedExplainPortfolio(id: string, name: string): void {
  const updated = listSavedExplainPortfolios().map((s) =>
    s.id === id ? { ...s, name } : s,
  );
  persistAll(updated);
}

export function useSavedExplainPortfolios() {
  const [portfolios, setPortfolios] = useState<SavedExplainPortfolio[]>([]);

  const refresh = useCallback(() => {
    setPortfolios(listSavedExplainPortfolios());
  }, []);

  useEffect(() => {
    refresh();
    const handler = (e: Event) => {
      if (e.type === "storage" || e.type === CHANGE_EVENT) refresh();
    };
    window.addEventListener("storage", handler);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(CHANGE_EVENT, handler);
    };
  }, [refresh]);

  return { portfolios, refresh };
}
