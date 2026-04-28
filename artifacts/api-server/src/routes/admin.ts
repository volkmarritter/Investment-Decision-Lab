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
import { createPatch } from "diff";
import { requireAdmin } from "../middlewares/admin-auth";
import { dataFile } from "../lib/data-paths";
import {
  githubConfigured,
  injectAlternative,
  listOpenPrs,
  openAddBucketAlternativePr,
  openBulkAddBucketAlternativesPr,
  openRemoveBucketAlternativePr,
  openAddEtfPr,
  openAddLookthroughPoolPr,
  openBulkAddLookthroughPoolPr,
  openUpdateAppDefaultsPr,
  renderAlternativeBlock,
  renderEntryBlock,
  type BulkBucketAltRowOutcome,
  type LookthroughPoolEntry,
  type NewAlternativeEntry,
  type NewEtfEntry,
} from "../lib/github";
import { findDuplicateIsinKey, loadCatalog } from "../lib/catalog-parser";
import { MAX_ALTERNATIVES_PER_BUCKET } from "../lib/limits";
import { getCatalogPath } from "../lib/data-paths";
import { scrapePreview, PreviewError, normalizeIsin } from "../lib/etf-scrape";
import { scrapeLookthrough } from "../lib/lookthrough-scrape";
import {
  getWorkspaceSyncStatus,
  syncWorkspaceFromMain,
} from "../lib/workspace-sync";
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
  // We surface owner/repo/baseBranch (but never the PAT) so the Admin UI
  // can render direct GitHub links to files and PR lists. The values come
  // from the api-server env — if any of them is missing, githubConfigured()
  // is false and the UI suppresses the links.
  res.json({
    ok: true,
    githubConfigured: githubConfigured(),
    githubOwner: process.env.GITHUB_OWNER ?? null,
    githubRepo: process.env.GITHUB_REPO ?? null,
    githubBaseBranch: process.env.GITHUB_BASE_BRANCH ?? "main",
  });
});

