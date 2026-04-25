#!/usr/bin/env node
// ----------------------------------------------------------------------------
// refresh-justetf.mjs
// ----------------------------------------------------------------------------
// Pulls a small set of per-ISIN reference fields from justETF for every ETF
// listed in src/lib/etfs.ts and writes the result into
// src/data/etfs.overrides.json. The override layer in src/lib/etfs.ts then
// shallow-merges those values on top of the curated CATALOG, so the engine
// keeps working with no live network call at runtime.
//
// Two refresh modes (run by separate CI schedules — see .github/workflows/):
//   - core      Weekly cadence. Refreshes slow-moving fund metadata:
//               terBps, aumMillionsEUR, inceptionDate, distribution,
//               replication.
//   - listings  Nightly cadence. Refreshes the per-exchange ticker map for
//               LSE / XETRA / SIX / Euronext.
//   - all       Runs both groups (default when no --mode flag is given).
//
// Usage (from artifacts/investment-lab):
//   node scripts/refresh-justetf.mjs                           # all fields, all ISINs
//   node scripts/refresh-justetf.mjs --mode=core               # weekly snapshot
//   node scripts/refresh-justetf.mjs --mode=listings           # nightly listings
//   node scripts/refresh-justetf.mjs IE00B5BMR087              # one ISIN, all fields
//   node scripts/refresh-justetf.mjs --mode=core IE00B5BMR087  # one ISIN, core only
//   DRY_RUN=1 node scripts/refresh-justetf.mjs                 # don't write JSON
//
// Notes
// - This is an unofficial scrape of justETF's public English ETF profile pages.
//   Be polite: a 1.5s delay is enforced between requests, and the script will
//   abort cleanly if more than half of the pages fail to parse instead of
//   writing junk.
// - HTML structure can change. If a single extractor stops matching for an
//   ISIN, the previous value for that field is preserved (no clobber) and the
//   ISIN is only counted as a failure when *no* field could be extracted.
// - Editorial comment, defaultExchange and the geo / sector / currency
//   look-through breakdowns are intentionally NOT scraped here — they stay
//   curated in code (defaultExchange in src/lib/etfs.ts, look-through in
//   src/lib/lookthrough.ts). Top-10 holdings are refreshed monthly by
//   scripts/refresh-lookthrough.mjs.
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { appendRunLogEntry } from "./lib/run-log.mjs";
import { computeFieldChanges, appendChangeEntries } from "./lib/diff-overrides.mjs";
// All scraping logic lives in scripts/lib/justetf-extract.mjs as a PURE
// module so the api-server can import it without dragging this CLI
// entrypoint (and its main()) into its esbuild bundle.
import {
  USER_AGENT,
  CORE_EXTRACTORS,
  LISTINGS_EXTRACTORS,
  PREVIEW_EXTRACTORS,
  ALL_EXTRACTORS,
  VENUE_MAP,
  parseDateLoose,
  lastRefreshedModeFor,
  fetchProfile,
} from "./lib/justetf-extract.mjs";

