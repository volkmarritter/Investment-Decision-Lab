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
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireAdmin } from "../middlewares/admin-auth";
import { dataFile } from "../lib/data-paths";
import {
  githubConfigured,
  openAddEtfPr,
  openUpdateAppDefaultsPr,
  renderEntryBlock,
  type NewEtfEntry,
} from "../lib/github";
import { findDuplicateIsinKey, loadCatalog } from "../lib/catalog-parser";
import { scrapePreview, PreviewError, normalizeIsin } from "../lib/etf-scrape";
import { scrapeLookthrough } from "../lib/lookthrough-scrape";
import {
  renderAppDefaultsFile,
  stampMeta,
  validateAppDefaults,
  type AppDefaults,
} from "../lib/app-defaults";

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

// --- /api/admin/lookthrough-pool --------------------------------------------
// Bucket-agnostic look-through profiles. The Methodology override dialog
// reads `profileFor(isin)` to decide whether to render the look-through
// section or show the amber "data missing" warning. Adding an ISIN here
// scrapes its top-10 holdings + country/sector breakdowns from justETF
// and persists them under `pool[isin]` in lookthrough.overrides.json so
// the next dialog open finds full data.
//
// Read endpoint: GET /admin/lookthrough-pool — returns the current pool
// map (ISIN -> { topHoldingsAsOf, breakdownsAsOf }) for the UI to render
// a list of what's already in.
router.get("/admin/lookthrough-pool", async (_req, res) => {
  try {
    // Beide Quellen mergen: `overrides` = manuell kuratierte Baseline,
    // `pool` = vom monatlichen Refresh-Job geschriebene Live-Daten.
    // Aus Operator-Sicht sind beide gleichwertig "Look-through ist
    // verfügbar" — die Tabelle muss beide zeigen, sonst entsteht der
    // Eindruck, der Pool sei leer, obwohl 11 ETFs in `overrides` stehen.
    // Bei Kollisionen gewinnt `pool` (frischere Refresh-Daten).
    const { overrides, pool } = await readLookthroughSources();
    const allIsins = new Set<string>([
      ...Object.keys(overrides),
      ...Object.keys(pool),
    ]);
    const entries = Array.from(allIsins).map((isin) => {
      const p = pool[isin];
      const o = overrides[isin];
      const src = p ?? o;
      const source: "pool" | "overrides" | "both" = p && o ? "both" : p ? "pool" : "overrides";
      return {
        isin,
        source,
        topHoldingsAsOf: src.topHoldingsAsOf ?? null,
        breakdownsAsOf: src.breakdownsAsOf ?? null,
        topHoldingCount: src.topHoldings?.length ?? 0,
        geoCount: src.geo ? Object.keys(src.geo).length : 0,
        sectorCount: src.sector ? Object.keys(src.sector).length : 0,
      };
    });
    entries.sort((a, b) => a.isin.localeCompare(b.isin));
    res.json({ entries });
  } catch (err) {
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Write endpoint: POST /admin/lookthrough-pool/:isin — scrape & persist.
// Returns 409 when the ISIN is already in the pool (so the operator can't
// silently overwrite a curated pool entry by re-submitting). The refresh
// script handles updating existing entries on its monthly cron.
router.post("/admin/lookthrough-pool/:isin", async (req, res) => {
  let isin: string;
  try {
    isin = normalizeIsin(req.params.isin);
  } catch (err) {
    res.status(400).json({
      error: "invalid_isin",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const existing = await readLookthroughPool();
    if (existing[isin]) {
      res.status(409).json({
        error: "already_in_pool",
        message: `ISIN ${isin} ist bereits im Datenpool. Der monatliche Refresh-Job aktualisiert die Daten automatisch.`,
      });
      return;
    }

    const scraped = await scrapeLookthrough(isin);
    if (
      (!scraped.topHoldings || scraped.topHoldings.length === 0) &&
      (!scraped.geo || Object.keys(scraped.geo).length === 0)
    ) {
      res.status(422).json({
        error: "no_lookthrough_data",
        message: `justETF lieferte keine Top-Holdings oder Länderaufteilung für ${isin} — die ISIN kann nicht in den Datenpool aufgenommen werden.`,
      });
      return;
    }
    if (
      !scraped.topHoldings ||
      scraped.topHoldings.length === 0 ||
      !scraped.geo ||
      Object.keys(scraped.geo).length === 0 ||
      !scraped.sector ||
      Object.keys(scraped.sector).length === 0
    ) {
      res.status(422).json({
        error: "incomplete_lookthrough_data",
        message: `Daten unvollständig für ${isin}: ${[
          (!scraped.topHoldings || scraped.topHoldings.length === 0) &&
            "Top-Holdings",
          (!scraped.geo || Object.keys(scraped.geo).length === 0) && "Geo",
          (!scraped.sector || Object.keys(scraped.sector).length === 0) &&
            "Sektor",
        ]
          .filter(Boolean)
          .join(", ")} fehlen. Methodology-Overrides brauchen alle drei.`,
      });
      return;
    }

    const path = dataFile("lookthrough.overrides.json");
    const file = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    const pool = (file.pool ?? {}) as Record<string, unknown>;
    pool[isin] = {
      topHoldings: scraped.topHoldings,
      topHoldingsAsOf: scraped.asOf,
      geo: scraped.geo,
      sector: scraped.sector,
      currency: scraped.currency,
      breakdownsAsOf: scraped.asOf,
      _source: scraped.sourceUrl,
      _addedAt: scraped.asOf,
      _addedVia: "admin/lookthrough-pool",
    };
    file.pool = pool;
    await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf8");

    res.status(201).json({
      ok: true,
      isin,
      topHoldingCount: scraped.topHoldings.length,
      geoCount: Object.keys(scraped.geo).length,
      sectorCount: Object.keys(scraped.sector).length,
      asOf: scraped.asOf,
      sourceUrl: scraped.sourceUrl,
      note: "App-Build muss neu gestartet werden, damit das Frontend die neue ISIN sieht.",
    });
  } catch (err) {
    if (err instanceof PreviewError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

type LookthroughEntryShape = {
  topHoldings?: Array<{ name: string; pct: number }>;
  topHoldingsAsOf?: string;
  geo?: Record<string, number>;
  sector?: Record<string, number>;
  currency?: Record<string, number>;
  breakdownsAsOf?: string;
};

// Liefert beide Sektionen der Datei. `overrides` = manuell kuratierte
// Baseline (Repo-eingecheckt), `pool` = vom monatlichen Refresh-Job
// geschriebene Live-Daten. Aus Frontend-Sicht sind beide gleichwertig
// "Look-through-Daten verfügbar".
async function readLookthroughSources(): Promise<{
  overrides: Record<string, LookthroughEntryShape>;
  pool: Record<string, LookthroughEntryShape>;
}> {
  try {
    const raw = JSON.parse(
      await readFile(dataFile("lookthrough.overrides.json"), "utf8"),
    );
    return {
      overrides: (raw?.overrides ?? {}) as Record<string, LookthroughEntryShape>,
      pool: (raw?.pool ?? {}) as Record<string, LookthroughEntryShape>,
    };
  } catch {
    return { overrides: {}, pool: {} };
  }
}

// Beibehaltener Helper für Schreibpfade, die nur den auto-refresh-Pool
// berühren dürfen (POST /admin/lookthrough-pool/:isin schreibt
// ausschliesslich in `pool[isin]` — die kuratierten `overrides` bleiben
// unangetastet).
async function readLookthroughPool(): Promise<
  Record<string, LookthroughEntryShape>
> {
  return (await readLookthroughSources()).pool;
}

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

// --- /api/admin/app-defaults -------------------------------------------------
// Operator-managed global defaults (RF rates, Home-Bias, CMA) shipped in the
// investment-lab bundle. The /admin pane edits these and opens a GitHub PR
// against `artifacts/investment-lab/src/data/app-defaults.json`. After merge
// + redeploy every user picks up the new defaults — per-user localStorage
// overrides from the Methodology editor still layer on top.
//
// GET returns the current on-disk file content (always-fresh, no caching).
// We read the same file the bundler reads so the admin UI always shows the
// truth, even between deploys when we're running ahead of GitHub.

router.get("/admin/app-defaults", async (_req, res) => {
  let body: string;
  try {
    body = await readFile(dataFile("app-defaults.json"), "utf8");
  } catch {
    // Missing file → empty defaults. Same UX as a brand-new repo.
    res.json({ value: {}, raw: "{}\n" });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    res.status(500).json({
      error: "invalid_json_on_disk",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  // Re-validate so a hand-edited file with an out-of-range value gets
  // clamped/dropped before it reaches the UI form (the form would
  // otherwise echo it back into a future PR).
  const result = validateAppDefaults(parsed);
  if (!result.ok) {
    res.status(500).json({
      error: "invalid_app_defaults_on_disk",
      message: "Current app-defaults.json failed validation.",
      errors: result.errors,
    });
    return;
  }
  res.json({ value: result.value, raw: body });
});

router.post("/admin/app-defaults", async (req, res) => {
  const payload = req.body?.value as unknown;
  const summary = typeof req.body?.summary === "string" ? req.body.summary.trim() : "";
  if (!summary) {
    res.status(400).json({
      error: "missing_summary",
      message: "Provide a non-empty 'summary' (used for the PR title).",
    });
    return;
  }
  const result = validateAppDefaults(payload);
  if (!result.ok) {
    res.status(400).json({
      error: "invalid_payload",
      message: result.errors.join("; "),
      errors: result.errors,
    });
    return;
  }
  if (!githubConfigured()) {
    res.status(503).json({
      error: "github_not_configured",
      message: "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server.",
    });
    return;
  }

  // Stamp _meta server-side — the operator should not be able to forge
  // an arbitrary lastUpdated date in the committed file.
  const stamped: AppDefaults = stampMeta(result.value, "admin");
  const fileContent = renderAppDefaultsFile(stamped);
  const body = buildAppDefaultsPrBody(stamped, summary, fileContent);

  try {
    const pr = await openUpdateAppDefaultsPr({
      fileContent,
      summary: summary.slice(0, 100),
      body,
    });
    res.json({ ok: true, prUrl: pr.url, prNumber: pr.number });
  } catch (err) {
    res.status(502).json({
      error: "pr_creation_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

function buildAppDefaultsPrBody(
  value: AppDefaults,
  summary: string,
  fileContent: string,
): string {
  const lines: string[] = [];
  lines.push(`Updates global defaults: **${summary}**.`);
  lines.push("");
  lines.push(
    "Generated from the in-app admin pane. After merge + redeploy these values become the ship-wide defaults for risk-free rates, home-bias multipliers and CMA inputs. Per-user overrides from the Methodology editor still layer on top.",
  );
  lines.push("");
  lines.push("**New file content**");
  lines.push("");
  lines.push("```json");
  lines.push(fileContent.trimEnd());
  lines.push("```");
  lines.push("");
  lines.push("**Reviewer checklist**");
  lines.push("- Confirm RF rates are in [0%, 20%] and roughly match current money-market yields.");
  lines.push("- Confirm home-bias multipliers are in [0, 5].");
  lines.push("- Confirm CMA expReturn is in [-50%, 100%] and vol is in [0, 200%] for each touched asset.");
  lines.push("- Sanity-check the impact on the demo portfolios after merge.");
  // Reference the parsed value so a reviewer can spot a renamed currency
  // or missing key without reading the JSON byte-for-byte.
  if (value.riskFreeRates && Object.keys(value.riskFreeRates).length > 0) {
    lines.push("");
    lines.push(`Touched RF currencies: ${Object.keys(value.riskFreeRates).join(", ")}`);
  }
  if (value.homeBias && Object.keys(value.homeBias).length > 0) {
    lines.push(`Touched home-bias currencies: ${Object.keys(value.homeBias).join(", ")}`);
  }
  if (value.cma && Object.keys(value.cma).length > 0) {
    lines.push(`Touched CMA assets: ${Object.keys(value.cma).join(", ")}`);
  }
  return lines.join("\n");
}

// Re-export the data-dir helper for tests.
export const _internal = { resolveDataPath: resolve };

export default router;
