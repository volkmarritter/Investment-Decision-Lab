// ----------------------------------------------------------------------------
// run-log.mjs
// ----------------------------------------------------------------------------
// Tiny append-only log of every scraper invocation. Each row is added by the
// script itself at the end of the run — even when no data actually changed
// and even when the run failed — so a "scheduled but no-op" or "scheduled
// but errored" run still leaves a visible trace in the repo.
//
// Storage format: a single markdown file with a fixed header + one table row
// per run. The file is never rewritten or trimmed; the scrapers only ever
// append. Newest entries are at the bottom.
//
// The companion GitHub Action workflows always commit this file (in addition
// to the scraped *.overrides.json files), so even a no-op run produces a
// commit and shows up in the repo's history. That commit is the
// authoritative record that the scheduled job actually ran.
// ----------------------------------------------------------------------------

import { appendFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const HEADER = `# Scraper run log

Append-only log of every scraper invocation. Written by the scripts themselves
at the end of every run — even when no data actually changed and even when the
run failed — so a "scheduled but no-op" or "scheduled but errored" run still
leaves a visible trace in the repo.

Newest entries are at the bottom. The file is never rewritten or trimmed.

## Columns

- **Started (UTC)** — when the script began.
- **Script** — which scraper (\`refresh-justetf\` / \`refresh-lookthrough\`).
- **Mode** — sub-mode for justETF (\`core\`, \`listings\`, \`all\`); blank for lookthrough.
- **ISINs** — how many ISINs the script processed.
- **OK / Fail** — per-ISIN extraction outcome counts.
- **Duration** — total runtime in seconds.
- **Outcome** — \`ok\` (everything parsed), \`partial\` (some failed but more succeeded), \`fail\` (more failed than succeeded, or fatal error), \`dry-run\` (no write).
- **Trigger** — \`schedule\` (cron), \`manual\` (workflow_dispatch from the Actions tab), \`local\` (developer ran it from a shell).
- **CI run** — link to the GitHub Actions run when applicable.

## Runs

| Started (UTC) | Script | Mode | ISINs | OK | Fail | Duration | Outcome | Trigger | CI run |
|---|---|---|---:|---:|---:|---:|---|---|---|
`;

function detectTrigger(dryRun) {
  if (dryRun) return "dry-run";
  const ev = process.env.GITHUB_EVENT_NAME;
  if (ev === "schedule") return "schedule";
  if (ev === "workflow_dispatch") return "manual";
  return "local";
}

function buildCiRunUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return "";
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function escapeCell(s) {
  // Markdown-table-safe: collapse pipes/newlines that would break the row.
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/**
 * Append a single row to the run log.
 *
 * @param {string} logPath  Absolute path to the markdown log file.
 * @param {object} entry
 * @param {string} entry.startedAt   ISO timestamp when main() started.
 * @param {string} entry.script      e.g. "refresh-justetf", "refresh-lookthrough".
 * @param {string} [entry.mode]      Sub-mode label (justETF: core/listings/all).
 * @param {number} [entry.isinCount] How many ISINs the run targeted.
 * @param {number} [entry.okCount]   How many ISINs extracted at least one field.
 * @param {number} [entry.failCount] How many ISINs failed entirely.
 * @param {boolean} [entry.dryRun]   True when DRY_RUN was set.
 * @param {string} [entry.outcome]   Override the auto-derived outcome label.
 * @param {string} [entry.error]     If a fatal error was thrown, its message.
 */
export async function appendRunLogEntry(logPath, entry) {
  // Bootstrap: if the log file is missing (first run on a fresh checkout),
  // create the directory and write the header in a single writeFile call.
  // Subsequent rows go through fs.appendFile, which is atomic at the OS
  // level for small writes — so a crash or SIGKILL during the write of a
  // single row cannot truncate or corrupt previously-recorded rows.
  let needsHeader = false;
  try {
    await stat(logPath);
  } catch {
    needsHeader = true;
    await mkdir(dirname(logPath), { recursive: true });
  }
  if (needsHeader) {
    await writeFile(logPath, HEADER, "utf8");
  }

  const durationMs = Date.now() - new Date(entry.startedAt).getTime();
  const outcome =
    entry.outcome ??
    (entry.dryRun
      ? "dry-run"
      : entry.error
      ? "fail"
      : (entry.failCount ?? 0) === 0
      ? "ok"
      : (entry.okCount ?? 0) > (entry.failCount ?? 0)
      ? "partial"
      : "fail");

  const ciRunUrl = buildCiRunUrl();
  const trigger = detectTrigger(entry.dryRun);

  const cells = [
    entry.startedAt,
    entry.script,
    entry.mode ?? "",
    entry.isinCount ?? "",
    entry.okCount ?? "",
    entry.failCount ?? "",
    `${(durationMs / 1000).toFixed(1)}s`,
    entry.error ? `${outcome} (${entry.error.slice(0, 80)})` : outcome,
    trigger,
    ciRunUrl ? `[run](${ciRunUrl})` : "",
  ].map(escapeCell);

  await appendFile(logPath, `| ${cells.join(" | ")} |\n`, "utf8");
}
