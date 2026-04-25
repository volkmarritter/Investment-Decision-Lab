# Scraper run log

Append-only log of every scraper invocation. Written by the scripts themselves
at the end of every run — even when no data actually changed and even when the
run failed — so a "scheduled but no-op" or "scheduled but errored" run still
leaves a visible trace in the repo.

Newest entries are at the bottom. The file is never rewritten or trimmed.

## Columns

- **Started (UTC)** — when the script began.
- **Script** — which scraper (`refresh-justetf` / `refresh-lookthrough`).
- **Mode** — sub-mode for justETF (`core`, `listings`, `all`); blank for lookthrough.
- **ISINs** — how many ISINs the script processed.
- **OK / Fail** — per-ISIN extraction outcome counts.
- **Duration** — total runtime in seconds.
- **Outcome** — `ok` (everything parsed), `partial` (some failed but more succeeded), `fail` (more failed than succeeded, or fatal error), `dry-run` (no write).
- **Trigger** — `schedule` (cron), `manual` (workflow_dispatch from the Actions tab), `local` (developer ran it from a shell).
- **CI run** — link to the GitHub Actions run when applicable.

## Runs

| Started (UTC) | Script | Mode | ISINs | OK | Fail | Duration | Outcome | Trigger | CI run |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 2026-04-25T07:29:42.724Z | refresh-justetf |  |  |  |  | 0.1s | fail (ENOENT: no such file or directory, open '/home/runner/workspace/artifacts/api-se) | local |  |