// Re-export the pure helpers so existing test imports
// (`from "../scripts/refresh-justetf.mjs"`) continue to work after the
// extraction into ./lib/justetf-extract.mjs.
export {
  USER_AGENT,
  CORE_EXTRACTORS,
  LISTINGS_EXTRACTORS,
  PREVIEW_EXTRACTORS,
  ALL_EXTRACTORS,
  VENUE_MAP,
  parseDateLoose,
  lastRefreshedModeFor,
  fetchProfile,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const OVERRIDES_JSON = resolve(ROOT, "src/data/etfs.overrides.json");
const RUN_LOG_MD = resolve(ROOT, "src/data/refresh-runs.log.md");
const CHANGES_LOG = resolve(ROOT, "src/data/refresh-changes.log.jsonl");
const REQUEST_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract every (isin, currency) pair from the curated catalog so the listings
// extractor knows which currency to prefer when an exchange has multiple
// share classes (e.g. LSE typically lists USD + GBP + GBX variants).
async function extractCatalogEntries() {
  const src = await readFile(ETFS_TS, "utf8");
  const entries = new Map();
  const re =
    /isin:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"[\s\S]{0,800}?currency:\s*"([A-Z]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    entries.set(m[1], { isin: m[1], currency: m[2] });
  }
  return entries;
}

// (Field extractors, VENUE_MAP, parseDateLoose, fetchProfile, etc. live in
// scripts/lib/justetf-extract.mjs and are imported above. Keep this file
// focused on the CLI loop: argv parsing, override I/O, the run log, and
// the diff-emitter wiring.)

async function main() {
  const startedAt = new Date().toISOString();
  const args = process.argv.slice(2);
  const mode = await (async () => {
    const flag = args.find((a) => a.startsWith("--mode="));
    if (!flag) return "all";
    const v = flag.slice("--mode=".length);
    if (!["core", "listings", "all"].includes(v)) {
      console.error(`Unknown --mode=${v}. Expected core|listings|all.`);
      // Bad-CLI exit: still record it in the run log so a misconfigured
      // workflow shows up as a failed run instead of disappearing silently.
      await appendRunLogEntry(RUN_LOG_MD, {
        startedAt,
        script: "refresh-justetf",
        mode: v,
        outcome: "fail",
        error: `Unknown --mode=${v}`,
      });
      process.exit(2);
    }
    return v;
  })();
  const targetIsins = args.filter((a) => !a.startsWith("--"));
  const activeExtractors =
    mode === "core" ? CORE_EXTRACTORS : mode === "listings" ? LISTINGS_EXTRACTORS : ALL_EXTRACTORS;

  const catalog = await extractCatalogEntries();
  const allIsins = [...catalog.keys()];
  const isins = targetIsins.length ? targetIsins : allIsins;
  console.log(`Refreshing ${isins.length} ISIN(s) from justETF — mode=${mode}, fields=[${Object.keys(activeExtractors).join(", ")}]`);

  let existing = {};
  let existingMeta = {};
  try {
    const raw = JSON.parse(await readFile(OVERRIDES_JSON, "utf8"));
    existing = raw.overrides ?? {};
    existingMeta = raw._meta ?? {};
  } catch {
    // first run — leave empty
  }

  const next = { ...existing };
  let okCount = 0;
  let failCount = 0;
  // Per-ISIN diff entries collected during the loop and flushed AFTER the
  // override JSON is successfully written. Holding them in memory until then
  // means a fatal write-failure of the override file can't leave behind a
  // misleading "we changed X" entry in refresh-changes.log.jsonl. Skipped
  // entirely on DRY_RUN.
  const pendingChanges = [];

  for (const isin of isins) {
    const rec = catalog.get(isin);
    try {
      const html = await fetchProfile(isin);
      const patch = {};
      for (const [field, extractor] of Object.entries(activeExtractors)) {
        const v = extractor(html, rec);
        if (v !== undefined) patch[field] = v;
      }
      if (Object.keys(patch).length === 0) {
        console.warn(`  ! ${isin}: no fields extracted (leaving previous value)`);
        failCount++;
      } else {
        const fieldChanges = computeFieldChanges(existing[isin], patch);
        next[isin] = { ...(existing[isin] ?? {}), ...patch };
        const summary = Object.entries(patch)
          .map(([k, v]) => `${k}=${typeof v === "object" ? Object.keys(v).join("/") : v}`)
          .join(" ");
        console.log(`  \u2713 ${isin}: ${summary}`);
        okCount++;
        if (fieldChanges.length > 0) {
          pendingChanges.push({ isin, changes: fieldChanges });
        }
      }
    } catch (e) {
      console.warn(`  ! ${isin}: ${e.message}`);
      failCount++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (process.env.DRY_RUN) {
    console.log("\nDRY_RUN set — not writing override file.");
    await appendRunLogEntry(RUN_LOG_MD, {
      startedAt,
      script: "refresh-justetf",
      mode,
      isinCount: isins.length,
      okCount,
      failCount,
      dryRun: true,
    });
    process.exit(failCount > okCount ? 1 : 0);
  }

  // Track per-mode timestamps so the UI can show "core fields verified <date>"
  // and "listings verified <date>" independently. Each mode only updates its
  // own stamp; the other one is preserved from the previous run so a nightly
  // listings refresh doesn't reset the weekly core-fields stamp (and vice
  // versa).
  const stamp = new Date().toISOString();
  const lastCoreRefresh =
    mode === "core" || mode === "all" ? stamp : existingMeta.lastCoreRefresh ?? null;
  const lastListingsRefresh =
    mode === "listings" || mode === "all" ? stamp : existingMeta.lastListingsRefresh ?? null;

  const payload = {
    _meta: {
      source: "justetf.com",
      lastRefreshed: stamp,
      lastRefreshedMode: lastRefreshedModeFor(mode),
      lastCoreRefresh,
      lastListingsRefresh,
      refreshedBy: "scripts/refresh-justetf.mjs",
      note:
        "ISIN -> partial ETFRecord overrides applied on top of the in-code CATALOG in src/lib/etfs.ts. " +
        "Populated by two CI cadences: weekly (Sundays 03:00 UTC) for core fund metadata and nightly (02:00 UTC) for the per-exchange listings map. " +
        "Only fields present in this file override the catalog defaults; everything else stays as defined in code.",
    },
    overrides: next,
  };

  await writeFile(OVERRIDES_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OVERRIDES_JSON} (${okCount} ok, ${failCount} failed).`);

  // Now that the override file is durably on disk, append the per-field
  // changes to refresh-changes.log.jsonl so the admin pane's "Recent ETF
  // updates" panel can show exactly what shifted in this run. Source label
  // matches the run-log mode column for easy correlation.
  if (pendingChanges.length > 0) {
    const source = `justetf-${lastRefreshedModeFor(mode)}`;
    let totalLines = 0;
    for (const { isin, changes } of pendingChanges) {
      await appendChangeEntries(CHANGES_LOG, { timestamp: stamp, source, isin }, changes);
      totalLines += changes.length;
    }
    console.log(`Appended ${totalLines} change line(s) to refresh-changes.log.jsonl.`);
  }

  await appendRunLogEntry(RUN_LOG_MD, {
    startedAt,
    script: "refresh-justetf",
    mode,
    isinCount: isins.length,
    okCount,
    failCount,
  });
  process.exit(failCount > okCount ? 1 : 0);
}

// Only run main() when invoked directly from the CLI. When this module is
// imported (e.g. by tests/scrapers.test.ts) the network fetch loop must NOT
// auto-execute.
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const fatalStartedAt = new Date().toISOString();
  main().catch(async (e) => {
    console.error("Fatal:", e);
    // Best-effort: record the fatal in the run log so a crashed scheduled
    // run still appears in the history. If the log write itself fails we
    // swallow that error — the original failure is what matters.
    try {
      await appendRunLogEntry(RUN_LOG_MD, {
        startedAt: fatalStartedAt,
        script: "refresh-justetf",
        outcome: "fail",
        error: e?.message ?? String(e),
      });
    } catch {}
    process.exit(2);
  });
}
