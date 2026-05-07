# Self-host deployment

## What & Why
Document the minimum steps needed to run the Investment Decision Lab + API Server on a user-owned Linux server, outside of Replit. The goal is a working production install — not Docker, CI, or HA — just the smallest path from a fresh server to a reachable app.

## Done looks like
- The frontend is reachable over HTTPS on the operator's domain.
- `/api/healthz` returns OK from the same domain.
- The `/admin` panel loads and accepts the configured `ADMIN_TOKEN`.
- The Express process restarts automatically on crash and on server reboot.

## Out of scope
- Postgres setup — the app does not use the database today (schema is empty, no consumers).
- Docker / containerization.
- CI/CD pipelines.
- Horizontal scaling, load balancing, blue-green deploys.
- TLS certificate automation beyond a one-time `certbot` run.

## Steps

1. **Provision the server**
   Ubuntu/Debian box with Node.js 24, pnpm, git, and a reverse proxy (nginx or Caddy). Open ports 80 and 443.

2. **Clone and build**
   Clone the repo, run `pnpm install`, then `pnpm run build`. This produces the bundled API server and the static frontend assets.

3. **Configure environment variables**
   Create a `.env` (or systemd `EnvironmentFile`) for the API server with:
   - `PORT` — internal port for Express (e.g. 8080)
   - `ADMIN_TOKEN` — operator bearer token for `/api/admin/*`
   - `GITHUB_PAT`, `GITHUB_OWNER`, `GITHUB_REPO` — required so admin catalog edits open pull requests (direct-write mode is workspace-only and won't apply in production)
   - `NODE_ENV=production`

4. **Run the API server as a service**
   Create a systemd unit that runs the built API server bundle, loads the env file, and restarts on failure. Enable it so it starts on boot.

5. **Serve the frontend and reverse-proxy the API**
   Configure nginx/Caddy to:
   - Serve the built frontend static files for all non-API paths (with SPA fallback to `index.html`).
   - Proxy `/api/*` to `127.0.0.1:$PORT` of the Express service.
   - Terminate TLS using a Let's Encrypt cert (one-time `certbot --nginx` or Caddy's automatic HTTPS).

6. **Smoke-test and document the update flow**
   Verify the frontend loads, `/api/healthz` returns OK, and `/admin` accepts the token. Write a short `DEPLOY.md` with the redeploy recipe: `git pull && pnpm install && pnpm run build && systemctl restart <api-service>`.

## Relevant files
- `replit.md`
- `threat_model.md`
- `artifacts/api-server/package.json`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/investment-lab/package.json`
- `lib/db/src/schema/index.ts`
