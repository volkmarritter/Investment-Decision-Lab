import type { Lang } from "./i18n";

// Formats an ISO timestamp written by the refresh scripts into a localised
// date string. Returns null when the input is falsy or fails to parse so
// callers can fall back to a "not yet refreshed" message.
export function formatRefreshDate(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}
