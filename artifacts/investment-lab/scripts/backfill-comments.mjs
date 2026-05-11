#!/usr/bin/env node
// ----------------------------------------------------------------------------
// backfill-comments.mjs — Task #207
// ----------------------------------------------------------------------------
// Persists ETF descriptions into INSTRUMENTS rows in `src/lib/etfs.ts` so
// the runtime UI doesn't have to recompute them on every mount.
//
// Source priority per row:
//   1. justETF "Investment objective" / "Anlageziel" prose, scraped via
//      PREVIEW_EXTRACTORS.description (EN + DE). Stamped commentSource=
//      "justetf".
//   2. Deterministic describeEtf() template (Node port at
//      lib/describe-etf.mjs) computed against the look-through profile in
//      `src/data/lookthrough.overrides.json`. Stamped commentSource="auto".
//   3. Otherwise leave the row alone — the runtime cell still computes
//      describeEtf() at render time as a final safety net.
//
// Source-scoped modes (controlled by `mode` argument or env MODE):
//   - "all" (default for the standalone CLI): touch every row whose
//     `commentSource` is not "manual" — first-time fill plus refresh of
//     prior auto/justetf rows.
//   - "justetf-refresh": run from the weekly justETF scraper. Touches
//     non-manual rows. justETF text wins; falls back to "auto" when
//     justETF returns empty.
//   - "lookthrough-refresh": run from the monthly look-through scraper.
//     Only touches rows whose stored `commentSource === "auto"` (or
//     undefined-with-empty-comment). Re-renders via describeEtf so the
//     prose tracks the freshly-refreshed look-through profile. Never
//     overwrites manual or justetf rows.
//
// All writes are idempotent (no-op when the freshly-resolved text matches
// the stored text). Diff lines are appended to refresh-changes.log.jsonl
// under `source: "auto-description-refresh"` with the run mode in `mode`.
//
// Force re-scrape of already-tagged rows: pass `force: true` (CLI: FORCE=1).
// Skip the refresh-script tail call: SKIP_BACKFILL_COMMENTS=1.
// ----------------------------------------------------------------------------

import { readFile, writeFile, appendFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  USER_AGENT,
  PREVIEW_EXTRACTORS,
  fetchWithRetry,
} from "./lib/justetf-extract.mjs";
import { describeEtf } from "./lib/describe-etf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const LOOKTHROUGH_JSON = resolve(ROOT, "src/data/lookthrough.overrides.json");
const CHANGES_LOG = resolve(ROOT, "src/data/refresh-changes.log.jsonl");
const REQUEST_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-row regex. Matches the INSTRUMENTS row block keyed by ISIN. The
// leading-whitespace prefix is captured (`\n( +)`) so a row written with
// any indent — the canonical 2-space form OR an admin-write that drifted
// to 4 spaces (Task #275 saw such a row on main and the previous
// 2-space-anchored regex silently skipped it, breaking
// backfillSourcePriority.test.ts in CI) — is still picked up. The closing
// `}),` is then required to sit at exactly the same indent as the opener,
// which keeps the match scoped to a single row even when other braces
// nest inside.
const ROW_RE =
  /(\n( +)"([A-Z]{2}[A-Z0-9]{9}\d)":\s*I\(\{)([\s\S]*?)(\n\2\}\),)/g;

function extractField(body, key) {
  const re = new RegExp(`\\n\\s+${key}:\\s*"((?:\\\\.|[^"\\\\])*)"\\s*,`);
  const m = body.match(re);
  return m ? m[1] : undefined;
}

function quoteForTs(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
}

function upsertField(body, key, value) {
  const quoted = `${key}: ${quoteForTs(value)},`;
  const re = new RegExp(`(\\n\\s+)${key}:\\s*"((?:\\\\.|[^"\\\\])*)"\\s*,`);
  const existing = body.match(re);
  if (existing) {
    const stored = existing[2]
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"');
    if (stored === value) return { body, changed: false };
    return {
      body: body.replace(re, `${existing[1]}${quoted}`),
      changed: true,
    };
  }
  const commentRe = /(\n( +)comment:\s*"(?:\\.|[^"\\])*"\s*,)/;
  const m = body.match(commentRe);
  if (!m) return { body, changed: false };
  const indent = m[2];
  return {
    body: body.replace(commentRe, `${m[1]}\n${indent}${quoted}`),
    changed: true,
  };
}

