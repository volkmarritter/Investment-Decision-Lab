#!/usr/bin/env node
// ----------------------------------------------------------------------------
// scrape-popular-etfs-instruments.mjs
// ----------------------------------------------------------------------------
// One-off batch enrichment for the orphan-instruments rollout.
//
// Reads ./data/popular-etfs-seed.mjs, filters out ISINs that already
// exist in INSTRUMENTS (parsed from etfs.ts), then for each new ISIN
// fetches the justETF profile via the existing per-ISIN scraper
// (lib/justetf-extract.mjs) and extracts every field needed to build a
// valid InstrumentRecord (name, currency, domicile, terBps, AUM,
// inceptionDate, distribution, replication, listings).
//
// Output: scripts/data/popular-etfs-staged.json
// Consumed by:  scripts/inject-popular-etfs.mjs
//
// Politeness: 1.5 s delay between ISINs (matches refresh-justetf.mjs).
// Tolerant: per-ISIN failures (404, missing required field, scrape error)
// are logged and skipped — never abort the batch. Final summary prints
// counts per skip reason.
//
// Resumable: writes the staged JSON file after every successful ISIN. On
// startup, any ISIN already present in that file (or in `failed`) is
// skipped. So multiple foreground runs (each LIMIT-bounded) can stitch
// together to produce one full staging file even when wall-clock budgets
// are tight.
//
// Usage (from artifacts/investment-lab):
//   node scripts/scrape-popular-etfs-instruments.mjs
//   DRY_RUN=1 node scripts/scrape-popular-etfs-instruments.mjs   # don't write JSON
//   LIMIT=40 node scripts/scrape-popular-etfs-instruments.mjs    # resume in chunks
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CORE_EXTRACTORS,
  PREVIEW_EXTRACTORS,
  LISTINGS_EXTRACTORS,
  fetchProfile,
} from "./lib/justetf-extract.mjs";
import { POPULAR_ETF_SEED, SEED_VERSION, SEED_PROVENANCE } from "./data/popular-etfs-seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const STAGED_JSON = resolve(__dirname, "data/popular-etfs-staged.json");
const REQUEST_DELAY_MS = 1500;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull the existing ISIN keys out of etfs.ts so we don't re-add them. Robust
// to the formatting of the file: we look for `"ISIN": I({` openers within
// the INSTRUMENTS object literal.
async function loadExistingIsins() {
  const src = await readFile(ETFS_TS, "utf8");
  const out = new Set();
  const re = /^\s*"([A-Z]{2}[A-Z0-9]{9}\d)":\s*I\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

// Pick the first available exchange in the priority order matching the
// existing catalog conventions.
function pickDefaultExchange(listings) {
  for (const ex of ["LSE", "XETRA", "SIX", "Euronext"]) {
    if (listings && listings[ex] && listings[ex].ticker) return ex;
  }
  return null;
}

async function enrichOne(isin) {
  const html = await fetchProfile(isin);
  // Core fields (TER, AUM, inception, dist, repl)
  const core = {};
  for (const [k, fn] of Object.entries(CORE_EXTRACTORS)) {
    try {
      core[k] = fn(html);
    } catch {
      core[k] = undefined;
    }
  }
  // Preview fields (name, currency, domicile)
  const preview = {};
  for (const [k, fn] of Object.entries(PREVIEW_EXTRACTORS)) {
    try {
      preview[k] = fn(html);
    } catch {
      preview[k] = undefined;
    }
  }
  // LISTINGS_EXTRACTORS.listings(html, rec) returns the full ListingMap
  // ({ LSE: { ticker }, XETRA: { ticker }, ... }) directly, picking the
  // ticker variant whose currency matches the fund's base currency where
  // possible. Pass preview.currency in `rec` so that selection works.
  let listings = {};
  try {
    listings = LISTINGS_EXTRACTORS.listings(html, { currency: preview.currency }) || {};
  } catch {
    listings = {};
  }
  return { core, preview, listings };
}

function buildInstrumentRecord({ isin, seedNote, core, preview, listings }) {
  const defaultExchange = pickDefaultExchange(listings);
  const required = {
    name: preview.name,
    currency: preview.currency,
    domicile: preview.domicile,
    terBps: core.terBps,
    distribution: core.distribution,
    replication: core.replication,
    defaultExchange,
  };
  const missing = Object.entries(required)
    .filter(([_, v]) => v === undefined || v === null || v === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    return { ok: false, reason: "missing-fields", missing };
  }
  // Normalise replication to one of the InstrumentRecord union values.
  const repl = String(core.replication);
  let replication;
  if (/synthetic|swap/i.test(repl)) replication = "Synthetic";
  else if (/sampl/i.test(repl)) replication = "Physical (sampled)";
  else if (/physical|full/i.test(repl)) replication = "Physical";
  else return { ok: false, reason: "unknown-replication", value: repl };
  // Normalise distribution.
  const dist = String(core.distribution);
  let distribution;
  if (/accum|thesa/i.test(dist)) distribution = "Accumulating";
  else if (/distribut|aussch/i.test(dist)) distribution = "Distributing";
  else return { ok: false, reason: "unknown-distribution", value: dist };

  const today = new Date().toISOString().slice(0, 10);
  const record = {
    name: preview.name,
    isin,
    terBps: core.terBps,
    domicile: preview.domicile,
    replication,
    distribution,
    currency: preview.currency,
    comment: `Popular UCITS ETF auto-added on ${today} as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: ${seedNote || "—"}.`,
    listings,
    defaultExchange,
    aumMillionsEUR: core.aumMillionsEUR,
    inceptionDate: core.inceptionDate,
  };
  return { ok: true, record };
}

async function loadStagedFile() {
  // If the staged file exists from a previous (LIMIT-bounded) run, load it
  // so we can resume and skip already-processed ISINs.
  try {
    const text = await readFile(STAGED_JSON, "utf8");
    const data = JSON.parse(text);
    return {
      instruments: Array.isArray(data.instruments) ? data.instruments : [],
      failed: Array.isArray(data.failed) ? data.failed : [],
    };
  } catch {
    return { instruments: [], failed: [] };
  }
}

async function persistStaged({ staged, failed, dupCatalog, dupSeed, invalidIsin }) {
  const out = {
    _meta: {
      generatedAt: new Date().toISOString(),
      seedVersion: SEED_VERSION,
      seedProvenance: SEED_PROVENANCE,
      counts: {
        seed: POPULAR_ETF_SEED.length,
        existingInCatalog: dupCatalog,
        dupeInSeed: dupSeed,
        invalidIsin,
        scraped: staged.length,
        failed: failed.length,
      },
    },
    instruments: staged,
    failed,
  };
  await writeFile(STAGED_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
  console.log(
    `\n=== scrape-popular-etfs-instruments — seed v${SEED_VERSION} (${POPULAR_ETF_SEED.length} entries) ===\n${SEED_PROVENANCE}\n`
  );
  if (Number.isFinite(limit)) console.log(`  LIMIT=${limit} — will scrape at most this many new ISINs\n`);

  const existing = await loadExistingIsins();
  console.log(`  catalog has ${existing.size} existing ISIN(s)`);

  // Resume from any prior run.
  const prior = dryRun ? { instruments: [], failed: [] } : await loadStagedFile();
  const alreadyProcessed = new Set([
    ...prior.instruments.map((r) => r.isin),
    ...prior.failed.map((f) => f.isin),
  ]);
  if (alreadyProcessed.size > 0) {
    console.log(
      `  resumable state: ${prior.instruments.length} already staged, ${prior.failed.length} previously failed — skipping ${alreadyProcessed.size} ISIN(s)`
    );
  }
  console.log("");

  // Dedupe the seed itself + filter out catalog duplicates + filter out
  // already-processed ISINs from prior runs.
  const seen = new Set();
  const todo = [];
  let dupSeed = 0;
  let dupCatalog = 0;
  let alreadyDone = 0;
  let invalidIsin = 0;
  for (const entry of POPULAR_ETF_SEED) {
    if (!ISIN_RE.test(entry.isin)) {
      invalidIsin++;
      console.warn(`  ! ${entry.isin}: invalid ISIN format — skipping`);
      continue;
    }
    if (seen.has(entry.isin)) {
      dupSeed++;
      continue;
    }
    seen.add(entry.isin);
    if (existing.has(entry.isin)) {
      dupCatalog++;
      continue;
    }
    if (alreadyProcessed.has(entry.isin)) {
      alreadyDone++;
      continue;
    }
    todo.push(entry);
    if (todo.length >= limit) break;
  }
  console.log(
    `  filter: ${invalidIsin} invalid · ${dupSeed} dupe-in-seed · ${dupCatalog} already-in-catalog · ${alreadyDone} already-processed · ${todo.length} to scrape\n`
  );

  // Carry forward prior results so the on-disk file always represents the
  // full cumulative state.
  const staged = [...prior.instruments];
  const failed = [...prior.failed];
  for (let i = 0; i < todo.length; i++) {
    const { isin, category, note } = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${isin} (${category}) ... `);
    try {
      const { core, preview, listings } = await enrichOne(isin);
      const built = buildInstrumentRecord({
        isin,
        seedNote: note,
        core,
        preview,
        listings,
      });
      if (!built.ok) {
        process.stdout.write(`SKIP (${built.reason}: ${JSON.stringify(built.missing || built.value)})\n`);
        failed.push({ isin, category, note, reason: built.reason, detail: built.missing || built.value });
      } else {
        staged.push({ ...built.record, _seedCategory: category, _seedNote: note });
        process.stdout.write(`OK (${built.record.name})\n`);
      }
    } catch (e) {
      process.stdout.write(`SKIP (scrape-error: ${e?.message || e})\n`);
      failed.push({ isin, category, note, reason: "scrape-error", detail: e?.message || String(e) });
    }
    // Persist after every iteration so a SIGTERM mid-batch loses at most
    // one ISIN's progress.
    if (!dryRun) {
      try {
        await persistStaged({ staged, failed, dupCatalog, dupSeed, invalidIsin });
      } catch (e) {
        console.error(`  ! persist-error: ${e?.message || e}`);
      }
    }
    if (i < todo.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `\n  staged: ${staged.length}   failed: ${failed.length}   total seed: ${POPULAR_ETF_SEED.length}\n`
  );

  if (dryRun) {
    console.log("  DRY_RUN=1 — not writing staging file.");
    if (failed.length > 0) {
      console.log("\n  Failed entries:\n", failed.map((f) => `    - ${f.isin}: ${f.reason}`).join("\n"));
    }
    return;
  }
  console.log(`  wrote ${STAGED_JSON}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
