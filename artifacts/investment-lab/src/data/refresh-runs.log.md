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
| 2026-04-26T08:46:46.908Z | refresh-justetf | listings | 20 | 16 | 4 | 38.4s | partial | manual | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/24952568525) |
| 2026-04-27T05:31:06.809Z | refresh-justetf | listings | 21 | 17 | 4 | 42.5s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/24978222303) |
