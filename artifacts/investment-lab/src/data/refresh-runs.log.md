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
| 2026-04-28T05:37:10.006Z | refresh-justetf | listings | 21 | 17 | 4 | 39.9s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25035897261) |
| 2026-04-28T17:44:19.378Z | refresh-justetf | listings | 1 | 1 | 0 | 2.3s | dry-run | dry-run |  |
| 2026-04-28T17:44:40.117Z | refresh-justetf | listings | 3 | 3 | 0 | 6.1s | dry-run | dry-run |  |
| 2026-04-28T17:45:22.031Z | refresh-justetf | listings | 53 | 50 | 3 | 103.3s | partial | local |  |
| 2026-04-30T05:13:16.672Z | refresh-justetf | listings | 56 | 53 | 3 | 104.2s | partial | manual | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25148621554) |
| 2026-04-30T05:36:33.697Z | refresh-justetf | listings | 56 | 53 | 3 | 105.4s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25149288214) |
| 2026-05-01T05:48:07.158Z | refresh-justetf | listings | 62 | 59 | 3 | 119.1s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25204100671) |