function deleteField(body, key) {
  const re = new RegExp(`\\n\\s+${key}:\\s*"(?:\\\\.|[^"\\\\])*"\\s*,`);
  if (!re.test(body)) return { body, changed: false };
  return { body: body.replace(re, ""), changed: true };
}

async function fetchDescription(isin) {
  const out = { en: undefined, de: undefined };
  for (const lang of ["en", "de"]) {
    const url = `https://www.justetf.com/${lang}/etf-profile.html?isin=${isin}`;
    try {
      const res = await fetchWithRetry(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": lang },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = PREVIEW_EXTRACTORS.description(html);
      if (text) out[lang] = text;
    } catch {
      // tolerate per-locale failures
    }
    await sleep(REQUEST_DELAY_MS / 2);
  }
  return out;
}

// Build a small in-memory map of look-through profiles keyed by ISIN so
// the auto fallback can render describeEtf() without booting the full
// Vite/TS stack. We only have the JSON-override layer here (the curated
// PROFILES literal in src/lib/lookthrough.ts isn't readable from Node
// without TS compilation), but the override layer IS what the monthly
// refresh job populates and what the runtime UI prefers — for the bulk
// of catalog rows it's the same shape (geo + sector + currency +
// topHoldings + isEquity inferred). When the override is absent or
// missing isEquity, we leave it undefined and describeEtf() will
// degrade gracefully.
// Spawn the tsx helper that imports `profileFor` from
// src/lib/lookthrough — that gives us the merged curated-PROFILES +
// JSON-overrides map the runtime UI uses, not just the JSON layer.
// Falls back to the JSON-only layer when tsx isn't installed
// (CI / minimal environments) so the script still does *some* work.
async function loadMergedProfiles() {
  try {
    const json = await new Promise((resolveP, rejectP) => {
      const child = spawn(
        "npx",
        ["--yes", "tsx", resolve(__dirname, "dump-lookthrough-profiles.ts")],
        { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] },
      );
      let buf = "";
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        if (code !== 0) {
          rejectP(new Error(`dump-lookthrough-profiles exited ${code}`));
          return;
        }
        try {
          resolveP(JSON.parse(buf));
        } catch (e) {
          rejectP(e);
        }
      });
      child.on("error", rejectP);
    });
    return json;
  } catch (e) {
    // Fallback: JSON overrides only. Rare in practice (workspace runs
    // always have tsx), but keeps the script safe in stripped envs.
    console.warn(
      `backfill-comments: tsx profile dump failed (${e.message}) — falling back to JSON overrides only.`,
    );
    try {
      const raw = await readFile(LOOKTHROUGH_JSON, "utf8");
      const parsed = JSON.parse(raw);
      const out = {};
      for (const [isin, entry] of Object.entries(parsed.overrides ?? {})) {
        const hasSector = entry.sector && Object.keys(entry.sector).length > 0;
        out[isin] = {
          isEquity: hasSector,
          geo: entry.geo,
          sector: entry.sector,
          currency: entry.currency,
          topHoldings: entry.topHoldings,
        };
      }
      return out;
    } catch {
      return {};
    }
  }
}

// loadMergedProfiles() returns entries that already match the
// LookthroughProfile shape (isEquity + geo + sector + currency +
// topHoldings) because they come straight from the runtime
// `profileFor()`. The fallback path also pre-shapes them. So this is
// a thin lookup wrapper — no per-row coercion needed in the hot path.
function coerceProfile(entry) {
  return entry ?? null;
}

function extractCatalogFacts(body) {
  return {
    domicile: extractField(body, "domicile") ?? "",
    distribution: extractField(body, "distribution") ?? "",
    currency: extractField(body, "currency") ?? "",
  };
}

