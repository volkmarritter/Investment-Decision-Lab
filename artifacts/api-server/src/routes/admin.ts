// ----------------------------------------------------------------------------
// admin.ts (router)
// ----------------------------------------------------------------------------
// All endpoints under /api/admin/*. Gated by requireAdmin (Bearer ADMIN_TOKEN).
//
// Read-only:
//   GET  /admin/changes?limit=50  — recent per-field diff entries
//   GET  /admin/run-log?limit=20  — parsed markdown run log
//   GET  /admin/freshness         — _meta blocks of override JSONs
//   GET  /admin/whoami            — auth-check ping for the UI
//
// Mutations:
//   POST /admin/preview-isin      — scrape one ISIN, return draft entry
//   POST /admin/add-isin          — open a PR adding the (edited) entry
//
// Reads happen on every request (data files are tiny + infrequently updated;
// caching would only add complexity).
// ----------------------------------------------------------------------------

import { Router, type IRouter } from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireAdmin } from "../middlewares/admin-auth";
import { dataFile } from "../lib/data-paths";
import { githubConfigured, openAddEtfPr, type NewEtfEntry } from "../lib/github";
// Cross-artifact import of the pure scraper helpers (typed via
// src/types/justetf-scraper.d.ts). The api-server is bundled by esbuild,
// so the .mjs is inlined into dist/index.mjs at build time and there's no
// runtime path-resolution dependency in production.
import * as scraper from "../../../investment-lab/scripts/lib/justetf-extract.mjs";

const router: IRouter = Router();

router.use("/admin", requireAdmin);

// --- /api/admin/whoami -------------------------------------------------------
// Cheapest possible 200 — used by the UI to validate a stored token.
router.get("/admin/whoami", (_req, res) => {
  res.json({
    ok: true,
    githubConfigured: githubConfigured(),
  });
});

// --- /api/admin/changes ------------------------------------------------------
router.get("/admin/changes", async (req, res) => {
  const limit = clampLimit(req.query.limit, 50, 500);
  let body: string;
  try {
    body = await readFile(dataFile("refresh-changes.log.jsonl"), "utf8");
  } catch {
    res.json({ entries: [], total: 0 });
    return;
  }
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  const entries: unknown[] = [];
  // Iterate from the end so the newest entries land first without an O(n)
  // sort over a potentially-large file.
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {
      // Skip malformed lines defensively rather than failing the whole
      // request — a single corrupted line should not blank the panel.
    }
  }
  res.json({ entries, total: lines.length });
});

// --- /api/admin/run-log ------------------------------------------------------
router.get("/admin/run-log", async (req, res) => {
  const limit = clampLimit(req.query.limit, 20, 200);
  let body: string;
  try {
    body = await readFile(dataFile("refresh-runs.log.md"), "utf8");
  } catch {
    res.json({ rows: [], total: 0 });
    return;
  }
  const rows = parseRunLogMd(body);
  // Newest rows are at the bottom of the table per run-log.mjs.
  const tail = rows.slice(-limit).reverse();
  res.json({ rows: tail, total: rows.length });
});

// --- /api/admin/freshness ----------------------------------------------------
router.get("/admin/freshness", async (_req, res) => {
  const [coreMeta, lookthroughMeta] = await Promise.all([
    readMeta(dataFile("etfs.overrides.json")),
    readMeta(dataFile("lookthrough.overrides.json")),
  ]);
  res.json({
    etfsOverrides: coreMeta,
    lookthroughOverrides: lookthroughMeta,
    schedules: {
      // These mirror the cron lines in .github/workflows/*.yml so the UI
      // can show "next run: Sun Apr 26, 03:00 UTC". If a workflow changes
      // its cron expression, update this map too.
      "refresh-data (weekly core)": "0 3 * * 0",
      "refresh-listings (nightly listings)": "0 2 * * *",
      "refresh-lookthrough (monthly)": "0 4 1 * *",
    },
  });
});

