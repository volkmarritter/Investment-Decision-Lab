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
import {
  githubConfigured,
  openAddEtfPr,
  renderEntryBlock,
  type NewEtfEntry,
} from "../lib/github";
import { findDuplicateIsinKey, loadCatalog } from "../lib/catalog-parser";
import { scrapePreview, PreviewError } from "../lib/etf-scrape";

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

// --- /api/admin/catalog ------------------------------------------------------
// Returns a summary of every entry in the static CATALOG literal. The
// admin pane uses this to classify a draft entry as NEW / REPLACE /
// DUPLICATE_ISIN before the operator clicks Open PR. Cached per process
// (content-keyed) so repeated polls don't re-parse the file.
router.get("/admin/catalog", async (_req, res) => {
  try {
    const entries = await loadCatalog();
    res.json({ entries });
  } catch (err) {
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- /api/admin/render-entry -------------------------------------------------
// Returns the literal `"<key>": E({...})` TS block that would be inserted
// into etfs.ts for the given draft. Same renderer the PR-creation flow
// uses, so the in-app "Show generated code" disclosure is byte-identical
// to what GitHub will see.
router.post("/admin/render-entry", (req, res) => {
  const entry = req.body?.entry as NewEtfEntry | undefined;
  const validationError = validateEntry(entry);
  if (validationError || !entry) {
    res.status(400).json({ error: "invalid_entry", message: validationError });
    return;
  }
  try {
    const code = renderEntryBlock(entry, "  ");
    res.json({ code });
  } catch (err) {
    res.status(500).json({
      error: "render_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- /api/admin/preview-isin -------------------------------------------------
// Scrapes ONE ISIN and returns a draft catalog entry the user can edit
// before submitting. Does not write to disk.
router.post("/admin/preview-isin", async (req, res) => {
  try {
    const result = await scrapePreview(req.body?.isin);
    res.json(result);
  } catch (err) {
    if (err instanceof PreviewError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
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

  // Belt-and-braces duplicate-ISIN guard. The UI already disables the
  // submit button when classifyDraft returns DUPLICATE_ISIN, but a stale
  // catalog snapshot in the browser (or a direct API call bypassing the
  // UI) could otherwise still open a PR that silently overwrites another
  // entry's ISIN on merge. Enforce the same rule server-side using the
  // freshest catalog source.
  try {
    const catalog = await loadCatalog();
    const dupKey = findDuplicateIsinKey(catalog, entry.key, entry.isin);
    if (dupKey) {
      res.status(409).json({
        error: "duplicate_isin",
        message: `ISIN ${entry.isin} is already used by catalog key "${dupKey}". Change the ISIN, or change the catalog key to "${dupKey}" if you want to replace it.`,
        conflictKey: dupKey,
      });
      return;
    }
  } catch (err) {
    // If we can't load the catalog we'd rather fail closed than open a
    // PR blind: surface the parse failure to the operator.
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
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
