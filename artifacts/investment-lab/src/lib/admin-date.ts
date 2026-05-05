// admin-date — shared date / timestamp formatters used across the admin
// surface.
//
// We deliberately keep everything in this single small module so that
// every "Last refreshed", "As of", "Started (UTC)", PR-age and cron
// schedule across the admin tabs renders the same way and reads the
// same in DE and EN. Callers should NEVER show raw ISO strings or raw
// "0 3 * * 0" cron expressions to the operator.
//
// Three input shapes are supported:
//
//  - ISO timestamp with time   (e.g. "2026-04-26T08:47:25.311Z")
//      → formatTimestamp()  →  { local, relative, utc }
//
//  - Calendar date YYYY-MM-DD  (e.g. "2026-04-26", look-through asOf)
//      → formatAsOf()       →  { local, relative }
//
//  - Cron expression           (e.g. "0 3 * * 0")
//      → formatCron()       →  human-readable string

export type AdminLang = "de" | "en";

const ISO_TIMESTAMP_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ASOF_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_RX.test(value);
}

export function isAsOfDate(value: string): boolean {
  return ASOF_DATE_RX.test(value);
}

// Relative-time wording. Positive diffMs = past, negative = future.
// Buckets: <60s, <60min, <48h, otherwise days. Same wording style as
// the existing run-log helper to keep the surface consistent.
export function formatRelative(diffMs: number, lang: AdminLang): string {
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const sec = Math.floor(abs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const de = lang === "de";
  const ago = (n: number, unit: string) =>
    de ? `vor ${n} ${unit}` : `${n} ${unit} ago`;
  const fwd = (n: number, unit: string) => (de ? `in ${n} ${unit}` : `in ${n} ${unit}`);
  const wrap = past ? ago : fwd;
  if (sec < 60) {
    return de ? (past ? "gerade eben" : "in Kürze") : past ? "just now" : "soon";
  }
  if (min < 60) return wrap(min, de ? "Min." : min === 1 ? "min" : "mins");
  if (hr < 48) {
    return wrap(hr, de ? "Std." : hr === 1 ? "hour" : "hours");
  }
  return wrap(day, de ? (day === 1 ? "Tag" : "Tagen") : day === 1 ? "day" : "days");
}

// Format a full ISO timestamp into:
//   - local: "26.04.2026, 10:47" (de-CH) or "26/04/2026, 10:47" (en-GB),
//             24-hour, no seconds
//   - relative: "vor 9 Tagen" / "9 days ago"
//   - utc: "08:47 UTC" so the operator can correlate against the cron
//
// Returns null for empty / unparseable input — callers should render an
// em-dash or skip the row in that case.
export function formatTimestamp(
  iso: string | null | undefined,
  lang: AdminLang,
): { local: string; relative: string; utc: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const locale = lang === "de" ? "de-CH" : "en-GB";
  const local = date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const utc = `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")} UTC`;
  const relative = formatRelative(Date.now() - date.getTime(), lang);
  return { local, relative, utc };
}

// Format a calendar-day "asOf" string (YYYY-MM-DD, no time component)
// into a localised date plus relative age. Parsed as UTC midnight so
// the displayed day never shifts due to the operator's local TZ.
//
// Returns null for empty / non-matching input.
export function formatAsOf(
  value: string | null | undefined,
  lang: AdminLang,
): { local: string; relative: string } | null {
  if (!value || !ASOF_DATE_RX.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date.getTime())) return null;
  const locale = lang === "de" ? "de-CH" : "en-GB";
  const local = date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const relative = formatRelative(Date.now() - date.getTime(), lang);
  return { local, relative };
}

// Humanise a 5-field cron expression for the small set of patterns
// actually used by the data-refresh GitHub Actions:
//   "0 3 * * 0"  → "wöchentlich So 03:00 UTC" / "weekly Sun at 03:00 UTC"
//   "0 2 * * *"  → "täglich 02:00 UTC"        / "daily at 02:00 UTC"
//   "0 4 1 * *"  → "monatlich am 1. 04:00 UTC"/ "monthly on the 1st at 04:00 UTC"
// Falls back to the raw expression for any pattern we don't recognise
// (5-field arithmetic that doesn't match one of the three shapes), so
// nothing is ever silently mis-stated.
export function formatCron(cron: string, lang: AdminLang): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);
  if (!isNum(min) || !isNum(hour)) return cron;
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
  const de = lang === "de";

  if (dom === "*" && mon === "*" && dow === "*") {
    return de ? `täglich ${time}` : `daily at ${time}`;
  }
  if (dom === "*" && mon === "*" && isNum(dow)) {
    const days = de
      ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = days[Number(dow) % 7];
    return de ? `wöchentlich ${d} ${time}` : `weekly ${d} at ${time}`;
  }
  if (mon === "*" && dow === "*" && isNum(dom)) {
    const n = Number(dom);
    if (de) return `monatlich am ${n}. ${time}`;
    const ordSuffix = (k: number) => {
      const v = k % 100;
      if (v >= 11 && v <= 13) return "th";
      switch (k % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };
    return `monthly on the ${n}${ordSuffix(n)} at ${time}`;
  }
  return cron;
}
