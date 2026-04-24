# Data Refresh Scripts

This folder holds the optional **snapshot-build** data pipeline for the Investment Decision Lab.

The app itself stays **frontend-only** — there is no backend, no live API call at runtime, no remote pricing in the browser. Instead, a Node script fetches the latest values from a public source (currently [justETF](https://www.justetf.com)) and writes them as a JSON snapshot into `src/data/`. Vite then bakes that JSON into the production bundle on the next build, so users get fresh values without any runtime network dependency.

## refresh-justetf.mjs

Pulls per-ISIN fields from justETF and writes them to `src/data/etfs.overrides.json`. At module load, `src/lib/etfs.ts` shallow-merges those values on top of the curated in-code `CATALOG` — so when the override file is empty (the default committed state) the engine behaves exactly as before.

### Run locally

```bash
# from artifacts/investment-lab/
node scripts/refresh-justetf.mjs                 # refresh all ISINs from CATALOG
node scripts/refresh-justetf.mjs IE00B5BMR087    # refresh just one ISIN
DRY_RUN=1 node scripts/refresh-justetf.mjs       # parse & log only, do not write
```

After a successful run, commit the modified `src/data/etfs.overrides.json` and rebuild the app.

### What gets refreshed

Only fields listed in the `EXTRACTORS` map of the script are touched. Today that is:

- `terBps` — Total Expense Ratio in basis points (e.g. `7` for 0.07 %)
- `aumMillionsEUR` — Fund size in millions of EUR (USD-quoted funds are rejected by the extractor)
- `inceptionDate` — Inception date as ISO `YYYY-MM-DD`
- `distribution` — `"Accumulating"` or `"Distributing"`
- `replication` — `"Physical"`, `"Physical (sampled)"` or `"Synthetic"`

Everything else (`name`, `listings`, `defaultExchange`, `comment`, the look-through profiles in `lookthrough.ts`, the CMAs in `metrics.ts`, the stress scenarios in `scenarios.ts`, ...) stays curated in code. Add new extractors to the script — and widen the `ETFOverride` `Pick<>` in `src/lib/etfs.ts` — if you want more fields covered.

### Politeness & robustness

- A **1.5 s delay** is enforced between page requests.
- A descriptive `User-Agent` is sent. **Edit it** to point at your own contact address before running this in CI.
- justETF's HTML is unofficially scraped — if a regex stops matching for a single field on a single ISIN, the script logs a warning and keeps the previous value for that field on disk (no clobber). The ISIN is only counted as a *failure* when **no** field could be extracted at all. The script exits non-zero only when failures outnumber successes (`failCount > okCount`), so a small number of stale rows still passes CI but a wholesale parser break (e.g. justETF rewrites their page) reliably fails the workflow.
- Sanity guards: TER must lie in `(0 %, 3 %]`, AUM in `[1, 1_000_000]` EUR-millions (USD-denominated values are rejected), inception year in `[1990, currentYear+1]`, and `distribution` / `replication` are coerced onto our two- / three-value enums respectively.

### Weekly automation

`.github/workflows/refresh-data.yml` runs this script every **Sunday at 03:00 UTC** (and on manual `workflow_dispatch`), runs `typecheck` + `test` against the new snapshot, and commits the diff if any. The weekly cadence keeps the load on justETF very light while still catching TER / AUM / distribution / replication drift in a timely manner — trigger an out-of-band run from the Actions tab whenever you need an immediate refresh. See that file for the schedule and required permissions.
