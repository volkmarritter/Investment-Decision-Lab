/**
 * Single source of truth for the deck's portfolio data.
 *
 * Resolution order at module load:
 *  1. Live snapshot from `localStorage[SNAPSHOT_STORAGE_KEY]` — written by the
 *     Investment Decision Lab's Build tab when the user clicks "Open as
 *     slides". Validated with the Zod schema; rejected silently on mismatch.
 *  2. Curated `defaultReportData` fallback so the deck remains demoable
 *     standalone (and so the visual editor / PPTX export keep working).
 *
 * Slides import the same named exports (meta, profile, keyMetrics, …) so
 * none of them need to know about snapshot loading.
 */

import { defaultReportData } from "./defaultReportData";
import {
  ReportSnapshotSchema,
  SNAPSHOT_STORAGE_KEY,
  type ReportSnapshot,
} from "./snapshotSchema";

function tryLoadSnapshot(): ReportSnapshot | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = ReportSnapshotSchema.safeParse(parsed);
    if (!result.success) {
      // Stale / cross-version payload — drop it so we don't keep failing.
      try {
        window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

const data: ReportSnapshot = tryLoadSnapshot() ?? defaultReportData;

export const meta = data.meta;
export const profile = data.profile;
export const keyMetrics = data.keyMetrics;
export const allocation = data.allocation;
export const etfs = data.etfs;
export const holdings = data.holdings;
export const monteCarlo = data.monteCarlo;
export const fees = data.fees;
export const tocSections = data.tocSections;

export { SNAPSHOT_STORAGE_KEY } from "./snapshotSchema";