// --- /api/admin/github/prs ---------------------------------------------------
// Lists currently-open PRs on the configured GitHub repo. Uses the REST
// list-pulls endpoint (NOT the search API) so it stays correct even when
// GitHub's search index is lagging — that lag is what made the public
// /pulls page render "0 open" while the operator's PR was actually waiting
// to be merged (real bug 2026-04-27). The optional `prefix` query param
// scopes the list to a single admin flow:
//   ?prefix=add-lookthrough-pool/   — pool flow
//   ?prefix=add-etf/                — catalog flow
//   ?prefix=update-app-defaults/    — app-defaults flow
router.get("/admin/github/prs", async (req, res) => {
  const prefixRaw =
    typeof req.query.prefix === "string" ? req.query.prefix : "";
  const prefix = prefixRaw.length > 0 ? prefixRaw : undefined;
  if (!githubConfigured()) {
    res.json({ configured: false, prs: [] });
    return;
  }
  try {
    const prs = await listOpenPrs(prefix);
    res.json({ configured: true, prs });
  } catch (err: unknown) {
    res.status(502).json({
      configured: true,
      prs: [],
      message:
        err instanceof Error ? err.message : "GitHub list-prs request failed.",
    });
  }
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

// --- /api/admin/bucket-alternatives -----------------------------------------
// Per-bucket curated-alternatives editor (2026-04-28). Each bucket may
// expose 1 default + up to MAX_ALTERNATIVES_PER_BUCKET curated alternatives in the Build tab's ETF
// Implementation picker. The endpoints below let the operator audit and
// extend the alternatives list via the same PR-based flow already used
// for add-isin and app-defaults.
//
//   GET  /admin/bucket-alternatives        — same shape as /admin/catalog
//                                            but the `alternatives` array
//                                            on each entry is populated
//                                            (the catalog parser was
//                                            extended to surface them).
//   POST /admin/bucket-alternatives/render — preview the TS snippet that
//                                            would be inserted, byte-for-byte
//                                            identical to what the PR shows.
//   POST /admin/bucket-alternatives        — open a PR adding the entry
//                                            into the parent's `alternatives`
//                                            array (creating the array if
//                                            absent).
//
// All three reuse loadCatalog() / parseCatalogFromSource for the freshness
// guarantee — no separate cache, no drift between preview and PR diff.
router.get("/admin/bucket-alternatives", async (_req, res) => {
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

router.post("/admin/bucket-alternatives/render", (req, res) => {
  const parentKey = typeof req.body?.parentKey === "string"
    ? req.body.parentKey
    : "";
  const entry = req.body?.entry as NewAlternativeEntry | undefined;
  const validationError = validateAlternative(entry);
  if (validationError || !entry) {
    res.status(400).json({ error: "invalid_entry", message: validationError });
    return;
  }
  if (!parentKey || !/^[A-Z][A-Za-z0-9-]{2,40}$/.test(parentKey)) {
    res.status(400).json({
      error: "invalid_parent_key",
      message: "parentKey must match the catalog key format.",
    });
    return;
  }
  try {
    const code = renderAlternativeBlock(entry, "      ");
    res.json({ code });
  } catch (err) {
    res.status(500).json({
      error: "render_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/admin/bucket-alternatives", async (req, res) => {
  const parentKey = typeof req.body?.parentKey === "string"
    ? req.body.parentKey
    : "";
  const entry = req.body?.entry as NewAlternativeEntry | undefined;
  const validationError = validateAlternative(entry);
  if (validationError || !entry) {
    res.status(400).json({ error: "invalid_entry", message: validationError });
    return;
  }
  if (!parentKey || !/^[A-Z][A-Za-z0-9-]{2,40}$/.test(parentKey)) {
    res.status(400).json({
      error: "invalid_parent_key",
      message: "parentKey must match the catalog key format.",
    });
    return;
  }

  // Belt-and-braces server-side pre-flight (parent missing, ISIN dup,
  // alts cap). The /admin/bucket-alternatives PR helper performs the
  // same checks before opening the PR — duplicating them here returns a
  // typed 4xx instead of a generic 502 from the PR helper, which is
  // friendlier for the UI to render.
  try {
    const catalog = await loadCatalog();
    const parent = catalog[parentKey];
    if (!parent) {
      res.status(404).json({
        error: "parent_missing",
        message: `Parent bucket "${parentKey}" not found in catalog.`,
      });
      return;
    }
    const existingAlts = parent.alternatives ?? [];
    if (existingAlts.length >= MAX_ALTERNATIVES_PER_BUCKET) {
      res.status(409).json({
        error: "cap_exceeded",
        message: `"${parentKey}" already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives. Remove one first.`,
      });
      return;
    }
    const norm = entry.isin.trim().toUpperCase();
    for (const [k, e] of Object.entries(catalog)) {
      if (e.isin.toUpperCase() === norm) {
        res.status(409).json({
          error: "duplicate_isin",
          message: `ISIN ${entry.isin} is already used by catalog key "${k}". Pick a different ISIN.`,
          conflictKey: k,
        });
        return;
      }
      const alts = e.alternatives ?? [];
      for (let i = 0; i < alts.length; i++) {
        if (alts[i].isin.toUpperCase() === norm) {
          res.status(409).json({
            error: "duplicate_isin",
            message: `ISIN ${entry.isin} is already used by alternative slot ${i + 1} under "${k}". Pick a different ISIN.`,
            conflictKey: `${k} alt ${i + 1}`,
          });
          return;
        }
      }
    }
  } catch (err) {
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
    });
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

  let prUrl: string;
  let prNumber: number;
  try {
    const pr = await openAddBucketAlternativePr(parentKey, entry);
    prUrl = pr.url;
    prNumber = pr.number;
  } catch (err) {
    res.status(502).json({
      error: "pr_creation_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Best-effort: also gather look-through reference data for this ISIN
  // and open a separate look-through-pool PR. This makes the alt usable
  // immediately on day 1 (top holdings, geo, sector breakdowns) instead
  // of waiting for the next monthly refresh-lookthrough cron tick. The
  // two PRs are independent: if look-through scraping fails (no data,
  // already in pool, scrape error) the etfs.ts PR still stands and the
  // operator just sees a non-blocking message in the response.
  //
  // Why best-effort: requirement is "Look-through data should be
  // gathered for all alternatives". The monthly cron already covers
  // every ISIN in etfs.ts via regex extraction, so missing the immediate
  // scrape just means a one-cron-tick delay — never a permanent gap.
  let lookthroughPrUrl: string | undefined;
  let lookthroughPrNumber: number | undefined;
  let lookthroughError: string | undefined;
  // Positive signal: the ISIN is already covered by look-through data
  // (either committed in the base file, or live on the auto-refresh
  // pool). Distinct from `lookthroughError` so the UI can show a green
  // "data already available" line instead of a yellow "skipped" line.
  let lookthroughAlreadyPresent = false;
  let lookthroughAlreadyPresentSource:
    | "overrides"
    | "pool"
    | "base-file"
    | undefined;
  try {
    const norm = entry.isin.trim().toUpperCase();
    const sources = await readLookthroughSources();
    if (sources.pool[norm] || sources.overrides[norm]) {
      lookthroughAlreadyPresent = true;
      lookthroughAlreadyPresentSource = sources.overrides[norm]
        ? "overrides"
        : "pool";
    } else {
      const scraped = await scrapeLookthrough(norm);
      // Pull all four required fields into locals first so TS narrows
      // their type from `T | undefined` to `T` after the guard below.
      // Inline `&& length > 0` checks would compile but wouldn't narrow
      // the field types — see the existing /lookthrough-pool flow which
      // assumes presence implicitly.
      const top = scraped.topHoldings;
      const geo = scraped.geo;
      const sector = scraped.sector;
      const currency = scraped.currency;
      if (
        !top ||
        top.length === 0 ||
        !geo ||
        Object.keys(geo).length === 0 ||
        !sector ||
        Object.keys(sector).length === 0 ||
        !currency
      ) {
        lookthroughError = `Look-through-Scrape unvollständig für ${norm} — Methodology-Override-Daten fehlen, der Pool-PR wird übersprungen. Der monatliche Refresh-Job kann es später erneut versuchen.`;
      } else {
        const ltPr = await openAddLookthroughPoolPr({
          isin: norm,
          entry: {
            ...(scraped.name ? { name: scraped.name } : {}),
            topHoldings: top,
            topHoldingsAsOf: scraped.asOf,
            geo,
            sector,
            currency,
            breakdownsAsOf: scraped.asOf,
            _source: scraped.sourceUrl,
            _addedAt: scraped.asOf,
            _addedVia: "admin/bucket-alternatives (auto)",
          },
        });
        if (ltPr.alreadyInBaseFile) {
          // Race-window case: another PR landed on the base branch
          // between our pre-flight read and our PR attempt. Surface as
          // "already present" so the UI shows the same positive signal
          // as the pre-flight match path.
          lookthroughAlreadyPresent = true;
          lookthroughAlreadyPresentSource = "base-file";
        } else {
          lookthroughPrUrl = ltPr.url;
          lookthroughPrNumber = ltPr.number;
        }
      }
    }
  } catch (err) {
    lookthroughError = err instanceof Error ? err.message : String(err);
  }

  res.json({
    ok: true,
    prUrl,
    prNumber,
    ...(lookthroughPrUrl
      ? { lookthroughPrUrl, lookthroughPrNumber }
      : {}),
    ...(lookthroughAlreadyPresent
      ? {
          lookthroughAlreadyPresent: true,
          lookthroughAlreadyPresentSource,
        }
      : {}),
    ...(lookthroughError ? { lookthroughError } : {}),
  });
});

// --- /api/admin/bucket-alternatives/bulk -------------------------------------
// Batch-add curated alternatives in a SINGLE PR (Task #51, 2026-04-28).
//
// Body shape:
//   {
//     rows: Array<{
//       parentKey: string;
//       isin: string;
//       defaultExchange?: "LSE" | "XETRA" | "SIX" | "Euronext";
//       preferredExchange?: same;   // alias for defaultExchange
//       comment?: string;           // overrides scraped value
//     }>,
//     dryRun?: boolean;
//   }
//
// Per row we (a) scrape justETF for the standard fields (name, TER,
// domicile, listings, …) and (b) build a NewAlternativeEntry with the
// chosen exchange. Then we run the same dedup / cap / parent-exists
// checks the per-row endpoint runs, EXCEPT they're cumulative across
// the batch — two rows targeting the same bucket count toward the
// per-bucket cap, two rows with the same ISIN are flagged as dup.
//
// dryRun=true: returns the would-be etfs.ts content (whole-file, the UI
// can diff client-side), the planned look-through-pool entries, and the
// per-row outcome table. No PRs are opened, no scraping for look-through
// (that step is reserved for the real submit so the preview stays fast).
//
// dryRun=false (default): opens ONE etfs.ts PR for all rows whose
// preflight passed, then sequentially scrapes look-through for the
// added rows and opens AT MOST ONE companion look-through PR for those
// with complete data. Rows whose look-through scrape returns
// incomplete/already-present surface in the response under
// `lookthroughOutcomes` so the operator sees exactly which alts have
// data day-1 and which fall back to the monthly cron.
//
// The existing per-row endpoint POST /admin/bucket-alternatives is
// unchanged — operators still use it for ad-hoc one-offs.
router.post("/admin/bucket-alternatives/bulk", async (req, res) => {
  const dryRun = req.body?.dryRun === true;
  const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rawRows || rawRows.length === 0) {
    res.status(400).json({
      error: "missing_rows",
      message: "Body must include `rows: [...]` with at least one row.",
    });
    return;
  }
  if (rawRows.length > 50) {
    // Soft cap so a runaway client can't trigger 200+ scrapes in one
    // request. 50 is well above any realistic admin batch (operator
    // sittings produce ~5 rows in practice).
    res.status(400).json({
      error: "too_many_rows",
      message: `Batch size capped at 50 (received ${rawRows.length}).`,
    });
    return;
  }
  if (!dryRun && !githubConfigured()) {
    res.status(503).json({
      error: "github_not_configured",
      message:
        "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server.",
    });
    return;
  }

  // ---------------------------------------------------------------
  // 1. Catalog preflight — load once so every row is checked against
  //    the same snapshot, and so we can compute per-bucket cap usage
  //    cumulatively across the batch.
  // ---------------------------------------------------------------
  const catalog = await loadCatalog().catch((err) => {
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!catalog) return; // already responded above

  // Build the set of ISINs already in use anywhere in the catalog.
  const usedIsins = new Map<string, string>(); // isin → "<key>" or "<key> alt N"
  for (const [k, e] of Object.entries(catalog)) {
    usedIsins.set(e.isin.toUpperCase(), k);
    const alts = e.alternatives ?? [];
    for (let i = 0; i < alts.length; i++) {
      usedIsins.set(alts[i].isin.toUpperCase(), `${k} alt ${i + 1}`);
    }
  }
  // Per-bucket alt count (default + alternatives accumulated in batch).
  const bucketAltCount = new Map<string, number>();
  for (const [k, e] of Object.entries(catalog)) {
    bucketAltCount.set(k, (e.alternatives ?? []).length);
  }

  type BulkRowOutcome = {
    parentKey: string;
    isin: string;
    name?: string;
    status:
      | "ok"
      | "invalid_input"
      | "invalid_parent_key"
      | "invalid_isin"
      | "parent_missing"
      | "duplicate_isin"
      | "cap_exceeded"
      | "scrape_failed"
      | "invalid_entry"
      | "invalid_exchange";
    message?: string;
    conflict?: string;
    // Look-through outcome populated only on the real submit path. For
    // dryRun we expose `lookthroughPlan` (planned action without
    // performing the scrape).
    lookthroughPlan?: "would_scrape" | "already_present";
    lookthroughStatus?:
      | "pr_added"
      | "already_present"
      | "incomplete"
      | "scrape_failed"
      | "would_add";
    lookthroughMessage?: string;
  };

  const outcomes: BulkRowOutcome[] = [];
  // Rows that survived preflight + scrape and are ready to inject.
  const validatedRows: Array<{
    parentKey: string;
    entry: NewAlternativeEntry;
    outcomeIdx: number;
  }> = [];

  // Look-through pre-flight to classify "already covered" without
  // triggering a scrape. Used for dryRun's lookthroughPlan AND to skip
  // a duplicate scrape on submit.
  const lookthroughSources = await readLookthroughSources();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const parentKey =
      typeof raw?.parentKey === "string" ? raw.parentKey : "";
    const rawIsin = typeof raw?.isin === "string" ? raw.isin : "";
    const isin = rawIsin.trim().toUpperCase();
    const userExchange =
      typeof raw?.defaultExchange === "string"
        ? raw.defaultExchange
        : typeof raw?.preferredExchange === "string"
          ? raw.preferredExchange
          : undefined;
    const userComment =
      typeof raw?.comment === "string" ? raw.comment : undefined;

    const baseOutcome: BulkRowOutcome = {
      parentKey,
      isin,
      status: "ok",
    };

    if (!parentKey || !/^[A-Z][A-Za-z0-9-]{2,40}$/.test(parentKey)) {
      outcomes.push({
        ...baseOutcome,
        status: "invalid_parent_key",
        message: `parentKey "${parentKey}" doesn't match the catalog key format.`,
      });
      continue;
    }
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
      outcomes.push({
        ...baseOutcome,
        status: "invalid_isin",
        message: `ISIN "${rawIsin}" is not a valid ISO 6166 code.`,
      });
      continue;
    }
    if (!catalog[parentKey]) {
      outcomes.push({
        ...baseOutcome,
        status: "parent_missing",
        message: `Parent bucket "${parentKey}" does not exist in the catalog.`,
      });
      continue;
    }
    if (
      userExchange &&
      !["LSE", "XETRA", "SIX", "Euronext"].includes(userExchange)
    ) {
      outcomes.push({
        ...baseOutcome,
        status: "invalid_exchange",
        message: `defaultExchange "${userExchange}" is not one of LSE / XETRA / SIX / Euronext.`,
      });
      continue;
    }
    // Cumulative dup check: ISIN already in catalog OR already taken
    // by an earlier row in this same batch.
    const existing = usedIsins.get(isin);
    if (existing) {
      outcomes.push({
        ...baseOutcome,
        status: "duplicate_isin",
        message: `ISIN ${isin} is already used by "${existing}".`,
        conflict: existing,
      });
      continue;
    }
    // Cumulative cap check.
    if ((bucketAltCount.get(parentKey) ?? 0) >= MAX_ALTERNATIVES_PER_BUCKET) {
      outcomes.push({
        ...baseOutcome,
        status: "cap_exceeded",
        message: `"${parentKey}" already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives (counting earlier rows in this batch).`,
      });
      continue;
    }

    // Scrape justETF for the rest of the entry. Unlike the per-row
    // endpoint (which expects the operator to have fetched + edited
    // already) we MUST scrape here — the bulk row only carries
    // {parentKey, isin, defaultExchange?, comment?}. A scrape failure
    // turns into a per-row skip; the rest of the batch keeps going.
    let scrape: Awaited<ReturnType<typeof scrapePreview>>;
    try {
      scrape = await scrapePreview(isin);
    } catch (err) {
      outcomes.push({
        ...baseOutcome,
        status: "scrape_failed",
        message:
          err instanceof PreviewError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      });
      continue;
    }

    // Build the NewAlternativeEntry from the scrape + row overrides.
    const f = scrape.fields;
    const listings: NewAlternativeEntry["listings"] = {};
    if (scrape.listings && typeof scrape.listings === "object") {
      for (const ex of ["LSE", "XETRA", "SIX", "Euronext"] as const) {
        const v = (scrape.listings as Record<
          string,
          { ticker?: string } | undefined
        >)[ex];
        if (v?.ticker) listings[ex] = { ticker: v.ticker };
      }
    }
    const listingKeys = Object.keys(listings) as Array<
      keyof NewAlternativeEntry["listings"]
    >;
    if (listingKeys.length === 0) {
      outcomes.push({
        ...baseOutcome,
        status: "scrape_failed",
        message: `justETF returned no listings for ${isin} — cannot pick a default exchange.`,
      });
      continue;
    }
    const chosenExchange =
      (userExchange as keyof NewAlternativeEntry["listings"] | undefined) &&
      listings[
        userExchange as keyof NewAlternativeEntry["listings"]
      ]
        ? (userExchange as keyof NewAlternativeEntry["listings"])
        : listingKeys[0];

    const replication = ((): NewAlternativeEntry["replication"] => {
      const s = String(f.replication ?? "").toLowerCase();
      if (s.includes("sampl")) return "Physical (sampled)";
      if (s.includes("synth") || s.includes("swap")) return "Synthetic";
      return "Physical";
    })();
    const distribution = ((): NewAlternativeEntry["distribution"] => {
      const s = String(f.distribution ?? "").toLowerCase();
      if (s.startsWith("dist")) return "Distributing";
      return "Accumulating";
    })();

    const entry: NewAlternativeEntry = {
      name: typeof f.name === "string" ? (f.name as string) : "",
      isin,
      terBps: typeof f.terBps === "number" ? (f.terBps as number) : 0,
      domicile:
        typeof f.domicile === "string" ? (f.domicile as string) : "Ireland",
      replication,
      distribution,
      currency: typeof f.currency === "string" ? (f.currency as string) : "USD",
      comment: userComment ?? "",
      defaultExchange: chosenExchange as NewAlternativeEntry["defaultExchange"],
      listings,
      ...(typeof f.aumMillionsEUR === "number"
        ? { aumMillionsEUR: f.aumMillionsEUR as number }
        : {}),
      ...(typeof f.inceptionDate === "string"
        ? { inceptionDate: f.inceptionDate as string }
        : {}),
    };

    const validation = validateAlternative(entry);
    if (validation) {
      outcomes.push({
        ...baseOutcome,
        name: entry.name,
        status: "invalid_entry",
        message: validation,
      });
      continue;
    }

    // Survived everything — provisionally accept. Update cumulative
    // trackers so subsequent rows respect this row's effect on the
    // catalog.
    usedIsins.set(isin, parentKey);
    bucketAltCount.set(parentKey, (bucketAltCount.get(parentKey) ?? 0) + 1);
    const lookthroughCovered = Boolean(
      lookthroughSources.overrides[isin] || lookthroughSources.pool[isin],
    );
    const idx = outcomes.length;
    outcomes.push({
      ...baseOutcome,
      name: entry.name,
      status: "ok",
      lookthroughPlan: lookthroughCovered ? "already_present" : "would_scrape",
    });
    validatedRows.push({ parentKey, entry, outcomeIdx: idx });
  }

  // ---------------------------------------------------------------
  // 2. Dry-run: build the would-be etfs.ts content + (after a real
  //    look-through scrape pass for any ISIN we'd need to fetch) the
  //    would-be lookthrough.overrides.json content. Return both as
  //    unified diffs so the operator can verify exactly what each PR
  //    would touch before submitting.
  // ---------------------------------------------------------------
  if (dryRun) {
    let etfsBaseContent = "";
    let etfsNextContent = "";
    try {
      etfsBaseContent = await readFile(getCatalogPath(), "utf8");
      etfsNextContent = etfsBaseContent;
      for (const row of validatedRows) {
        const result = injectAlternative(
          etfsNextContent,
          row.parentKey,
          row.entry,
        );
        if (result.status === "ok") {
          etfsNextContent = result.content;
        } else {
          // Should not happen — preflight already filtered these. Mark
          // the outcome so the operator sees the divergence.
          outcomes[row.outcomeIdx].status =
            result.status === "parent_missing"
              ? "parent_missing"
              : result.status === "isin_present"
                ? "duplicate_isin"
                : "cap_exceeded";
          outcomes[row.outcomeIdx].message = `injectAlternative refused: ${result.status}${result.conflict ? ` (${result.conflict})` : ""}`;
        }
      }
    } catch (err) {
      res.status(500).json({
        error: "preview_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Scrape look-through for every still-ok row that doesn't already
    // have coverage in the local lookthrough.overrides.json. Per-row
    // failures (incomplete profile, network) are surfaced through the
    // outcome's lookthroughStatus instead of failing the whole preview.
    const lookthroughEntries: Array<{
      isin: string;
      entry: LookthroughPoolEntry;
      outcomeIdx: number;
    }> = [];
    for (const row of validatedRows) {
      const o = outcomes[row.outcomeIdx];
      if (o.status !== "ok") continue;
      const isin = row.entry.isin;
      if (
        lookthroughSources.overrides[isin] ||
        lookthroughSources.pool[isin]
      ) {
        o.lookthroughStatus = "already_present";
        o.lookthroughMessage =
          "Look-through data already covered (no scrape needed).";
        continue;
      }
      try {
        const scraped = await scrapeLookthrough(isin);
        const top = scraped.topHoldings;
        const geo = scraped.geo;
        const sector = scraped.sector;
        const currency = scraped.currency;
        if (
          !top ||
          top.length === 0 ||
          !geo ||
          Object.keys(geo).length === 0 ||
          !sector ||
          Object.keys(sector).length === 0 ||
          !currency
        ) {
          o.lookthroughStatus = "incomplete";
          o.lookthroughMessage =
            "justETF returned an incomplete look-through profile — the monthly refresh job will retry.";
          continue;
        }
        lookthroughEntries.push({
          isin,
          entry: {
            ...(scraped.name ? { name: scraped.name } : {}),
            topHoldings: top,
            topHoldingsAsOf: scraped.asOf,
            geo,
            sector,
            currency,
            breakdownsAsOf: scraped.asOf,
            _source: scraped.sourceUrl,
            _addedAt: scraped.asOf,
            _addedVia: "admin/bucket-alternatives/bulk (preview)",
          },
          outcomeIdx: row.outcomeIdx,
        });
        o.lookthroughStatus = "would_add";
      } catch (err) {
        o.lookthroughStatus = "scrape_failed";
        o.lookthroughMessage = err instanceof Error ? err.message : String(err);
      }
    }

    // Build base + next content for lookthrough.overrides.json. The
    // file is a JSON document with at least { pool: {...} }; we mirror
    // the bulk PR helper's behaviour by inserting under pool[isin].
    let ltBaseContent = "";
    let ltNextContent = "";
    try {
      ltBaseContent = await readFile(
        dataFile("lookthrough.overrides.json"),
        "utf8",
      );
      const parsed = JSON.parse(ltBaseContent) as Record<string, unknown>;
      const pool = (parsed.pool ??= {}) as Record<string, unknown>;
      const overrides = (parsed.overrides ?? {}) as Record<string, unknown>;
      let injected = 0;
      for (const e of lookthroughEntries) {
        if (overrides[e.isin] || pool[e.isin]) continue;
        pool[e.isin] = e.entry;
        injected++;
      }
      ltNextContent =
        injected > 0
          ? `${JSON.stringify(parsed, null, 2)}\n`
          : ltBaseContent;
    } catch (err) {
      // Lookthrough file malformed → skip diff but don't abort the
      // whole preview; the etfs.ts diff is still useful.
      ltBaseContent = "";
      ltNextContent = "";
      console.warn(
        "[bucket-alternatives/bulk dryRun] lookthrough preview skipped:",
        err instanceof Error ? err.message : String(err),
      );
    }

    const etfsDiff = createPatch(
      "artifacts/investment-lab/src/lib/etfs.ts",
      etfsBaseContent,
      etfsNextContent,
      "origin/main",
      "preview",
      { context: 3 },
    );
    const ltDiff =
      ltBaseContent && ltNextContent && ltBaseContent !== ltNextContent
        ? createPatch(
            "artifacts/investment-lab/src/data/lookthrough.overrides.json",
            ltBaseContent,
            ltNextContent,
            "origin/main",
            "preview",
            { context: 3 },
          )
        : "";

    const woldAdd = outcomes.filter((o) => o.status === "ok");
    const wouldScrapeLookthrough = lookthroughEntries.length;
    res.json({
      ok: true,
      dryRun: true,
      perRow: outcomes,
      summary: {
        total: outcomes.length,
        wouldAdd: woldAdd.length,
        wouldSkip: outcomes.length - woldAdd.length,
        wouldScrapeLookthrough,
      },
      etfs: {
        path: "artifacts/investment-lab/src/lib/etfs.ts",
        baseContent: etfsBaseContent,
        nextContent: etfsNextContent,
        diff: etfsDiff,
        changed: etfsBaseContent !== etfsNextContent,
      },
      lookthrough: {
        path: "artifacts/investment-lab/src/data/lookthrough.overrides.json",
        baseContent: ltBaseContent,
        nextContent: ltNextContent,
        diff: ltDiff,
        changed: Boolean(ltDiff),
        wouldAddIsins: lookthroughEntries.map((e) => ({
          isin: e.isin,
          name: (e.entry as { name?: string }).name ?? null,
        })),
        alreadyPresent: outcomes
          .filter((o) => o.lookthroughStatus === "already_present")
          .map((o) => ({ isin: o.isin, name: o.name ?? null })),
      },
    });
    return;
  }

  // ---------------------------------------------------------------
  // 3. Real submit: open ONE etfs.ts PR for all valid rows, then
  //    sequentially scrape look-through for those without coverage
  //    and open ONE companion PR for the complete results.
  // ---------------------------------------------------------------
  if (validatedRows.length === 0) {
    res.status(422).json({
      error: "no_valid_rows",
      message:
        "None of the submitted rows passed validation. See `perRow` for per-row reasons.",
      perRow: outcomes,
    });
    return;
  }

  let prUrl: string;
  let prNumber: number;
  let prRowOutcomes: BulkBucketAltRowOutcome[] = [];
  try {
    const pr = await openBulkAddBucketAlternativesPr({
      rows: validatedRows.map((r) => ({
        parentKey: r.parentKey,
        entry: r.entry,
      })),
    });
    prUrl = pr.url;
    prNumber = pr.number;
    prRowOutcomes = pr.perRow;
  } catch (err) {
    res.status(502).json({
      error: "pr_creation_failed",
      message: err instanceof Error ? err.message : String(err),
      perRow: outcomes,
    });
    return;
  }

  // Reconcile injectAlternative's per-row outcomes back onto the
  // operator-facing outcomes array. The PR helper might have surfaced
  // a race-window dup or cap that wasn't visible at preflight time
  // (extremely unlikely but possible if etfs.ts on origin has moved
  // between our loadCatalog and the PR open).
  for (let i = 0; i < validatedRows.length; i++) {
    const v = validatedRows[i];
    const prRow = prRowOutcomes[i];
    if (!prRow || prRow.status === "ok") continue;
    outcomes[v.outcomeIdx].status =
      prRow.status === "parent_missing"
        ? "parent_missing"
        : prRow.status === "isin_present"
          ? "duplicate_isin"
          : "cap_exceeded";
    outcomes[v.outcomeIdx].message = `Race condition vs origin/${process.env.GITHUB_BASE_BRANCH ?? "main"}: ${prRow.status}${prRow.conflict ? ` (${prRow.conflict})` : ""}`;
    if (prRow.conflict) outcomes[v.outcomeIdx].conflict = prRow.conflict;
  }

  // Look-through pass. For each row that's still "ok" AND not already
  // covered, scrape and collect complete entries. We open at most ONE
  // bulk look-through PR for the lot.
  const lookthroughEntries: Array<{
    isin: string;
    entry: LookthroughPoolEntry;
    outcomeIdx: number;
  }> = [];
  const stillOkRows = validatedRows.filter(
    (_, i) => prRowOutcomes[i]?.status === "ok",
  );
  for (const v of stillOkRows) {
    const isin = v.entry.isin;
    const o = outcomes[v.outcomeIdx];
    if (lookthroughSources.overrides[isin] || lookthroughSources.pool[isin]) {
      o.lookthroughStatus = "already_present";
      o.lookthroughMessage = "Look-through data already covered (no scrape needed).";
      continue;
    }
    try {
      const scraped = await scrapeLookthrough(isin);
      const top = scraped.topHoldings;
      const geo = scraped.geo;
      const sector = scraped.sector;
      const currency = scraped.currency;
      if (
        !top ||
        top.length === 0 ||
        !geo ||
        Object.keys(geo).length === 0 ||
        !sector ||
        Object.keys(sector).length === 0 ||
        !currency
      ) {
        o.lookthroughStatus = "incomplete";
        o.lookthroughMessage =
          "justETF returned an incomplete look-through profile — the monthly refresh job will retry.";
        continue;
      }
      lookthroughEntries.push({
        isin,
        entry: {
          ...(scraped.name ? { name: scraped.name } : {}),
          topHoldings: top,
          topHoldingsAsOf: scraped.asOf,
          geo,
          sector,
          currency,
          breakdownsAsOf: scraped.asOf,
          _source: scraped.sourceUrl,
          _addedAt: scraped.asOf,
          _addedVia: "admin/bucket-alternatives/bulk",
        },
        outcomeIdx: v.outcomeIdx,
      });
    } catch (err) {
      o.lookthroughStatus = "scrape_failed";
      o.lookthroughMessage = err instanceof Error ? err.message : String(err);
    }
  }

  let lookthroughPrUrl: string | undefined;
  let lookthroughPrNumber: number | undefined;
  let lookthroughError: string | undefined;
  if (lookthroughEntries.length > 0) {
    try {
      const ltPr = await openBulkAddLookthroughPoolPr({
        entries: lookthroughEntries.map((e) => ({
          isin: e.isin,
          entry: e.entry,
        })),
      });
      lookthroughPrUrl = ltPr.url;
      lookthroughPrNumber = ltPr.number;
      // Mark added rows.
      const addedSet = new Set(ltPr.added);
      const skippedSet = new Set(ltPr.skippedAlreadyPresent);
      for (const e of lookthroughEntries) {
        const o = outcomes[e.outcomeIdx];
        if (addedSet.has(e.isin)) {
          o.lookthroughStatus = "pr_added";
        } else if (skippedSet.has(e.isin)) {
          o.lookthroughStatus = "already_present";
          o.lookthroughMessage =
            "Already in base file at PR-open time (race window).";
        }
      }
    } catch (err) {
      lookthroughError = err instanceof Error ? err.message : String(err);
      for (const e of lookthroughEntries) {
        outcomes[e.outcomeIdx].lookthroughStatus = "scrape_failed";
        outcomes[e.outcomeIdx].lookthroughMessage = lookthroughError;
      }
    }
  }

  res.json({
    ok: true,
    dryRun: false,
    prUrl,
    prNumber,
    ...(lookthroughPrUrl
      ? { lookthroughPrUrl, lookthroughPrNumber }
      : {}),
    ...(lookthroughError ? { lookthroughError } : {}),
    perRow: outcomes,
    summary: {
      total: outcomes.length,
      added: outcomes.filter((o) => o.status === "ok").length,
      skipped: outcomes.filter((o) => o.status !== "ok").length,
      lookthroughAdded: outcomes.filter(
        (o) => o.lookthroughStatus === "pr_added",
      ).length,
      lookthroughAlreadyPresent: outcomes.filter(
        (o) => o.lookthroughStatus === "already_present",
      ).length,
      lookthroughSkipped: outcomes.filter(
        (o) =>
          o.lookthroughStatus === "incomplete" ||
          o.lookthroughStatus === "scrape_failed",
      ).length,
    },
  });
});

// --- /api/admin/workspace-sync ----------------------------------------------
// Operator-initiated workspace sync (Task #51, 2026-04-28).
//
// GET  → snapshot of HEAD sha, branch, behind/ahead vs origin/main,
//        dirty workdir counts, and whether `.git/index.lock` is sitting
//        around. Returns INSTANTLY without contacting the network — the
//        behind/ahead counters reflect the locally cached origin ref
//        (i.e. the result of the last successful fetch). The operator
//        triggers a fresh fetch on demand via the dedicated POST below
//        (Task #54, 2026-04-28: previously we ran `git fetch` on every
//        GET which always failed — and briefly hung the panel — in
//        sandboxes with no `origin` remote).
// POST /admin/workspace-sync/fetch → runs `git fetch origin <base>` and
//        returns the same status payload with the freshly-updated
//        behind/ahead counters. Sets `fetchAttempted: true` so the UI
//        knows to render the (success or failure) result.
// POST /admin/workspace-sync       → runs `git fetch origin <base>` then
//        `git merge --ff-only`. On success returns
//        { ok, oldSha, newSha, changedFiles[] }. On refusal returns 409
//        with a typed `reason` and a plain-language `message` the UI
//        renders verbatim. Refusal categories:
//          - not_a_git_checkout    (production bundle, no .git)
//          - uncommitted_changes   (staged or modified files in workdir)
//          - index_lock_present    (.git/index.lock blocks the merge)
//          - fetch_failed          (network / auth)
//          - non_fast_forward      (local has commits not on origin)
//          - merge_failed          (anything else from git)
//
// We never auto-fix: a stale lock might still be in use by another git
// process; uncommitted edits might be the operator's WIP. Surface the
// situation, suggest the next step, let the operator act.
router.get("/admin/workspace-sync", async (_req, res) => {
  try {
    const status = await getWorkspaceSyncStatus({ fetch: false });
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: "workspace_sync_status_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// On-demand fetch: triggers `git fetch origin <base>` and returns the
// refreshed status. Defined BEFORE the catch-all POST below so Express
// matches the more specific path first.
router.post("/admin/workspace-sync/fetch", async (_req, res) => {
  try {
    const status = await getWorkspaceSyncStatus({ fetch: true });
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: "workspace_sync_fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/admin/workspace-sync", async (_req, res) => {
  try {
    const result = await syncWorkspaceFromMain();
    if (result.ok) {
      res.json(result);
      return;
    }
    // Map refusal reason → HTTP status. 503 for "no git at all" since
    // there's nothing the operator can do from this environment;
    // everything else is a 409 Conflict (the operator can resolve it).
    const status =
      result.reason === "not_a_git_checkout" ? 503 : 409;
    res.status(status).json({
      error: result.reason,
      message: result.message,
      ...(result.detail ? { detail: result.detail } : {}),
    });
  } catch (err) {
    res.status(500).json({
      error: "workspace_sync_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// DELETE /admin/bucket-alternatives/:parentKey/:isin — opens a PR that
// removes the alternative from etfs.ts only. The ETF's look-through
// profile in lookthrough.overrides.json is intentionally untouched
// (operator-promised contract: "remove from picker, keep in pool").
router.delete("/admin/bucket-alternatives/:parentKey/:isin", async (req, res) => {
  const parentKey = String(req.params.parentKey ?? "");
  if (!parentKey || !/^[A-Z][A-Za-z0-9-]{2,40}$/.test(parentKey)) {
    res.status(400).json({
      error: "invalid_parent_key",
      message: "parentKey must match the catalog key format.",
    });
    return;
  }
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
    const catalog = await loadCatalog();
    const parent = catalog[parentKey];
    if (!parent) {
      res.status(404).json({
        error: "parent_missing",
        message: `Parent bucket "${parentKey}" not found in catalog.`,
      });
      return;
    }
    const alts = parent.alternatives ?? [];
    const found = alts.find((a) => a.isin.toUpperCase() === isin);
    if (!found) {
      res.status(404).json({
        error: "isin_not_found",
        message: `ISIN ${isin} is not an alternative under "${parentKey}".`,
      });
      return;
    }
  } catch (err) {
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
    });
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

  try {
    const pr = await openRemoveBucketAlternativePr(parentKey, isin);
    res.json({ ok: true, prUrl: pr.url, prNumber: pr.number });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) {
      res.status(409).json({ error: "pr_already_open", message: msg });
      return;
    }
    res.status(502).json({
      error: "pr_creation_failed",
      message: msg,
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
        // Offizieller ETF-Name (vom justETF-Scrape persistiert). Nur in
        // pool-Einträgen befüllt — overrides-only-Einträge sind die
        // kuratierte PROFILES-Baseline und nutzen die Katalog-Namen aus
        // etfs.ts (das Frontend joint dort). Pool gewinnt bei Kollision.
        name: p?.name ?? o?.name ?? null,
        topHoldingsAsOf: src.topHoldingsAsOf ?? null,
        breakdownsAsOf: src.breakdownsAsOf ?? null,
        topHoldingCount: src.topHoldings?.length ?? 0,
        geoCount: src.geo ? Object.keys(src.geo).length : 0,
        sectorCount: src.sector ? Object.keys(src.sector).length : 0,
      };
    });
    // Primär nach Quelle gruppieren (Auto-Refresh zuerst, dann Beide,
    // dann Kuratiert), sekundär nach ISIN. So sieht der Operator alle
    // dynamisch gescrapeten Einträge zusammen oben — genau die, für die
    // der gescrapete Name die einzige Identifikation ist.
    const sourceRank: Record<typeof entries[number]["source"], number> = {
      pool: 0,
      both: 1,
      overrides: 2,
    };
    entries.sort((a, b) => {
      const r = sourceRank[a.source] - sourceRank[b.source];
      return r !== 0 ? r : a.isin.localeCompare(b.isin);
    });
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
  // PR-basiert (umgestellt am 2026-04-27): vorher hat dieser Handler
  // direkt auf die Disk geschrieben (`writeFile(...)`). Das war doppelt
  // kaputt: (1) die Schreibvorgänge auf dem Production-api-server-Container
  // waren ephemer und gingen beim nächsten Restart verloren; (2) das
  // Frontend bundlet `lookthrough.overrides.json` zur Build-Zeit, hätte
  // also die neuen Einträge ohnehin nie gesehen — die Methodology-
  // Tausch-Ansicht zeigte weiterhin "no look-through data on file"
  // während die Admin-Tabelle "Daten OK" behauptete.
  // Jetzt: GitHub-PR öffnen (gleicher Pattern wie /admin/app-defaults).
  // Nach Merge + Redeploy sehen Admin und Frontend dieselben Daten.
  if (!githubConfigured()) {
    res.status(503).json({
      error: "github_not_configured",
      message: "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server.",
    });
    return;
  }

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
    // Lokale Disk-Datei vorab als Schnell-Check für offensichtliche
    // Duplikate (sieht z.B. ein bereits gemergtes Dev-Add). Der
    // verbindliche Duplikat-Check passiert weiter unten gegen den
    // base-Branch-Inhalt im PR-Helper, da nur dort die Wahrheit liegt
    // (lokales File kann veraltet sein).
    const localBoth = await readLookthroughSources();
    if (localBoth.pool[isin] || localBoth.overrides[isin]) {
      res.status(409).json({
        error: "already_in_pool",
        message: `ISIN ${isin} ist bereits im Datenpool (lokale Bundle-Datei). Der monatliche Refresh-Job aktualisiert die Daten automatisch.`,
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
      Object.keys(scraped.sector).length === 0 ||
      !scraped.currency
    ) {
      res.status(422).json({
        error: "incomplete_lookthrough_data",
        message: `Daten unvollständig für ${isin}: ${[
          (!scraped.topHoldings || scraped.topHoldings.length === 0) &&
            "Top-Holdings",
          (!scraped.geo || Object.keys(scraped.geo).length === 0) && "Geo",
          (!scraped.sector || Object.keys(scraped.sector).length === 0) &&
            "Sektor",
          !scraped.currency && "Währung",
        ]
          .filter(Boolean)
          .join(", ")} fehlen. Methodology-Overrides brauchen alle drei.`,
      });
      return;
    }

    const pr = await openAddLookthroughPoolPr({
      isin,
      entry: {
        // Offizieller ETF-Name vom justETF-Profilkopf — wird im Admin-
        // Pool-Tabellen-Render neben der ISIN angezeigt, damit Auto-
        // Refresh-Einträge (nicht im Katalog) identifizierbar sind.
        ...(scraped.name ? { name: scraped.name } : {}),
        topHoldings: scraped.topHoldings,
        topHoldingsAsOf: scraped.asOf,
        geo: scraped.geo,
        sector: scraped.sector,
        currency: scraped.currency,
        breakdownsAsOf: scraped.asOf,
        _source: scraped.sourceUrl,
        _addedAt: scraped.asOf,
        _addedVia: "admin/lookthrough-pool",
      },
    });
    if (pr.alreadyInBaseFile) {
      res.status(409).json({
        error: "already_in_pool",
        message: `ISIN ${isin} ist bereits im Datenpool auf dem Base-Branch (overrides oder pool). Kein PR nötig.`,
      });
      return;
    }

    res.status(201).json({
      ok: true,
      isin,
      topHoldingCount: scraped.topHoldings.length,
      geoCount: Object.keys(scraped.geo).length,
      sectorCount: Object.keys(scraped.sector).length,
      asOf: scraped.asOf,
      sourceUrl: scraped.sourceUrl,
      prUrl: pr.url,
      prNumber: pr.number,
      note: "PR geöffnet. Nach Merge + Redeploy sehen sowohl die Admin-Tabelle als auch die Methodology-Tausch-Ansicht diese ISIN.",
    });
  } catch (err) {
    if (err instanceof PreviewError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    // Architect-Review-Folge-Fix (2026-04-27): Wenn der deterministische
    // PR-Branch `add-lookthrough-pool/{isin}` bereits existiert (offener PR
    // wartet noch auf Review/Merge), wirft `openAddLookthroughPoolPr` einen
    // Error mit der Phrase "already exists". Statt das als generischen 500
    // zu surfacen, mappen wir auf 409 Conflict — semantisch korrekt und
    // erlaubt dem Frontend, den Operator klar zu informieren ("PR steht
    // schon offen, bitte erst mergen").
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) {
      res.status(409).json({
        error: "pr_already_open",
        message: msg,
      });
      return;
    }
    res.status(500).json({
      error: "internal",
      message: msg,
    });
  }
});

// POST /admin/lookthrough-pool/backfill — scan the catalog for ISINs
// that are NOT yet in `overrides` or `pool`, scrape each from justETF,
// and open ONE PR adding all complete results to `pool` at once.
//
// Why one PR (not N): a flat 15-20 PR queue is hostile to review.
// One PR with a clear ISIN list is easier to audit and merge.
//
// Why not just wait for the monthly cron: the cron fills `pool` once a
// month. Operators often add new ETFs and want look-through data
// available the next day, not 30 days later. This endpoint gives them
// the manual lever.
//
// Long-running: ~1-2 minutes for 15-20 ISINs at ~5s scrape each. We do
// scrapes sequentially (justETF rate-limit politeness) so the operator
// gets a single deterministic summary rather than partial parallel
// failures. Express server timeout handles the upper bound.
// NB: path is `/admin/backfill-lookthrough-pool` (NOT
// `/admin/lookthrough-pool/backfill`) — the latter would collide with
// the parameterised route `POST /admin/lookthrough-pool/:isin`
// registered earlier; Express would match `:isin = "backfill"` and the
// bulk handler would be unreachable.
router.post("/admin/backfill-lookthrough-pool", async (_req, res) => {
  if (!githubConfigured()) {
    res.status(503).json({
      error: "github_not_configured",
      message: "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server.",
    });
    return;
  }

  // 1. Catalog ISINs (defaults + alternatives), de-duplicated.
  let catalogIsins: string[];
  try {
    const catalog = await loadCatalog();
    const set = new Set<string>();
    for (const entry of Object.values(catalog)) {
      if (entry?.isin) set.add(entry.isin.toUpperCase());
      for (const alt of entry?.alternatives ?? []) {
        if (alt?.isin) set.add(alt.isin.toUpperCase());
      }
    }
    catalogIsins = [...set];
  } catch (err) {
    res.status(500).json({
      error: "catalog_parse_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 2. Filter to those NOT already covered by look-through data.
  const sources = await readLookthroughSources();
  const have = new Set([
    ...Object.keys(sources.overrides),
    ...Object.keys(sources.pool),
  ]);
  const missing = catalogIsins.filter((i) => !have.has(i));

  if (missing.length === 0) {
    res.json({
      ok: true,
      scanned: catalogIsins.length,
      missing: 0,
      attempted: [],
      added: [],
      skippedAlreadyPresent: [],
      scrapeFailures: [],
    });
    return;
  }

  // 3. Scrape each missing ISIN sequentially. Collect both successes
  //    (entries ready for the PR) and per-ISIN failures (incomplete
  //    scrape, network error, justETF returned nothing).
  type ScrapeFailure = { isin: string; reason: string };
  const entries: Array<{ isin: string; entry: LookthroughPoolEntry }> = [];
  const scrapeFailures: ScrapeFailure[] = [];
  for (const isin of missing) {
    try {
      const scraped = await scrapeLookthrough(isin);
      const top = scraped.topHoldings;
      const geo = scraped.geo;
      const sector = scraped.sector;
      const currency = scraped.currency;
      if (
        !top ||
        top.length === 0 ||
        !geo ||
        Object.keys(geo).length === 0 ||
        !sector ||
        Object.keys(sector).length === 0 ||
        !currency
      ) {
        const missingFields = [
          (!top || top.length === 0) && "Top-Holdings",
          (!geo || Object.keys(geo).length === 0) && "Geo",
          (!sector || Object.keys(sector).length === 0) && "Sektor",
          !currency && "Währung",
        ]
          .filter(Boolean)
          .join(", ");
        scrapeFailures.push({
          isin,
          reason: `Scrape unvollständig — fehlende Felder: ${missingFields}`,
        });
        continue;
      }
      entries.push({
        isin,
        entry: {
          ...(scraped.name ? { name: scraped.name } : {}),
          topHoldings: top,
          topHoldingsAsOf: scraped.asOf,
          geo,
          sector,
          currency,
          breakdownsAsOf: scraped.asOf,
          _source: scraped.sourceUrl,
          _addedAt: scraped.asOf,
          _addedVia: "admin/lookthrough-pool/backfill",
        },
      });
    } catch (err) {
      scrapeFailures.push({
        isin,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (entries.length === 0) {
    res.status(422).json({
      error: "no_complete_scrapes",
      message: `Keine der ${missing.length} fehlenden ISINs lieferte vollständige Look-through-Daten. Kein PR geöffnet.`,
      scanned: catalogIsins.length,
      missing: missing.length,
      attempted: missing,
      scrapeFailures,
    });
    return;
  }

  // 4. Open one PR with all complete entries.
  try {
    const pr = await openBulkAddLookthroughPoolPr({ entries });
    res.json({
      ok: true,
      scanned: catalogIsins.length,
      missing: missing.length,
      attempted: missing,
      added: pr.added,
      skippedAlreadyPresent: pr.skippedAlreadyPresent,
      scrapeFailures,
      prUrl: pr.url,
      prNumber: pr.number,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) {
      res.status(409).json({
        error: "pr_already_open",
        message: msg,
        scrapeFailures,
      });
      return;
    }
    res.status(502).json({
      error: "pr_creation_failed",
      message: msg,
      scrapeFailures,
    });
  }
});

type LookthroughEntryShape = {
  // Optional in the on-disk shape because pool-only entries write it
  // (auto-refresh persists the justETF profile name) but legacy
  // overrides-only entries omit it. The Auto-Refresh table joins both
  // sections and reads the name from whichever source carries it.
  name?: string;
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

// Strict schema for /admin/bucket-alternatives payloads. Mirrors
// validateEntry but omits the `key` field (alternatives are positional)
// and applies the same defence-in-depth rules to every other field so
// an injected alt cannot bypass any check the top-level entry must pass.
function validateAlternative(e: NewAlternativeEntry | undefined): string | null {
  if (!e || typeof e !== "object") return "entry missing";
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
