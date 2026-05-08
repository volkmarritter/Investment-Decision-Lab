// ----------------------------------------------------------------------------
// changes-shim.ts — Task #207 round 4 compat
// ----------------------------------------------------------------------------
// The auto-description-refresh path (scripts/backfill-comments.mjs) appends
// one JSONL line per touched ISIN with a `changes:[{field,before,after},…]`
// array. The admin client's ChangeEntry type and DataUpdates.tsx still
// expect the legacy per-field flat shape {ts,source,isin,field,before,
// after}. This pure helper expands the new shape into the legacy one so the
// /admin/changes route can return a uniform stream regardless of which
// writer produced the line.
// ----------------------------------------------------------------------------

export interface LegacyChangeEntry {
  ts: string;
  source: string;
  isin: string;
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Expand one parsed JSONL record from refresh-changes.log into one or more
 * LegacyChangeEntry rows. Returns the original record verbatim when it
 * already matches the legacy shape (no `changes` array). Caller is
 * responsible for budget enforcement.
 */
export function expandChangeRecord(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.changes)) return [obj];
  const ts =
    (typeof obj.timestamp === "string" && obj.timestamp) ||
    (typeof obj.ts === "string" && obj.ts) ||
    "";
  const source = typeof obj.source === "string" ? obj.source : "unknown";
  const isin = typeof obj.isin === "string" ? obj.isin : "";
  const out: LegacyChangeEntry[] = [];
  for (const c of obj.changes as Array<Record<string, unknown>>) {
    out.push({
      ts,
      source,
      isin,
      field: typeof c.field === "string" ? c.field : "",
      before: c.before ?? null,
      after: c.after ?? null,
    });
  }
  return out;
}
