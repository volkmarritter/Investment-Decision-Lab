// ----------------------------------------------------------------------------
// catalog-classify.ts
// ----------------------------------------------------------------------------
// Pure decision function used by the admin pane to label a draft entry as
// NEW, REPLACE, or DUPLICATE_ISIN against the live catalog. Lives outside
// the React component so the rules can be unit-tested without React.
//
// Decision priority:
//   1. DUPLICATE_ISIN — if some OTHER key in the catalog already uses this
//      ISIN, that's a hard block. Even if the operator also picked a key
//      that exists (a "double accident"), they need to fix the ISIN or
//      the key first.
//   2. REPLACE — the chosen key already exists in the catalog. The
//      operator gets a side-by-side diff before committing.
//   3. NEW — clean add.
// ----------------------------------------------------------------------------

import type {
  CatalogEntrySummary,
  CatalogSummary,
} from "./admin-api";

export type ClassifyResult =
  | { state: "NEW" }
  | { state: "REPLACE"; existing: CatalogEntrySummary }
  | { state: "DUPLICATE_ISIN"; conflictKey: string; conflict: CatalogEntrySummary };

export function classifyDraft(
  catalog: CatalogSummary,
  draftKey: string,
  draftIsin: string,
): ClassifyResult {
  const normalizedKey = draftKey.trim();
  const normalizedIsin = draftIsin.trim().toUpperCase();

  // Look for an ISIN collision under a *different* key. We deliberately
  // exclude the case where the operator is editing the entry that
  // already owns this ISIN — that's a same-key REPLACE, not a duplicate.
  for (const [k, entry] of Object.entries(catalog)) {
    if (k === normalizedKey) continue;
    if (entry.isin.toUpperCase() === normalizedIsin) {
      return { state: "DUPLICATE_ISIN", conflictKey: k, conflict: entry };
    }
  }

  if (normalizedKey && catalog[normalizedKey]) {
    return { state: "REPLACE", existing: catalog[normalizedKey] };
  }

  return { state: "NEW" };
}