function shouldVisit(commentSource, comment, mode, force) {
  if (commentSource === "manual") return false;
  if (force) return true;
  if (mode === "lookthrough-refresh") {
    // Only rows already tagged commentSource:"auto" are eligible for
    // the monthly look-through tail — we re-render their describeEtf()
    // text against the freshly-refreshed profile. Justetf rows stay
    // frozen (weekly justETF run owns them); first-time fills are
    // delegated to the justETF run too so the source-priority
    // contract (justETF wins, auto fallback) holds in one place.
    return commentSource === "auto";
  }
  // "all" + "justetf-refresh": touch every non-manual row.
  if (commentSource === undefined) {
    // Legacy curated rows have no source tag. Only re-fill when the
    // comment is genuinely empty so we never overwrite a hand-written
    // line that just happens to be tag-less.
    return !comment.trim();
  }
  return commentSource === "auto" || commentSource === "justetf";
}

export async function backfillCatalogComments({
  targetIsins = [],
  mode = "all",
  force = false,
  dryRun = false,
  fetchDescriptionImpl = fetchDescription,
  log = console,
} = {}) {
  const src = await readFile(ETFS_TS, "utf8");
  const profiles = await loadMergedProfiles();

  const candidates = [];
  for (const m of src.matchAll(ROW_RE)) {
    const [, , , isin, body] = m;
    if (targetIsins.length && !targetIsins.includes(isin)) continue;
    const comment = extractField(body, "comment") ?? "";
    const commentSource = extractField(body, "commentSource");
    if (!shouldVisit(commentSource, comment, mode, force)) continue;
    candidates.push({ isin, currentSource: commentSource });
  }

  if (candidates.length === 0) {
    log.log?.(
      `backfill-comments[${mode}]: no candidate rows — nothing to do.`,
    );
    return { mode, scanned: 0, updated: 0, failed: 0, candidates: 0 };
  }
  log.log?.(
    `backfill-comments[${mode}]: ${candidates.length} candidate row(s).`,
  );

  let next = src;
  let updated = 0;
  let failed = 0;
  const stamp = new Date().toISOString();
  const pendingChanges = [];

  for (const { isin, currentSource } of candidates) {
    // For the look-through mode we never call justETF — the only
    // upstream signal is the look-through profile.
    let descs = { en: undefined, de: undefined };
    if (mode !== "lookthrough-refresh") {
      try {
        descs = await fetchDescriptionImpl(isin);
      } catch (e) {
        log.warn?.(`  ! ${isin}: justETF fetch failed — ${e.message}`);
      }
    }

    let chosenSource;
    let chosenEn;
    let chosenDe;
    if (descs.en || descs.de) {
      chosenSource = "justetf";
      chosenEn = descs.en;
      chosenDe = descs.de;
    } else {
      // Auto fallback via describeEtf().
      const rowReFresh = new RegExp(
        `(\\n( +)"${isin}":\\s*I\\(\\{)([\\s\\S]*?)(\\n\\2\\}\\),)`,
      );
      const rowMatch = next.match(rowReFresh);
      if (!rowMatch) {
        failed++;
        continue;
      }
      const [, , , bodyNow] = rowMatch;
      const facts = extractCatalogFacts(bodyNow);
      const name = extractField(bodyNow, "name") ?? "";
      const profile = coerceProfile(profiles[isin]);
      const auto = describeEtf({ name, profile, catalog: facts });
      if (!auto) {
        // Neither justETF nor a usable look-through profile — skip.
        // The runtime cell continues to fall back at render time.
        log.warn?.(
          `  ! ${isin}: no justETF + no look-through profile — skipping`,
        );
        failed++;
        continue;
      }
      chosenSource = "auto";
      chosenEn = auto.en;
      chosenDe = auto.de;
    }

    // Apply the patch. Re-match because earlier iterations may have
    // shifted offsets.
    // Indent-tolerant — same shape as ROW_RE / rowReFresh above so a row
    // written with non-canonical indent (Task #275) still patches.
    const rowRe = new RegExp(
      `(\\n( +)"${isin}":\\s*I\\(\\{)([\\s\\S]*?)(\\n\\2\\}\\),)`,
    );
    const rowMatch = next.match(rowRe);
    if (!rowMatch) {
      log.warn?.(`  ! ${isin}: row vanished mid-run — skipping.`);
      failed++;
      continue;
    }
    const [, head, , body, tail] = rowMatch;
    const rowChanges = [];
    let patchedBody = body;
    if (chosenEn !== undefined) {
      const r = upsertField(patchedBody, "comment", chosenEn);
      patchedBody = r.body;
      if (r.changed) {
        rowChanges.push({
          field: "comment",
          before: extractField(body, "comment") ?? null,
          after: chosenEn,
        });
      }
    }
    if (chosenDe !== undefined) {
      const r = upsertField(patchedBody, "commentDe", chosenDe);
      patchedBody = r.body;
      if (r.changed) {
        rowChanges.push({
          field: "commentDe",
          before: extractField(body, "commentDe") ?? null,
          after: chosenDe,
        });
      }
    } else if (chosenSource === "auto") {
      // describeEtf produces both EN and DE — but if the auto-render
      // happened to omit the DE side (would be a bug, kept defensive)
      // we don't drop a previously-stored DE field.
    }
    {
      const r = upsertField(patchedBody, "commentSource", chosenSource);
      patchedBody = r.body;
      if (r.changed) {
        rowChanges.push({
          field: "commentSource",
          before: currentSource ?? null,
          after: chosenSource,
        });
      }
    }
    if (rowChanges.length === 0) {
      log.log?.(`  · ${isin}: already up-to-date.`);
      continue;
    }
    next = next.replace(rowRe, `${head}${patchedBody}${tail}`);
    log.log?.(
      `  ✓ ${isin} (${chosenSource}): ${rowChanges.map((c) => c.field).join(", ")}`,
    );
    updated++;
    pendingChanges.push({ isin, changes: rowChanges });
  }

  if (dryRun) {
    log.log?.("DRY_RUN — not writing etfs.ts.");
    return {
      mode,
      scanned: candidates.length,
      updated,
      failed,
      candidates: candidates.length,
    };
  }

  if (updated > 0) {
    await writeFile(ETFS_TS, next, "utf8");
    log.log?.(
      `backfill-comments[${mode}]: wrote ${updated} row update(s) to etfs.ts.`,
    );
    // Single JSONL record per touched ISIN — round-2 review
    // explicitly required this contract ("one
    // `auto-description-refresh` line per touched ISIN") rather than
    // the per-field expansion the diff-overrides helper emits. The
    // operator-facing "Recent data changes" admin panel can still
    // unpack `changes[]` to render a per-field row when desired.
    try {
      await stat(CHANGES_LOG);
    } catch {
      await mkdir(dirname(CHANGES_LOG), { recursive: true });
      await writeFile(CHANGES_LOG, "", "utf8");
    }
    let totalLines = 0;
    for (const { isin, changes } of pendingChanges) {
      const line =
        JSON.stringify({
          timestamp: stamp,
          source: "auto-description-refresh",
          mode,
          isin,
          changes,
        }) + "\n";
      await appendFile(CHANGES_LOG, line, "utf8");
      totalLines++;
    }
    if (totalLines > 0) {
      log.log?.(
        `backfill-comments[${mode}]: appended ${totalLines} change line(s) to refresh-changes.log.jsonl.`,
      );
    }
  }

  return {
    mode,
    scanned: candidates.length,
    updated,
    failed,
    candidates: candidates.length,
  };
}

// Re-export helpers for tests.
export const __test = {
  ROW_RE,
  extractField,
  upsertField,
  deleteField,
  shouldVisit,
  coerceProfile,
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const argv = process.argv.slice(2);
  const targetIsins = argv.filter((a) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(a));
  const mode = process.env.MODE ?? "all";
  backfillCatalogComments({
    targetIsins,
    mode,
    force: process.env.FORCE === "1",
    dryRun: process.env.DRY_RUN === "1",
  })
    .then((res) => {
      console.log(
        `Done. mode=${res.mode} updated=${res.updated} failed=${res.failed} candidate=${res.candidates}.`,
      );
      process.exit(res.failed > res.updated ? 1 : 0);
    })
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(2);
    });
}
