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
| 2026-05-01T06:30:37.950Z | refresh-lookthrough |  | 40 | 80 | 0 | 120.1s | ok | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25205127055) |
| 2026-05-02T05:17:04.237Z | refresh-justetf | listings | 142 | 134 | 8 | 264.7s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25244580038) |
| 2026-05-03T05:36:53.562Z | refresh-justetf | listings | 142 | 126 | 16 | 268.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25271039315) |
| 2026-05-03T06:08:01.346Z | refresh-justetf | core | 142 | 137 | 5 | 262.8s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25271598656) |
| 2026-05-04T05:41:16.869Z | refresh-justetf | listings | 142 | 137 | 5 | 267.0s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25303018264) |
| 2026-05-05T05:21:20.776Z | refresh-justetf | listings | 142 | 139 | 3 | 275.3s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25359317858) |
| 2026-05-06T05:35:35.296Z | refresh-justetf | listings | 142 | 139 | 3 | 272.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25418378064) |
| 2026-05-07T05:38:13.197Z | refresh-justetf | listings | 142 | 139 | 3 | 265.7s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25478004248) |
| 2026-05-08T05:10:27.617Z | refresh-justetf | listings | 151 | 148 | 3 | 289.4s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25538046522) |
| 2026-05-11T14:31:29.390Z | refresh-justetf | listings | 166 | 144 | 22 | 323.3s | partial | manual | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25676514897) |
| 2026-05-11T14:59:53.409Z | refresh-justetf | core | 166 | 143 | 23 | 309.8s | partial | manual | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25678111918) |
| 2026-05-11T15:11:15.843Z | refresh-lookthrough |  | 131 | 244 | 18 | 405.5s | partial | manual | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25678760070) |
| 2026-05-12T05:44:24.284Z | refresh-justetf | listings | 166 | 140 | 26 | 312.6s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25715905759) |
| 2026-05-13T05:55:02.424Z | refresh-justetf | listings | 166 | 160 | 6 | 323.5s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25781199054) |
| 2026-05-14T05:54:04.539Z | refresh-justetf | listings | 166 | 151 | 15 | 313.0s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25844378920) |
| 2026-05-15T06:00:48.507Z | refresh-justetf | listings | 166 | 144 | 22 | 315.1s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25903006237) |
| 2026-05-16T05:32:45.225Z | refresh-justetf | listings | 166 | 163 | 3 | 316.4s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25953957404) |
| 2026-05-17T05:54:34.075Z | refresh-justetf | listings | 166 | 163 | 3 | 309.0s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25982866950) |
| 2026-05-17T06:25:54.103Z | refresh-justetf | core | 166 | 132 | 34 | 303.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/25983453464) |
| 2026-05-18T06:21:31.714Z | refresh-justetf | listings | 166 | 163 | 3 | 323.7s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26017042299) |
| 2026-05-19T06:16:21.612Z | refresh-justetf | listings | 166 | 133 | 33 | 303.1s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26079880588) |
| 2026-05-20T06:15:53.478Z | refresh-justetf | listings | 166 | 156 | 10 | 315.8s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26145024368) |
| 2026-05-21T06:17:18.816Z | refresh-justetf | listings | 166 | 149 | 17 | 310.6s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26209035821) |
| 2026-05-22T06:15:22.585Z | refresh-justetf | listings | 166 | 150 | 16 | 306.1s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26271736756) |
| 2026-05-23T05:45:17.890Z | refresh-justetf | listings | 166 | 129 | 37 | 314.7s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26324939531) |
| 2026-05-24T06:08:44.289Z | refresh-justetf | listings | 166 | 150 | 16 | 304.3s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26353651968) |
| 2026-05-24T06:40:08.620Z | refresh-justetf | core | 166 | 163 | 3 | 313.4s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26354223523) |
| 2026-05-25T06:42:45.435Z | refresh-justetf | listings | 166 | 143 | 23 | 315.4s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26387244538) |
| 2026-05-26T06:14:01.426Z | refresh-justetf | listings | 166 | 141 | 25 | 303.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26435658034) |
| 2026-05-27T06:35:45.594Z | refresh-justetf | listings | 166 | 163 | 3 | 326.5s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26495064843) |
| 2026-05-28T06:19:33.779Z | refresh-justetf | listings | 166 | 139 | 27 | 309.9s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26558316074) |
| 2026-05-29T06:21:38.084Z | refresh-justetf | listings | 166 | 133 | 33 | 301.9s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26621683601) |
| 2026-05-30T05:53:55.394Z | refresh-justetf | listings | 166 | 151 | 15 | 305.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26676201185) |
| 2026-05-31T06:27:08.922Z | refresh-justetf | listings | 166 | 135 | 31 | 307.7s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26705346374) |
| 2026-05-31T07:00:46.213Z | refresh-justetf | core | 166 | 154 | 12 | 309.2s | partial | schedule | [run](https://github.com/volkmarritter/Investment-Decision-Lab/actions/runs/26705977033) |
