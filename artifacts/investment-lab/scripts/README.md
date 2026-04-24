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

Everything else (`name`, `replication`, `listings`, `defaultExchange`, `comment`, ...) stays curated in `src/lib/etfs.ts`. Add new extractors to the script if you want more fields covered.

### Politeness & robustness

- A **1.5 s delay** is enforced between page requests.
- A descriptive `User-Agent` is sent. **Edit it** to point at your own contact address before running this in CI.
- justETF's HTML is unofficially scraped — if the structure changes and a regex stops matching, the script logs a warning, keeps the previous value for that ISIN, and exits non-zero so a CI job will fail visibly instead of silently writing garbage.
- Sanity guard: any extracted TER outside `(0 %, 3 %]` is rejected.

### Nightly automation

`.github/workflows/refresh-data.yml` runs this script every night, commits the diff (if any) and deploys. See that file for the schedule and required permissions.
