# Threat Model

## Project Overview

This repository is a pnpm TypeScript monorepo centered on an investment-analysis web application. The main production application is the React-based Investment Lab (`artifacts/investment-lab`) backed by an Express API server (`artifacts/api-server`). The API provides a public ETF preview endpoint and a token-gated admin API that can read workspace data files and open GitHub pull requests using repository credentials. A separate `marketing-deck` artifact exists as a static React slide deck. `mockup-sandbox` is a development-only sandbox and is out of scope unless production reachability is demonstrated.

## Assets

- **Admin authorization secret** — `ADMIN_TOKEN` gates all `/api/admin/*` routes. Compromise allows access to operational endpoints and GitHub-backed mutation flows.
- **GitHub repository credentials and mutation capability** — `GITHUB_PAT` plus owner/repo settings allow the server to create branches, commits, and pull requests against the canonical catalog repository.
- **Curated catalog and defaults data** — `artifacts/investment-lab/src/lib/etfs.ts` and `artifacts/investment-lab/src/data/*.json*` drive portfolio recommendations, defaults, and look-through data. Unauthorized modification affects all users.
- **Operational metadata and repo state** — workspace sync status, file comparisons, run logs, freshness metadata, and pending PR information reveal internal operational state and should stay within the admin boundary.
- **Service availability and third-party quota** — the public ETF preview endpoint triggers server-side fetches to justETF. Abuse can consume outbound bandwidth, CPU, or upstream goodwill.
- **Browser-held admin token** — the frontend stores the operator token in session storage for the current tab. XSS or overly broad cross-origin trust would expose it.

## Trust Boundaries

- **Public browser to API server** — all client requests are untrusted. The unauthenticated `/api/etf-preview/:isin` endpoint must resist abuse and must not become a generic scraping proxy.
- **Admin browser to admin API** — `/api/admin/*` is protected only by a bearer token. Every admin endpoint must validate auth and constrain inputs because the client is still untrusted even after authentication.
- **API server to local workspace files** — admin routes read catalog/default files directly from disk. Path selection must stay within intended files and must not expose arbitrary workspace content.
- **API server to GitHub API** — the server performs privileged repository mutations using `GITHUB_PAT`. Operator-controlled input must not escape the intended data-editing surface.
- **API server to third-party websites** — ETF and look-through scraping fetches data from justETF. Only fixed destinations should be reachable, with bounded request volume and timeouts.
- **Public versus admin boundary** — public health and ETF preview routes must remain separate from admin-only operational and mutation routes.
- **Development versus production boundary** — `mockup-sandbox`, test code, and local-only tooling should not drive findings unless production reachability is shown.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/investment-lab/src/main.tsx`.
- **Highest-risk server areas**: `artifacts/api-server/src/routes/admin.ts`, `artifacts/api-server/src/lib/github.ts`, `artifacts/api-server/src/lib/workspace-sync.ts`, `artifacts/api-server/src/routes/etf-preview.ts`, `artifacts/api-server/src/lib/etf-scrape.ts`.
- **Public surface**: `GET /api/healthz`, `GET /api/etf-preview/:isin`.
- **Admin surface**: all `/api/admin/*` routes plus the `/admin` SPA path in `artifacts/investment-lab`.
- **Usually dev-only / low-priority**: `artifacts/mockup-sandbox/**`, tests, local scripts unless a production route invokes them; `marketing-deck` is static and lower risk unless it handles privileged data or cross-origin messaging with the main app.

## Threat Categories

### Spoofing

The application has no end-user account system; its main identity boundary is the operator bearer token for `/api/admin/*`. The system must require a valid `ADMIN_TOKEN` on every admin route, avoid weakening that boundary through frontend token leakage, and keep public routes from inheriting admin behavior through route ordering or CORS mistakes.

### Tampering

The most important tampering risk is unauthorized modification of curated catalog/default data or repository state. Admin-controlled fields eventually influence GitHub PR contents and some local file reads/diffs, so the system must strictly validate identifiers, constrain which files can be compared or changed, and ensure repository mutation helpers cannot be steered outside the intended data-editing contract.

### Information Disclosure

Admin routes expose operational state such as workspace sync details, file contents/diffs, run logs, and repository metadata. These must remain behind the admin boundary and must not permit arbitrary file disclosure. Error messages and logs must avoid leaking secrets such as `ADMIN_TOKEN` or `GITHUB_PAT`. The frontend must not expose the admin token to other origins or persist it more broadly than necessary.

### Denial of Service

The public ETF preview endpoint can trigger outbound scraping and parsing work. The system must enforce trustworthy requester identity for rate limiting, bound upstream latency, and avoid allowing unauthenticated attackers to fan out expensive requests. Admin batch endpoints and workspace sync helpers must also avoid unbounded work amplification that could stall the server.

### Elevation of Privilege

Because the admin API can create GitHub PRs and inspect workspace state, any bypass of `requireAdmin`, any path from public input into privileged file or GitHub operations, or any token exposure in the browser would amount to a privilege escalation. The system must keep public and admin code paths isolated, validate all admin-controlled parameters server-side, and prevent operator input from turning data-editing features into broader filesystem or repository access.
