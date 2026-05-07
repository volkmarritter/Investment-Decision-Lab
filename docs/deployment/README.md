# Deployment guides

This folder collects the supported deployment paths for the Investment
Decision Lab + API Server. Pick the one that matches your operational
preferences:

- [`self-host.md`](./self-host.md) — run the app on a Linux server you
  own (Node.js 24, systemd, nginx/Caddy reverse proxy, Let's Encrypt
  TLS). Smallest path from a fresh box to a reachable HTTPS install.
- [`vercel.md`](./vercel.md) — host the static frontend and the
  Express API on Vercel's serverless platform. Includes the read-only
  filesystem caveat that forces all admin catalog edits to go through
  GitHub PR mode.
