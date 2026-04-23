import { useState, useEffect, useCallback } from "react";
import { PortfolioInput } from "./types";

const STORAGE_KEY = "investment-lab.savedScenarios.v1";

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: number;
  input: PortfolioInput;
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

export function saveScenario(name: string, input: PortfolioInput): SavedScenario {
  const newScenario: SavedScenario = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    input,
  };

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
