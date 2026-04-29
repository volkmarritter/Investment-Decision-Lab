// ----------------------------------------------------------------------------
// BatchHelpers — pure label/colour mappers shared between the batch panel
// and its display sub-components.
// ----------------------------------------------------------------------------

import type {
  BulkAltLookthroughStatus,
  BulkAltRowOutcome,
  BulkAltRowStatus,
} from "@/lib/admin-api";

// Per-row outcome badge — colour matches the operator's mental model:
// emerald for added, slate for benign skips (already-present), amber
// for input/preflight problems, red for hard failures.
export function batchRowBadgeClass(status: BulkAltRowStatus): string {
  switch (status) {
    case "ok":
      return "border-emerald-600 text-emerald-700 dark:text-emerald-400";
    case "duplicate_isin":
    case "cap_exceeded":
      return "border-slate-500 text-slate-700 dark:text-slate-400";
    case "scrape_failed":
    case "parent_missing":
      return "border-red-600 text-red-700 dark:text-red-400";
    default:
      return "border-amber-600 text-amber-700 dark:text-amber-400";
  }
}

export function batchRowLabel(
  status: BulkAltRowStatus,
  lang: "de" | "en",
): string {
  const map: Record<BulkAltRowStatus, { de: string; en: string }> = {
    ok: { de: "Wird hinzugefügt", en: "Will add" },
    invalid_input: { de: "Eingabe ungültig", en: "Invalid input" },
    invalid_parent_key: {
      de: "parentKey ungültig",
      en: "Invalid parentKey",
    },
    invalid_isin: { de: "ISIN ungültig", en: "Invalid ISIN" },
    invalid_exchange: {
      de: "Börse ungültig",
      en: "Invalid exchange",
    },
    invalid_entry: {
      de: "Eintrag-Validierung fehlgeschlagen",
      en: "Entry validation failed",
    },
    parent_missing: { de: "Bucket fehlt", en: "Bucket missing" },
    duplicate_isin: { de: "ISIN bereits vorhanden", en: "ISIN already used" },
    cap_exceeded: { de: "Bucket-Limit erreicht", en: "Bucket cap reached" },
    scrape_failed: { de: "Scrape fehlgeschlagen", en: "Scrape failed" },
  };
  return map[status][lang];
}

export function lookthroughStatusLabel(
  status: BulkAltLookthroughStatus | undefined,
  plan: BulkAltRowOutcome["lookthroughPlan"] | undefined,
  lang: "de" | "en",
): string {
  if (status === "pr_added")
    return lang === "de" ? "Look-through Pull Request" : "Look-through Pull Request";
  if (status === "already_present")
    return lang === "de" ? "Bereits vorhanden" : "Already present";
  if (status === "incomplete")
    return lang === "de" ? "Unvollständig" : "Incomplete";
  if (status === "scrape_failed")
    return lang === "de" ? "Scrape fehler" : "Scrape failed";
  if (status === "would_add")
    return lang === "de" ? "Wird ergänzt" : "Will add";
  if (plan === "would_scrape")
    return lang === "de" ? "Wird gescraped" : "Will scrape";
  if (plan === "already_present")
    return lang === "de" ? "Bereits vorhanden" : "Already present";
  return "—";
}
