# Vercel deployment

## What & Why
Document the minimum steps and known caveats for hosting the Investment Decision Lab + API Server on Vercel. The frontend maps cleanly to Vercel's static hosting; the Express API has to be adapted to Vercel's serverless functions model, with several real caveats around the admin panel's filesystem usage.

## Done looks like
- The frontend is reachable at the Vercel-assigned domain (or a custom domain).
- `/api/healthz` returns OK from the same domain.
- `/api/etf-preview/:isin` works (serverless cold starts accepted).
- The `/admin` panel loads and can open GitHub PRs for catalog edits.
- Operator understands the documented limitations before going live.

## Out of scope
- Postgres / database setup — the app does not use the database today.
- Docker, self-hosted runners, edge functions, or ISR.
- Migrating away from the file-based catalog to a hosted store.

## Known caveats (must be acknowledged before deploying)
1. **Read-only filesystem.** Vercel serverless functions can only write to `/tmp` and that's per-invocation. The admin panel's "direct-write" mode (which edits `etfs.ts` on disk) cannot work — admin mutations must go through GitHub PR mode, which means `GITHUB_PAT`/`GITHUB_OWNER`/`GITHUB_REPO` are mandatory.
2. **Refresh log appends won't persist.** Any code that appends to `artifacts/investment-lab/src/data/refresh-*.log.jsonl` from the running server will lose data between invocations. These writes need to be either disabled in the serverless build or rerouted (e.g. only written from CI/cron, not from request handlers).
3. **Express → serverless adaptation.** The Express app must be exported as a single handler (e.g. `api/index.ts` that imports `app` and calls it via `serverless-http` or Vercel's Node runtime). All routes get mounted under `/api/*` via Vercel's routing.
4. **Cold starts on `/api/etf-preview/:isin`.** First-hit latency will be noticeably higher than the always-on Express process; acceptable for an admin/preview tool, less so for end-user critical paths.
5. **Function timeout.** Long justETF scrapes must finish within Vercel's function timeout (10s on Hobby, 60s on Pro). Bound the upstream fetch timeout accordingly.

## Steps

1. **Add a Vercel build configuration**
   Create `vercel.json` at the repo root that declares two outputs: the static frontend (built from `artifacts/investment-lab`) and the serverless function for the API. Define rewrites so `/api/*` hits the function and everything else hits the SPA with index.html fallback.

2. **Wrap the Express app as a serverless handler**
   Add a thin `api/index.ts` (or equivalent entry the Vercel build picks up) that imports the existing Express `app` and exports it as a serverless handler. Do not rewrite routes — reuse the existing app intact.

3. **Disable workspace-only filesystem writes in production**
   Confirm `directWriteMode()` returns false on Vercel (it should, since the workspace files won't be present), and audit the api-server for any other `fs.appendFile` / `fs.writeFile` calls on workspace paths. Guard them on `process.env.VERCEL` or skip them when the target path is not writable.

4. **Configure environment variables in the Vercel project**
   - `ADMIN_TOKEN` — operator bearer token for `/api/admin/*`
   - `GITHUB_PAT`, `GITHUB_OWNER`, `GITHUB_REPO` — required (admin direct-write is unavailable on Vercel)
   - `NODE_ENV=production` (Vercel sets this automatically)
   - No `PORT` — Vercel manages the listener
   - No `DATABASE_URL` — not used today

5. **Hook up the build**
   Connect the GitHub repo to Vercel, set the build command to install pnpm + run `pnpm run build`, and set the output directory to the Vite `dist/` folder of `artifacts/investment-lab`. Verify the API function builds in the same pipeline.

6. **Smoke-test and document caveats**
   Verify the frontend, `/api/healthz`, an ETF preview, and an admin PR creation all work end-to-end on the deployed URL. Add a short `VERCEL.md` capturing the read-only-FS caveat and the requirement to use PR mode for all catalog edits.

## Relevant files
- `replit.md`
- `threat_model.md`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/github.ts`
- `artifacts/api-server/src/routes/admin.ts`
- `artifacts/investment-lab/package.json`
- `artifacts/investment-lab/vite.config.ts`
