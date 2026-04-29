import { useState, useEffect, useCallback } from "react";
import { PortfolioInput } from "./types";
import type { ManualWeights } from "./manualWeights";
import type { ETFSlot } from "./etfSelection";

const STORAGE_KEY = "investment-lab.savedScenarios.v1";

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: number;
  input: PortfolioInput;
  /**
   * Optional snapshot of the user's custom (pinned) ETF weights at the time
   * the scenario was saved. Keyed by `${assetClass} - ${region}` (the engine's
   * `bucket` string). Older saved entries created before Task #24 do not have
   * this field; loading them produces the natural allocation, exactly as
   * before.
   */
  manualWeights?: ManualWeights;
  /**
   * Optional snapshot of the per-bucket ETF picker selections at save time
   * (a copy of getAllETFSelections() — keyed by catalog key, value is the
   * 1-based alternative slot index). Loading a scenario without this field
   * (older saves) falls back to the curated default for every bucket, so
   * they keep loading exactly as before — no migration needed.
   */
  etfSelections?: Record<string, ETFSlot>;
}

export function listSaved(): SavedScenario[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data) as SavedScenario[];
    return parsed.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error("Failed to read saved scenarios from localStorage", error);
    return [];
  }
}

export function saveScenario(
  name: string,
  input: PortfolioInput,
  manualWeights?: ManualWeights,
  etfSelections?: Record<string, ETFSlot>,
): SavedScenario {
  const newScenario: SavedScenario = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    input,
  };
  // Only attach the snapshot when the user actually has custom weights pinned;
  // a clean save stays clean and behaves identically to pre-Task-#24 entries.
  if (manualWeights && Object.keys(manualWeights).length > 0) {
    newScenario.manualWeights = { ...manualWeights };
  }
  // Picker snapshot is also additive: only persisted when the user has any
  // non-default selections, so older save records and clean states stay
  // structurally identical.
  if (etfSelections && Object.keys(etfSelections).length > 0) {
    newScenario.etfSelections = { ...etfSelections };
  }

  try {
    const existing = listSaved();
    const updated = [newScenario, ...existing];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("savedScenariosChanged"));
  } catch (error) {
    console.error("Failed to save scenario to localStorage", error);
  }

  return newScenario;
}

export function deleteScenario(id: string): void {
  try {
    const existing = listSaved();
    const updated = existing.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("savedScenariosChanged"));
  } catch (error) {
    console.error("Failed to delete scenario from localStorage", error);
  }
}

export function renameScenario(id: string, name: string): void {
  try {
    const existing = listSaved();
    const updated = existing.map((s) => (s.id === id ? { ...s, name } : s));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("savedScenariosChanged"));
  } catch (error) {
    console.error("Failed to rename scenario in localStorage", error);
  }
}

export function useSavedScenarios() {
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);

  const refresh = useCallback(() => {
    setScenarios(listSaved());
  }, []);

  useEffect(() => {
    refresh();

    const handleStorageChange = (e: Event) => {
      if (e.type === "storage" || e.type === "savedScenariosChanged") {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("savedScenariosChanged", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("savedScenariosChanged", handleStorageChange);
    };
  }, [refresh]);

  return { scenarios, refresh };
}
