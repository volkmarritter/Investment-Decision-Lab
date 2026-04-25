// ----------------------------------------------------------------------------
// diff-overrides.mjs
// ----------------------------------------------------------------------------
// Helper that compares the previous override-entry for an ISIN against the
// freshly-scraped patch, and appends one JSON line per changed top-level
// field to refresh-changes.log.jsonl.
//
// Why JSONL (not JSON):
//   - Append-only at the OS level (fs.appendFile is atomic for small writes).
//   - No need to read+parse+rewrite the whole file on every scrape.
//   - One line per change is trivial to tail / grep / parse.
//
// Why per top-level field (not whole-record diff):
//   - The admin "Recent data changes" panel surfaces each change as a row:
//     "iShares Core S&P 500 — terBps: 8 → 7".
//   - Nested objects (listings, topHoldings, geo, sector, currency) are
//     stored as their full JSON so the UI can render a small inner diff.
//
// Filtering rules:
//   - We only diff fields that are present in the new patch. A field
//     missing from the patch was not refreshed in this run (e.g. running
//     `--mode=core` skips listings) so the absence does NOT mean it was
//     deleted.
//   - We deep-compare via JSON.stringify with sorted keys so a re-ordered
//     listings object isn't reported as a change.
// ----------------------------------------------------------------------------

import { appendFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") +
    "}"
  );
}

/**
 * Compute per-top-level-field changes between the previous and new entry.
 *
 * @param {Record<string, any> | undefined} prev - Previous override entry, or undefined.
 * @param {Record<string, any>} patch - The patch about to be merged onto prev.
 * @returns {Array<{ field: string, before: any, after: any }>}
 */
export function computeFieldChanges(prev, patch) {
  const changes = [];
  const before = prev ?? {};
  for (const [field, after] of Object.entries(patch)) {
    const old = before[field];
    if (stableStringify(old) === stableStringify(after)) continue;
    changes.push({ field, before: old ?? null, after });
  }
  return changes;
}

/**
 * Append a batch of change records to refresh-changes.log.jsonl. One line
 * per (isin, field) pair. No-ops when changes is empty.
 *
 * @param {string} logPath - Absolute path to refresh-changes.log.jsonl.
 * @param {object} ctx - Common context for every line in this batch.
 * @param {string} ctx.timestamp - ISO timestamp of the scrape.
 * @param {string} ctx.source - Where the change came from ("justetf-core", "justetf-listings", "lookthrough").
 * @param {string} ctx.isin - The ISIN being updated.
 * @param {Array<{field: string, before: any, after: any}>} changes
 */
export async function appendChangeEntries(logPath, ctx, changes) {
  if (!changes || changes.length === 0) return;

  // Bootstrap: create dir + empty file on first run. Subsequent appends
  // use fs.appendFile which is atomic for small writes — a SIGKILL during
  // the write of a single line cannot truncate prior lines.
  try {
    await stat(logPath);
  } catch {
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, "", "utf8");
  }

  const lines = changes
    .map((c) =>
      JSON.stringify({
        ts: ctx.timestamp,
        source: ctx.source,
        isin: ctx.isin,
        field: c.field,
        before: c.before,
        after: c.after,
      })
    )
    .join("\n");
  await appendFile(logPath, lines + "\n", "utf8");
}