// --- /api/admin/preview-isin -------------------------------------------------
// Scrapes ONE ISIN and returns a draft catalog entry the user can edit
// before submitting. Does not write to disk.
router.post("/admin/preview-isin", async (req, res) => {
  const isin = String(req.body?.isin ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
    res.status(400).json({ error: "invalid_isin", isin });
    return;
  }
  let html: string;
  try {
    html = await scraper.fetchProfile(isin);
  } catch (err) {
    res.status(502).json({
      error: "fetch_failed",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return;
  }

  const fields: Record<string, unknown> = {};
  // Core fields used by the catalog (TER, AUM, inception, replication,
  // distribution) come from CORE_EXTRACTORS. The preview-only set adds
  // name/currency/domicile which are otherwise curated by hand.
  for (const [k, fn] of Object.entries(scraper.CORE_EXTRACTORS)) {
    try {
      fields[k] = (fn as (h: string) => unknown)(html);
    } catch {
      fields[k] = undefined;
    }
  }
  for (const [k, fn] of Object.entries(scraper.PREVIEW_EXTRACTORS)) {
    try {
      const v = (fn as (h: string) => unknown)(html);
      if (v !== undefined) fields[k] = v;
    } catch {
      // Skip silently — UI shows "—" for missing fields.
    }
  }
  // Listings are returned but not validated against VENUE_MAP — the user
  // edits them before submitting.
  let listings: unknown = undefined;
  try {
    listings = (scraper.LISTINGS_EXTRACTORS.listings as (h: string) => unknown)(
      html,
    );
  } catch {
    listings = undefined;
  }

  const aum =
    typeof fields.aumMillionsEUR === "number"
      ? (fields.aumMillionsEUR as number)
      : undefined;
  const ter =
    typeof fields.terBps === "number" ? (fields.terBps as number) : undefined;
  const policyFit = {
    aumOk: aum !== undefined && aum > 100,
    terOk: ter !== undefined && ter < 30,
    notes: [] as string[],
  };
  if (aum === undefined) policyFit.notes.push("AUM not detected — verify manually.");
  if (ter === undefined) policyFit.notes.push("TER not detected — verify manually.");

  res.json({
    isin,
    fields,
    listings,
    policyFit,
    sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
  });
});

// --- /api/admin/add-isin -----------------------------------------------------
// Opens a PR. The user has already reviewed/edited the entry in the UI.
router.post("/admin/add-isin", async (req, res) => {
  // Validate FIRST so a misconfigured server still tells the operator
  // when their payload is wrong (rather than masking the bug behind a
  // 503).
  const entry = req.body?.entry as NewEtfEntry | undefined;
  const validationError = validateEntry(entry);
  if (validationError || !entry) {
    res.status(400).json({ error: "invalid_entry", message: validationError });
    return;
  }
  if (!githubConfigured()) {
    res.status(503).json({
      error: "github_not_configured",
      message:
        "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server.",
    });
    return;
  }

  const aumOk = (entry.aumMillionsEUR ?? 0) > 100;
  const terOk = entry.terBps < 30;
  try {
    const pr = await openAddEtfPr(entry, {
      policyFit: { aumOk, terOk, notes: [] },
    });
    res.json({ ok: true, prUrl: pr.url, prNumber: pr.number });
  } catch (err) {
    res.status(502).json({
      error: "pr_creation_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- helpers -----------------------------------------------------------------

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

async function readMeta(path: string): Promise<unknown> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return raw?._meta ?? null;
  } catch {
    return null;
  }
}

function parseRunLogMd(body: string): Array<Record<string, string>> {
  const lines = body.split("\n");
  const headerIdx = lines.findIndex((l) => /^\|\s*Started \(UTC\)\s*\|/.test(l));
  if (headerIdx < 0) return [];
  const headerCells = splitMdRow(lines[headerIdx]);
  const rows: Array<Record<string, string>> = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMdRow(line);
    if (cells.length !== headerCells.length) continue;
    const row: Record<string, string> = {};
    headerCells.forEach((h, j) => {
      row[h] = cells[j];
    });
    rows.push(row);
  }
  return rows;
}

function splitMdRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// Strict schema for /admin/add-isin payloads. Defence-in-depth against
// rendering invalid or hostile content into etfs.ts inside the generated
// PR. Each rule returns a human-readable message on failure.
const EXCHANGES = ["LSE", "XETRA", "SIX", "Euronext"] as const;
type ExchangeKey = (typeof EXCHANGES)[number];
const TICKER_RE = /^[A-Za-z0-9._:-]{1,16}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateEntry(e: NewEtfEntry | undefined): string | null {
  if (!e || typeof e !== "object") return "entry missing";
  if (typeof e.key !== "string" || !/^[A-Z][A-Za-z0-9-]{2,40}$/.test(e.key))
    return "key must be alphanumeric/hyphens, 3-40 chars, start with letter";
  if (typeof e.isin !== "string" || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(e.isin))
    return "isin invalid";
  if (
    typeof e.terBps !== "number" ||
    !Number.isFinite(e.terBps) ||
    e.terBps < 0 ||
    e.terBps > 500
  )
    return "terBps must be finite number in [0, 500]";
  if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 200)
    return "name missing or too long (max 200 chars)";
  if (
    typeof e.domicile !== "string" ||
    !e.domicile.trim() ||
    e.domicile.length > 60
  )
    return "domicile missing or too long";
  if (!["Physical", "Physical (sampled)", "Synthetic"].includes(e.replication))
    return "replication invalid";
  if (!["Accumulating", "Distributing"].includes(e.distribution))
    return "distribution invalid";
  if (typeof e.currency !== "string" || !/^[A-Z]{3}$/.test(e.currency))
    return "currency must be 3-letter code";
  if (typeof e.comment !== "string" || e.comment.length > 1000)
    return "comment must be a string up to 1000 chars";
  if (!EXCHANGES.includes(e.defaultExchange as ExchangeKey))
    return "defaultExchange invalid";
  if (
    !e.listings ||
    typeof e.listings !== "object" ||
    Array.isArray(e.listings)
  )
    return "listings must be an object";
  const listingKeys = Object.keys(e.listings);
  if (listingKeys.length === 0) return "at least one listing required";
  for (const k of listingKeys) {
    if (!EXCHANGES.includes(k as ExchangeKey))
      return `unknown exchange in listings: ${JSON.stringify(k)}`;
    const v = (e.listings as Record<string, { ticker?: unknown } | undefined>)[
      k
    ];
    if (!v || typeof v !== "object")
      return `listings[${k}] must be an object`;
    if (typeof v.ticker !== "string" || !TICKER_RE.test(v.ticker))
      return `listings[${k}].ticker invalid (must match ${TICKER_RE})`;
  }
  if (!e.listings[e.defaultExchange])
    return "defaultExchange must appear in listings";
  if (e.aumMillionsEUR !== undefined) {
    if (
      typeof e.aumMillionsEUR !== "number" ||
      !Number.isFinite(e.aumMillionsEUR) ||
      e.aumMillionsEUR < 0 ||
      e.aumMillionsEUR > 1_000_000
    )
      return "aumMillionsEUR must be finite number in [0, 1_000_000]";
  }
  if (e.inceptionDate !== undefined) {
    if (typeof e.inceptionDate !== "string" || !ISO_DATE_RE.test(e.inceptionDate))
      return "inceptionDate must be ISO YYYY-MM-DD";
  }
  return null;
}

// Re-export the data-dir helper for tests.
export const _internal = { resolveDataPath: resolve };

export default router;
