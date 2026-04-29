// ----------------------------------------------------------------------------
// github.ts
// ----------------------------------------------------------------------------
// Opens a PR on the user's GitHub repo that adds a new ETF entry to
// `artifacts/investment-lab/src/lib/etfs.ts`. We deliberately open a PR
// rather than committing to main: the user wants a manual review step
// before any new fund enters the catalog.
//
// Insertion strategy: the catalog is a single `Record<string, ETFRecord>`
// object literal. We locate the closing brace of that literal (the first
// `};` after `const CATALOG: Record<string, ETFRecord> = {`) and inject
// the new entry just before it. This is more robust than trying to parse
// TypeScript and keeps the diff localized for the human reviewer.
//
// Required env:
//   - GITHUB_PAT     classic PAT with `repo` scope
//   - GITHUB_OWNER   e.g. "volkmarritter"
//   - GITHUB_REPO    e.g. "Investment-Decision-Lab"
// Optional:
//   - GITHUB_BASE_BRANCH (default "main")
// ----------------------------------------------------------------------------

import { Octokit } from "@octokit/rest";
import {
  renderEntryBlock,
  renderInstrumentRow,
  renderBucketRow,
  type NewEtfEntry,
} from "./render-entry";
import {
  renderAlternativeBlock,
  type NewAlternativeEntry,
} from "./render-alternative";
import { findMatchingClose, parseCatalogFromSource } from "./catalog-parser";
import { MAX_ALTERNATIVES_PER_BUCKET } from "./limits";

// Re-exported so downstream callers (admin.ts, tests) keep importing the
// canonical entry shape from one place. The implementation lives in
// render-entry.ts so the renderer can be reused by the admin UI's
// "Show generated code" disclosure without dragging octokit into the
// test bundle.
export type { NewEtfEntry, NewAlternativeEntry };
export {
  renderEntryBlock,
  renderAlternativeBlock,
  renderInstrumentRow,
  renderBucketRow,
};

// Task #111 markers — kept identical to catalog-parser.ts so the text
// walker can locate the new split literals. If you rename them, update
// catalog-parser.ts too.
const INSTRUMENTS_HEADER =
  "const INSTRUMENTS: Record<string, InstrumentRecord> = {";
const BUCKETS_HEADER = "const BUCKETS: Record<string, BucketAssignment> = {";

// Locate the matching `{`/`}` pair of a top-level literal whose declaration
// begins with `header`. Returns the absolute indices of `{` and the
// matching `}`. Throws if either side is missing.
function findLiteralBlock(
  source: string,
  header: string,
): { openBrace: number; closeBrace: number } {
  const start = source.indexOf(header);
  if (start < 0) {
    throw new Error(
      `Could not locate "${header}" in etfs.ts source — refusing to edit.`,
    );
  }
  const openBrace = source.indexOf("{", start);
  const closeBrace = findMatchingClose(source, openBrace);
  if (closeBrace < 0) {
    throw new Error(
      `Unbalanced braces inside literal starting with "${header}".`,
    );
  }
  return { openBrace, closeBrace };
}

// Locate the body of a single bucket entry inside the BUCKETS literal —
// i.e. the `{ ... }` of a `B({ ... })` call following `"<key>":`.
// Returns absolute indices for the `{` and matching `}` of that body, or
// null when the bucket key isn't present. The match is depth-0 inside the
// BUCKETS body, string- and comment-aware via findMatchingClose.
function findBucketEntry(
  source: string,
  bucketsBlock: { openBrace: number; closeBrace: number },
  parentKey: string,
): { openBrace: number; closeBrace: number } | null {
  const body = source.slice(bucketsBlock.openBrace + 1, bucketsBlock.closeBrace);
  const re = new RegExp(
    `"${escapeRegex(parentKey)}":\\s*B\\(\\{`,
    "g",
  );
  const m = re.exec(body);
  if (!m) return null;
  const relOpen = m.index + m[0].length - 1; // the `{` in `B({`
  const relClose = findMatchingClose(body, relOpen);
  if (relClose < 0) {
    throw new Error(
      `Unbalanced braces inside BUCKETS entry "${parentKey}" — refusing to edit.`,
    );
  }
  return {
    openBrace: bucketsBlock.openBrace + 1 + relOpen,
    closeBrace: bucketsBlock.openBrace + 1 + relClose,
  };
}

// Returns true if INSTRUMENTS already has a row for the given ISIN.
function instrumentRowExists(
  source: string,
  instrumentsBlock: { openBrace: number; closeBrace: number },
  isin: string,
): boolean {
  const body = source.slice(
    instrumentsBlock.openBrace + 1,
    instrumentsBlock.closeBrace,
  );
  const re = new RegExp(`"${escapeRegex(isin)}":\\s*I\\(\\{`);
  return re.test(body);
}

// Append a fresh `"<ISIN>": I({ ... }),` row at the end of the
// INSTRUMENTS literal, preserving the surrounding indentation.
function appendInstrumentRow(
  source: string,
  instrumentsBlock: { openBrace: number; closeBrace: number },
  entry: NewEtfEntry,
): string {
  const block = renderInstrumentRow(entry, "  ");
  const before = source.slice(0, instrumentsBlock.closeBrace);
  const after = source.slice(instrumentsBlock.closeBrace);
  const trimmed = before.replace(/\s*$/, "");
  return `${trimmed}\n${block}\n${after}`;
}

// Parse the inner ISIN strings of a bucket's `alternatives: [ ... ]`
// field. Returns null when the bucket has no `alternatives:` field at
// depth 0 (defensive — the catalog convention always emits one, even
// when empty). Otherwise returns the absolute `[` and `]` indices plus
// the parsed array of trimmed ISIN strings (in source order).
function findBucketAlternatives(
  source: string,
  bucketBody: { openBrace: number; closeBrace: number },
): {
  openBracket: number;
  closeBracket: number;
  isins: string[];
} | null {
  const inner = source.slice(bucketBody.openBrace + 1, bucketBody.closeBrace);
  const idx = findFieldIndex(inner, "alternatives");
  if (idx < 0) return null;
  let cursor = idx + "alternatives:".length;
  while (cursor < inner.length && /\s/.test(inner[cursor])) cursor++;
  if (inner[cursor] !== "[") {
    throw new Error(
      "`alternatives` field of a BUCKETS entry is not an array literal.",
    );
  }
  const openBracketRel = cursor;
  const closeBracketRel = findMatchingBracket(inner, openBracketRel);
  if (closeBracketRel < 0) {
    throw new Error(
      "Unbalanced brackets inside `alternatives` array of BUCKETS entry.",
    );
  }
  const arrayBody = inner.slice(openBracketRel + 1, closeBracketRel);
  const isins: string[] = [];
  // Walk the array, picking up every quoted string at depth 0. Skips
  // line/block comments via the same opaque-string-aware scanner used
  // elsewhere in this module.
  let i = 0;
  while (i < arrayBody.length) {
    const ch = arrayBody[i];
    if (ch === "/" && arrayBody[i + 1] === "/") {
      while (i < arrayBody.length && arrayBody[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && arrayBody[i + 1] === "*") {
      i += 2;
      while (
        i < arrayBody.length - 1 &&
        !(arrayBody[i] === "*" && arrayBody[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      const start = i + 1;
      i++;
      while (i < arrayBody.length) {
        const c = arrayBody[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          isins.push(arrayBody.slice(start, i));
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return {
    openBracket: bucketBody.openBrace + 1 + openBracketRel,
    closeBracket: bucketBody.openBrace + 1 + closeBracketRel,
    isins,
  };
}

export interface PrCreationContext {
  policyFit: { aumOk: boolean; terOk: boolean; notes: string[] };
}

const ETFS_FILE_PATH = "artifacts/investment-lab/src/lib/etfs.ts";
const APP_DEFAULTS_FILE_PATH =
  "artifacts/investment-lab/src/data/app-defaults.json";
const LOOKTHROUGH_OVERRIDES_FILE_PATH =
  "artifacts/investment-lab/src/data/lookthrough.overrides.json";

export function githubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_PAT &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO,
  );
}

// ---------------------------------------------------------------------------
// ensureFreshBranch — auto-clean stale admin-flow branches (Task #48, 2026-04-29)
// ---------------------------------------------------------------------------
// Tries to create `refs/heads/<branch>` from `baseSha`. If GitHub answers 422
// (branch already exists), we don't want to dump a confusing "delete it on
// GitHub or rename" message on the operator the way we used to — that came
// up every time someone re-tried an admin action whose previous PR had been
// merged or closed (the branch lingers around because GitHub doesn't delete
// closed-PR head branches automatically when the merge happened outside
// auto-merge, e.g. operator merged manually or merged via the website).
//
// Recovery rule:
//   - If there's an OPEN PR with this branch as head, refuse with a 409-style
//     error pointing at that PR — the operator must close/merge it first
//     instead of us silently force-pushing over their pending review.
//   - Otherwise the branch is leftover from a closed/merged PR (or an
//     abandoned attempt). Force-update the ref to baseSha so the upcoming
//     commit lands cleanly on a fresh, base-aligned branch.
//
// We keep the phrase "already exists" in the open-PR error so the existing
// admin.ts catches that turn it into HTTP 409 (`pr_already_open`) keep
// working unchanged.
// ---------------------------------------------------------------------------
export async function ensureFreshBranch(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  baseSha: string;
}): Promise<{ created: boolean; reset: boolean }> {
  const { octokit, owner, repo, branch, baseSha } = args;
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
    return { created: true, reset: false };
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 422) throw err;
  }

  // Branch exists. Check for an open PR before clobbering history.
  const { data: openPrs } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: "open",
    per_page: 5,
  });
  if (openPrs.length > 0) {
    const urls = openPrs.map((p) => p.html_url).join(", ");
    throw new Error(
      `Branch ${branch} already exists with an open PR: ${urls}. ` +
        `Merge or close the PR before retrying.`,
    );
  }

  // Stale leftover from a closed/merged PR. Force-reset to baseSha so the
  // upcoming commit produces a clean, single-commit branch identical to
  // the freshly-created case.
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: baseSha,
    force: true,
  });
  return { created: false, reset: true };
}

// ---------------------------------------------------------------------------
// openUpdateAppDefaultsPr — global defaults editor (Task #35, 2026-04-27)
// ---------------------------------------------------------------------------
// Replaces `artifacts/investment-lab/src/data/app-defaults.json` wholesale
// (whole-file replacement is safe here because the file is JSON, not source
// — there's no surrounding code to disturb). Same flow as openAddEtfPr
// otherwise: read base SHA, branch, commit, open PR.
//
// The caller is responsible for validating the payload via
// validateAppDefaults() and stamping _meta via stampMeta(). We only handle
// the bytes-on-disk side here.
// ---------------------------------------------------------------------------
export async function openUpdateAppDefaultsPr(args: {
  fileContent: string; // already-serialised JSON (with trailing newline)
  summary: string; // short, human-readable change summary for PR title
  body: string; // full PR body (markdown)
}): Promise<{ url: string; number: number }> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read base SHA + current file sha (the file should always exist; if
  //    it doesn't we still create it on the new branch).
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  let currentFileSha: string | undefined;
  try {
    const { data: fileMeta } = await octokit.repos.getContent({
      owner,
      repo,
      path: APP_DEFAULTS_FILE_PATH,
      ref: baseSha,
    });
    if (!Array.isArray(fileMeta) && fileMeta.type === "file") {
      currentFileSha = fileMeta.sha;
    }
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  // 2. Branch name uses an epoch + 6-char random suffix so two operators
  //    can submit concurrently without colliding (epoch alone collides
  //    when two requests land in the same millisecond), and a stale
  //    branch never blocks a fresh attempt.
  const rand = Math.random().toString(36).slice(2, 8);
  const branch = `update-app-defaults/${Date.now()}-${rand}`;
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // 3. Commit the new file on the new branch (create or update).
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: APP_DEFAULTS_FILE_PATH,
    branch,
    message: `Update global defaults (${args.summary})`,
    content: Buffer.from(args.fileContent, "utf8").toString("base64"),
    sha: currentFileSha,
  });

  // 4. Open the PR.
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Update global defaults: ${args.summary}`,
    body: args.body,
  });

  return { url: pr.html_url, number: pr.number };
}

// ---------------------------------------------------------------------------
// openAddLookthroughPoolPr — admin /lookthrough-pool (Bugfix 2026-04-27)
// ---------------------------------------------------------------------------
// Adds a new ISIN to the `pool` section of
// `artifacts/investment-lab/src/data/lookthrough.overrides.json`.
//
// Why a PR (and not a direct disk write like before): the file is bundled
// into the FRONTEND at build time (`import lookthroughOverridesFile from
// "@/data/lookthrough.overrides.json"`). Direct disk writes on the
// api-server (a) are ephemeral — lost on next container restart — and (b)
// never reach the frontend bundle so `profileFor(isin)` keeps returning
// null and the Methodology override dialog keeps showing the amber "no
// look-through data" warning. Going through merge + redeploy is the only
// way both the admin pool table and the runtime `profileFor()` lookup
// agree on what's available.
//
// Concurrency: deterministic branch name `add-lookthrough-pool/{isin}`
// (lowercased). The first attempt succeeds, a duplicate attempt before
// the first PR is merged returns 422 from createRef which we surface as
// a clear error.
// ---------------------------------------------------------------------------
export interface LookthroughPoolEntry {
  // Offizieller ETF-Name vom justETF-Profilkopf (z.B. "iShares Nasdaq 100
  // UCITS ETF (Acc)"). Optional, weil ältere Pool-Einträge den Namen noch
  // nicht haben — der monatliche Refresh-Job backfillt sie automatisch.
  name?: string;
  topHoldings: Array<{ name: string; pct: number }>;
  topHoldingsAsOf: string;
  geo: Record<string, number>;
  sector: Record<string, number>;
  currency: Record<string, number>;
  breakdownsAsOf: string;
  _source: string;
  _addedAt: string;
  _addedVia: string;
}

export async function openAddLookthroughPoolPr(args: {
  isin: string;
  entry: LookthroughPoolEntry;
}): Promise<{ url: string; number: number; alreadyInBaseFile: boolean }> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read base SHA + current file from the base branch (the file always
  //    exists in the repo — refusal is appropriate if it doesn't).
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(
      `Unexpected GitHub response for ${LOOKTHROUGH_OVERRIDES_FILE_PATH}.`,
    );
  }
  const currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  // 2. Parse, mutate, re-serialise. We refuse if the ISIN is already in
  //    EITHER `overrides` (curated) OR `pool` (refresh job) — duplicates
  //    in the file would be confusing.
  let parsed: {
    _meta?: unknown;
    overrides?: Record<string, unknown>;
    pool?: Record<string, unknown>;
    [k: string]: unknown;
  };
  try {
    parsed = JSON.parse(currentContent);
  } catch (err) {
    throw new Error(
      `lookthrough.overrides.json on ${base} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const overrides = (parsed.overrides ?? {}) as Record<string, unknown>;
  const pool = (parsed.pool ?? {}) as Record<string, unknown>;
  if (overrides[args.isin] || pool[args.isin]) {
    return { url: "", number: 0, alreadyInBaseFile: true };
  }
  pool[args.isin] = args.entry;
  parsed.pool = pool;
  const nextContent = JSON.stringify(parsed, null, 2) + "\n";

  // 3. Create the branch with a deterministic name. 422 on createRef
  //    means a previous unmerged PR for this ISIN exists. In that case we
  //    look up the existing PR (if any) and surface its URL in the error
  //    so the operator can jump straight to it instead of being stuck
  //    wondering "where is my PR?" (real bug report, 2026-04-27).
  const branch = `add-lookthrough-pool/${args.isin.toLowerCase()}`;
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 422) {
      let prHint = "";
      try {
        const { data: existing } = await octokit.pulls.list({
          owner,
          repo,
          head: `${owner}:${branch}`,
          state: "all",
          per_page: 5,
        });
        const open = existing.find((p) => p.state === "open");
        if (open) {
          prHint = ` Offener PR: #${open.number} ${open.html_url}`;
        } else if (existing.length > 0) {
          // Branch exists but no open PR — orphan or already-closed PR.
          // Surface the most recent so the operator can decide whether
          // to reopen or delete the branch.
          const last = existing[0]!;
          prHint = ` Letzter PR auf diesem Branch: #${last.number} (${last.state}) ${last.html_url}`;
        } else {
          prHint = ` Kein PR für diesen Branch gefunden — Branch ist verwaist und kann via https://github.com/${owner}/${repo}/branches gelöscht werden, dann erneut versuchen.`;
        }
      } catch {
        // Best-effort lookup; ignore failures so we still throw a useful base msg.
      }
      throw new Error(
        `Branch ${branch} existiert bereits. Es gibt bereits einen offenen PR für diese ISIN. Bitte zuerst mergen oder den Branch löschen.${prHint}`,
      );
    }
    throw err;
  }

  // 4. Commit the new file content on the branch.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
    branch,
    message: `Add ${args.isin} to lookthrough pool`,
    content: Buffer.from(nextContent, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  // 5. Open the PR.
  const body = [
    `Adds **\`${args.isin}\`** to the look-through data pool (\`pool\` section of \`lookthrough.overrides.json\`).`,
    "",
    "Generated from `/admin` → Look-through-Datenpool. After merge + redeploy:",
    "",
    "- The admin pool table will show this ISIN with `Quelle = Auto-Refresh`.",
    "- The Methodology override dialog (`profileFor(isin)`) will return a full profile, so the amber \"no look-through data\" warning auto-clears.",
    "",
    "**Scrape stats**",
    `- Top holdings: ${args.entry.topHoldings.length}`,
    `- Geo buckets: ${Object.keys(args.entry.geo).length}`,
    `- Sector buckets: ${Object.keys(args.entry.sector).length}`,
    `- As of: ${args.entry.topHoldingsAsOf}`,
    `- Source: ${args.entry._source}`,
    "",
    "The monthly refresh job will keep this entry up to date going forward.",
  ].join("\n");

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${args.isin} to lookthrough pool`,
    body,
  });

  return { url: pr.html_url, number: pr.number, alreadyInBaseFile: false };
}

// ---------------------------------------------------------------------------
// openBulkAddLookthroughPoolPr — admin "backfill missing look-through data"
// ---------------------------------------------------------------------------
// Adds N entries to the `pool` section of lookthrough.overrides.json in a
// single PR. Used by the admin "backfill" flow which scans the catalog
// for ISINs that have no look-through data yet and scrapes them.
//
// Why one PR (not N): operationally a flat ~20 PRs would crush the
// reviewer. One PR with a clear list of ISINs and per-ISIN scrape stats
// is easier to audit and merge.
//
// Concurrency: deterministic branch name `add-lookthrough-pool/bulk-{N}-{stamp}`.
// The timestamp lets the operator re-run the flow later (after some are
// merged) without colliding with the earlier branch — each run targets
// only the still-missing ISINs.
//
// Idempotency: filters out any ISIN that has reappeared in the base file
// between scrape and PR open (race window). The returned `skipped` array
// tells the caller which entries fell into that race.
// ---------------------------------------------------------------------------
export async function openBulkAddLookthroughPoolPr(args: {
  entries: Array<{ isin: string; entry: LookthroughPoolEntry }>;
}): Promise<{
  url: string;
  number: number;
  added: string[];
  skippedAlreadyPresent: string[];
}> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  if (args.entries.length === 0) {
    throw new Error("openBulkAddLookthroughPoolPr called with zero entries.");
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read base SHA + current file from the base branch.
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(
      `Unexpected GitHub response for ${LOOKTHROUGH_OVERRIDES_FILE_PATH}.`,
    );
  }
  const currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  // 2. Parse, filter, mutate, re-serialise.
  let parsed: {
    _meta?: unknown;
    overrides?: Record<string, unknown>;
    pool?: Record<string, unknown>;
    [k: string]: unknown;
  };
  try {
    parsed = JSON.parse(currentContent);
  } catch (err) {
    throw new Error(
      `lookthrough.overrides.json on ${base} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const overrides = (parsed.overrides ?? {}) as Record<string, unknown>;
  const pool = (parsed.pool ?? {}) as Record<string, unknown>;

  const added: string[] = [];
  const skippedAlreadyPresent: string[] = [];
  for (const { isin, entry } of args.entries) {
    if (overrides[isin] || pool[isin]) {
      skippedAlreadyPresent.push(isin);
      continue;
    }
    pool[isin] = entry;
    added.push(isin);
  }
  if (added.length === 0) {
    // Nothing to add — caller should treat as "all already present".
    // Rare, but possible if a parallel admin run beat us to it.
    throw new Error(
      "Bulk look-through PR aborted: all requested ISINs are already in the base file.",
    );
  }
  parsed.pool = pool;
  const nextContent = JSON.stringify(parsed, null, 2) + "\n";

  // 3. Create the branch. Stamp encodes UTC YYYYMMDDHHmmss so consecutive
  //    runs don't collide and the branch name is human-readable.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const branch = `add-lookthrough-pool/bulk-${added.length}-${stamp}`;
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // 4. Commit the new file content on the branch.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
    branch,
    message: `Add ${added.length} ISINs to lookthrough pool (bulk backfill)`,
    content: Buffer.from(nextContent, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  // 5. Open the PR. Body lists every ISIN added so the reviewer can spot
  //    surprises quickly. Per-ISIN scrape stats kept on one line each.
  const isinLines = args.entries
    .filter((e) => added.includes(e.isin))
    .map((e) => {
      const top = e.entry.topHoldings.length;
      const geo = Object.keys(e.entry.geo).length;
      const sec = Object.keys(e.entry.sector).length;
      const name = e.entry.name ? ` — ${e.entry.name}` : "";
      return `- \`${e.isin}\`${name} (top=${top}, geo=${geo}, sector=${sec})`;
    });
  const skippedLines = skippedAlreadyPresent.map((i) => `- \`${i}\``);

  const body = [
    `Bulk-adds **${added.length}** ISINs to the look-through data pool (\`pool\` section of \`lookthrough.overrides.json\`).`,
    "",
    "Generated from `/admin` → Look-through-Datenpool → **Fehlende Daten holen**. Triggered when the operator wants every catalog ISIN covered immediately, instead of waiting for the next monthly cron tick.",
    "",
    "**Added**",
    ...isinLines,
    ...(skippedLines.length > 0
      ? [
          "",
          "**Skipped (already in base file at PR-open time)**",
          ...skippedLines,
        ]
      : []),
    "",
    "After merge + redeploy:",
    "- The admin pool table will list each new ISIN with `Quelle = Auto-Refresh`.",
    "- The Methodology override dialog will return a full profile for each, so the amber \"no look-through data\" warning auto-clears.",
    "",
    "The monthly refresh job will keep these entries up to date going forward.",
  ].join("\n");

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Backfill ${added.length} ISINs into lookthrough pool`,
    body,
  });

  return {
    url: pr.html_url,
    number: pr.number,
    added,
    skippedAlreadyPresent,
  };
}

export async function openAddEtfPr(
  entry: NewEtfEntry,
  ctx: PrCreationContext,
): Promise<{ url: string; number: number }> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read the current etfs.ts on the base branch.
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(`Unexpected GitHub response for ${ETFS_FILE_PATH}.`);
  }
  const currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  // 2. Insert the new entry into the CATALOG literal.
  const { content: nextContent, alreadyPresent } = injectEntry(
    currentContent,
    entry,
  );
  if (alreadyPresent) {
    throw new Error(
      `An entry with key "${entry.key}" already exists in the catalog.`,
    );
  }

  // 3. Create the branch — or, if a stale leftover exists from a previous
  // closed/merged PR, auto-recover by force-resetting it to baseSha. An
  // OPEN PR on the same branch still aborts (handled inside the helper).
  const branch = `add-etf/${entry.isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  // 4. Commit the modified file on the new branch.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: `Add ${entry.name} (${entry.isin}) to ETF catalog`,
    content: Buffer.from(nextContent, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  // 5. Open the PR. We re-render the same entry block we just inserted so
  // the PR body shows the literal TS GitHub will see — keeps the operator
  // and the reviewer looking at the same string.
  const renderedBlock = renderEntryBlock(entry, "  ");
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${entry.name} (${entry.isin}) to ETF catalog`,
    body: buildPrBody(entry, ctx, renderedBlock),
  });

  return { url: pr.html_url, number: pr.number };
}

// ---------------------------------------------------------------------------
// String-level catalog injection.
// ---------------------------------------------------------------------------

export function injectEntry(
  source: string,
  entry: NewEtfEntry,
): { content: string; alreadyPresent: boolean } {
  // Pre-flight: refuse if the bucket key is already in BUCKETS. The
  // INSTRUMENTS row may already exist (the ISIN could be referenced by
  // another bucket); we tolerate that and just append the BUCKETS row.
  const keyLine = new RegExp(
    `^\\s*"${escapeRegex(entry.key)}":\\s*B\\(`,
    "m",
  );
  if (keyLine.test(source)) {
    return { content: source, alreadyPresent: true };
  }

  // Step 1: ensure the INSTRUMENTS row exists. Append a fresh I({...})
  // entry only when the ISIN isn't already in the master table — the
  // operator may be reusing an existing instrument under a new bucket
  // (e.g. CHF vs EUR sleeves of the same fund).
  let next = source;
  let instrumentsBlock = findLiteralBlock(next, INSTRUMENTS_HEADER);
  if (!instrumentRowExists(next, instrumentsBlock, entry.isin)) {
    next = appendInstrumentRow(next, instrumentsBlock, entry);
    // BUCKETS literal moved when INSTRUMENTS grew; recompute below.
  }

  // Step 2: append the BUCKETS row. Recompute the block bounds because
  // step 1 may have shifted them.
  const bucketsBlock = findLiteralBlock(next, BUCKETS_HEADER);
  const bucketRow = renderBucketRow(entry.key, entry.isin, [], "  ");
  const before = next.slice(0, bucketsBlock.closeBrace);
  const after = next.slice(bucketsBlock.closeBrace);
  const trimmed = before.replace(/\s*$/, "");
  const content = `${trimmed}\n${bucketRow}\n${after}`;
  return { content, alreadyPresent: false };
}

function buildPrBody(
  entry: NewEtfEntry,
  ctx: PrCreationContext,
  renderedBlock: string,
): string {
  const fitLines = [
    `- AUM > €100M: ${ctx.policyFit.aumOk ? "yes" : "no"} (${
      entry.aumMillionsEUR ?? "n/a"
    } MEUR)`,
    `- TER < 0.30%: ${ctx.policyFit.terOk ? "yes" : "no"} (${(
      entry.terBps / 100
    ).toFixed(2)}%)`,
  ];
  for (const note of ctx.policyFit.notes) fitLines.push(`- ${note}`);
  return [
    `Adds **${entry.name}** (\`${entry.isin}\`) to the ETF catalog under key \`${entry.key}\`.`,
    "",
    "Generated from the in-app admin pane. Please review:",
    "",
    "**Policy fit**",
    ...fitLines,
    "",
    "**Generated entry**",
    "",
    "```ts",
    renderedBlock,
    "```",
    "",
    "**Reviewer checklist**",
    "- Confirm the catalog key is in the right asset class.",
    "- Confirm `defaultExchange` matches your preferred listing.",
    "- Confirm the `comment` is accurate (it shows up in tooltips).",
    "- Confirm the listings are real (cross-check on justETF).",
    "",
    "After merging, the next scheduled refresh will populate the override layer.",
  ].join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Bucket-alternative injection (per-bucket picker, 2026-04-28).
// ---------------------------------------------------------------------------
// An "alternative" is a bare object literal that lives inside a parent
// catalog entry's `alternatives: [...]` array. It is NOT wrapped in
// `E({...})` (the `E` helper applies the `kind: "etf"` discriminator only
// to top-level catalog entries) and has no `key` field (alternatives are
// addressed positionally by slot index 1..MAX_ALTERNATIVES_PER_BUCKET).
//
// Two cases the injector handles:
//   1. Parent already has `alternatives: [ ... ]` — append the new
//      alternative just before the closing `]`.
//   2. Parent has no alternatives field — insert
//      `alternatives: [ ... ],` just before the parent's closing `})`.
// ---------------------------------------------------------------------------

export type InjectAlternativeStatus =
  | "ok"
  | "parent_missing"
  | "isin_present"
  | "cap_exceeded";

export interface InjectAlternativeResult {
  content: string;
  status: InjectAlternativeStatus;
  // When status === "isin_present", the catalog key (or "<key> alt N")
  // where the conflict was found, so the operator gets actionable feedback.
  conflict?: string;
}

export function injectAlternative(
  source: string,
  parentKey: string,
  entry: NewAlternativeEntry,
): InjectAlternativeResult {
  // Pre-flight #1: parent bucket must exist in BUCKETS.
  const bucketsBlock = findLiteralBlock(source, BUCKETS_HEADER);
  const bucketBody = findBucketEntry(source, bucketsBlock, parentKey);
  if (!bucketBody) {
    return { content: source, status: "parent_missing" };
  }

  // Pre-flight #2: ISIN must be globally unique across every bucket
  // (default OR alternative). The joined parser is the single source of
  // truth for that invariant — it walks the same INSTRUMENTS+BUCKETS
  // tree the runtime engine reads from.
  const normIsin = entry.isin.trim().toUpperCase();
  if (normIsin) {
    const summary = parseCatalogFromSource(source);
    for (const [k, e] of Object.entries(summary)) {
      if (e.isin.toUpperCase() === normIsin) {
        return { content: source, status: "isin_present", conflict: k };
      }
      if (e.alternatives) {
        for (let i = 0; i < e.alternatives.length; i++) {
          if (e.alternatives[i].isin.toUpperCase() === normIsin) {
            return {
              content: source,
              status: "isin_present",
              conflict: `${k} alt ${i + 1}`,
            };
          }
        }
      }
    }
  }

  // Pre-flight #3: cap. Read existing alternatives ISINs in the bucket.
  const altsField = findBucketAlternatives(source, bucketBody);
  if (!altsField) {
    throw new Error(
      `BUCKETS["${parentKey}"] has no \`alternatives:\` field — refusing to edit. The catalog convention requires every bucket to declare an empty array.`,
    );
  }
  if (altsField.isins.length >= MAX_ALTERNATIVES_PER_BUCKET) {
    return { content: source, status: "cap_exceeded" };
  }

  // Step A: insert the new ISIN string into BUCKETS[parentKey].
  // alternatives. Single-line array style — append `, "ISIN"` before `]`
  // when non-empty, or replace `[]` with `["ISIN"]` when empty.
  const newIsins = [...altsField.isins, entry.isin];
  const newArrayLiteral = `[${newIsins.map((s) => JSON.stringify(s)).join(", ")}]`;
  let next =
    source.slice(0, altsField.openBracket) +
    newArrayLiteral +
    source.slice(altsField.closeBracket + 1);

  // Step B: ensure INSTRUMENTS has a row for this ISIN. Indices in the
  // INSTRUMENTS literal shifted by `next`'s length change vs `source`,
  // so we re-locate the literal in the mutated buffer.
  const instrumentsBlock = findLiteralBlock(next, INSTRUMENTS_HEADER);
  if (!instrumentRowExists(next, instrumentsBlock, entry.isin)) {
    // Reuse renderInstrumentRow via NewEtfEntry shape — alternatives
    // carry the same per-fund metadata (no `key`), so we synthesise a
    // throwaway key field from the ISIN. The renderer ignores `key`
    // (it emits the ISIN as the row literal key).
    const instrumentEntry: NewEtfEntry = {
      key: entry.isin,
      name: entry.name,
      isin: entry.isin,
      terBps: entry.terBps,
      domicile: entry.domicile,
      replication: entry.replication,
      distribution: entry.distribution,
      currency: entry.currency,
      comment: entry.comment,
      defaultExchange: entry.defaultExchange,
      listings: entry.listings,
      ...(entry.aumMillionsEUR !== undefined
        ? { aumMillionsEUR: entry.aumMillionsEUR }
        : {}),
      ...(entry.inceptionDate ? { inceptionDate: entry.inceptionDate } : {}),
    };
    next = appendInstrumentRow(next, instrumentsBlock, instrumentEntry);
  }

  return { content: next, status: "ok" };
}

// Find the byte index of `<name>:` at the top level of `body`. Skips
// occurrences inside strings and comments using the same walker as
// findMatchingClose. Returns -1 if not found at depth 0.
function findFieldIndex(body: string, name: string): number {
  let depth = 0;
  let i = 0;
  const needle = `${name}:`;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"') {
      i++;
      while (i < body.length) {
        const c = body[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length - 1 && !(body[i] === "*" && body[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    if (
      depth === 0 &&
      (i === 0 || /[\s,]/.test(body[i - 1])) &&
      body.slice(i, i + needle.length) === needle
    ) {
      return i;
    }
    i++;
  }
  return -1;
}

// String- and comment-aware `[...]` matcher (mirror of findMatchingClose).
// Local copy because catalog-parser's version is module-private.
function findMatchingBracket(source: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      i++;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (
        i < source.length - 1 &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Counts the number of top-level `{...}` objects inside an array body
// (used to enforce the alts-cap pre-flight). String- and comment-aware.
function countTopLevelObjects(arrayBody: string): number {
  let count = 0;
  let i = 0;
  while (i < arrayBody.length) {
    const ch = arrayBody[i];
    if (ch === '"') {
      i++;
      while (i < arrayBody.length) {
        const c = arrayBody[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && arrayBody[i + 1] === "/") {
      while (i < arrayBody.length && arrayBody[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && arrayBody[i + 1] === "*") {
      i += 2;
      while (
        i < arrayBody.length - 1 &&
        !(arrayBody[i] === "*" && arrayBody[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "{") {
      count++;
      const close = findMatchingClose(arrayBody, i);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    i++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// openBulkAddBucketAlternativesPr — admin "batch add alternatives" (Task #51)
// ---------------------------------------------------------------------------
// Adds N curated alternatives to etfs.ts in a SINGLE PR. Mirrors the
// design of openBulkAddLookthroughPoolPr: read base content once, apply
// every row in-memory against the accumulating buffer (so each row sees
// the previous row's insertion when computing isin-dup / cap), then open
// one PR with one commit.
//
// Why one PR, not N: the existing per-row endpoint opens a PR per ISIN.
// When the operator queues 5 ETFs into the same bucket, each PR fights
// the previous one for `etfs.ts` and most land in `dirty` state until
// rebased one by one. One PR collapses N would-be conflicts into N-1
// no-ops.
//
// Branch name: `add-alt/bulk-{N}-{stamp}` so listOpenPrs can scope to
// the add-alt flow distinctly from per-row branches (`add-alt/<isin>`)
// and the timestamp prevents collisions on consecutive bulk runs.
//
// Per-row outcome: every input row gets one entry in the returned
// `perRow` array (status `ok | parent_missing | isin_present |
// cap_exceeded`). The caller decides how to surface skips. We refuse
// to open a PR if zero rows succeed — there is nothing to commit.
// ---------------------------------------------------------------------------
export interface BulkBucketAltRowOutcome {
  parentKey: string;
  isin: string;
  status: InjectAlternativeStatus;
  // When status === "isin_present", the catalog key (or "<key> alt N",
  // or "(this batch)" if the dup is between two rows of the same batch)
  // where the conflict was found.
  conflict?: string;
}

export async function openBulkAddBucketAlternativesPr(args: {
  rows: Array<{ parentKey: string; entry: NewAlternativeEntry }>;
}): Promise<{
  url: string;
  number: number;
  perRow: BulkBucketAltRowOutcome[];
  added: Array<{ parentKey: string; isin: string }>;
}> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  if (args.rows.length === 0) {
    throw new Error("openBulkAddBucketAlternativesPr called with zero rows.");
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read base SHA + current etfs.ts content from the base branch.
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(`Unexpected GitHub response for ${ETFS_FILE_PATH}.`);
  }
  let currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  // 2. Apply each row sequentially against the accumulating buffer. The
  //    in-memory recursion is what makes the batch self-consistent: row 2
  //    sees row 1's insertion when injectAlternative re-parses the
  //    catalog for its ISIN-dup pre-flight, so two rows trying to add the
  //    same ISIN in the same batch produce the same `isin_present`
  //    outcome the second one would get if they were submitted serially.
  const perRow: BulkBucketAltRowOutcome[] = [];
  const added: Array<{ parentKey: string; isin: string }> = [];
  for (const row of args.rows) {
    const result = injectAlternative(currentContent, row.parentKey, row.entry);
    perRow.push({
      parentKey: row.parentKey,
      isin: row.entry.isin,
      status: result.status,
      ...(result.conflict ? { conflict: result.conflict } : {}),
    });
    if (result.status === "ok") {
      currentContent = result.content;
      added.push({ parentKey: row.parentKey, isin: row.entry.isin });
    }
  }

  if (added.length === 0) {
    throw new Error(
      "Bulk add-alternatives PR aborted: zero rows produced a usable change. Inspect the per-row outcomes for the reason (parent missing, ISIN already present, cap exceeded).",
    );
  }

  // 3. Create branch with deterministic-ish name. Stamp encodes UTC
  //    YYYYMMDDHHmmss so consecutive runs don't collide and the branch
  //    name tells the operator at a glance how many entries are inside.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const branch = `add-alt/bulk-${added.length}-${stamp}`;
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // 4. Single commit with the fully-accumulated content.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: `Add ${added.length} curated alternatives across ${
      new Set(added.map((a) => a.parentKey)).size
    } buckets (batch)`,
    content: Buffer.from(currentContent, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  // 5. PR body: list every added row + every skipped row with reason
  //    so the reviewer sees the same per-row table the operator saw in
  //    the preview UI. Group by parent key for readability.
  const skipped = perRow.filter((r) => r.status !== "ok");
  const addedByBucket = new Map<string, BulkBucketAltRowOutcome[]>();
  for (const row of perRow.filter((r) => r.status === "ok")) {
    const list = addedByBucket.get(row.parentKey) ?? [];
    list.push(row);
    addedByBucket.set(row.parentKey, list);
  }
  const addedSection: string[] = [];
  for (const [bucket, rows] of addedByBucket) {
    addedSection.push(`- **${bucket}**`);
    for (const r of rows) {
      const meta = args.rows.find(
        (x) => x.parentKey === r.parentKey && x.entry.isin === r.isin,
      );
      const name = meta?.entry.name ? ` — ${meta.entry.name}` : "";
      addedSection.push(`  - \`${r.isin}\`${name}`);
    }
  }
  const skippedLines = skipped.map((r) => {
    const reason =
      r.status === "parent_missing"
        ? "parent bucket missing"
        : r.status === "isin_present"
          ? `ISIN already present${r.conflict ? ` (${r.conflict})` : ""}`
          : r.status === "cap_exceeded"
            ? `bucket already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives`
            : r.status;
    return `- \`${r.parentKey}\` / \`${r.isin}\` — ${reason}`;
  });

  const body = [
    `Bulk-adds **${added.length}** curated alternatives across **${
      new Set(added.map((a) => a.parentKey)).size
    }** buckets.`,
    "",
    "Generated from `/admin` → Batch-Add-Alternatives. One PR collapses what would otherwise be one-PR-per-ISIN; rows that failed validation are listed below and were not committed.",
    "",
    "**Added**",
    ...addedSection,
    ...(skippedLines.length > 0
      ? ["", "**Skipped (validated server-side, not committed)**", ...skippedLines]
      : []),
    "",
    "**Reviewer checklist**",
    "- Confirm each ISIN is the correct alternative for its bucket.",
    `- Confirm the per-bucket cap (default + ≤ ${MAX_ALTERNATIVES_PER_BUCKET} alternatives) is respected after merge.`,
    "- The companion look-through PR (if any) lives on a separate branch and can merge independently.",
  ].join("\n");

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${added.length} curated alternatives (batch)`,
    body,
  });

  return {
    url: pr.html_url,
    number: pr.number,
    perRow,
    added,
  };
}

// ---------------------------------------------------------------------------
// openAddBucketAlternativePr — orchestration mirroring openAddEtfPr.
// ---------------------------------------------------------------------------
// Branch name: `add-alt/<isin-lower>` so listOpenPrs can scope to this flow
// the same way it does for `add-etf/`.
// ---------------------------------------------------------------------------
export async function openAddBucketAlternativePr(
  parentKey: string,
  entry: NewAlternativeEntry,
): Promise<{ url: string; number: number }> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  // 1. Read the current etfs.ts on the base branch.
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(`Unexpected GitHub response for ${ETFS_FILE_PATH}.`);
  }
  const currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  // 2. Inject the alternative. Translate the typed status into the same
  // exception shape the route handler expects (so the operator sees a
  // useful error message rather than a stack trace).
  const result = injectAlternative(currentContent, parentKey, entry);
  if (result.status === "parent_missing") {
    throw new Error(`Parent bucket "${parentKey}" not found in catalog.`);
  }
  if (result.status === "isin_present") {
    throw new Error(
      `ISIN ${entry.isin} is already used by "${result.conflict}". Pick a different ISIN.`,
    );
  }
  if (result.status === "cap_exceeded") {
    throw new Error(
      `"${parentKey}" already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives. Remove one before adding another.`,
    );
  }

  // 3. Create the branch — or auto-recover a stale leftover (Task #48).
  const branch = `add-alt/${entry.isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  // 4. Commit the modified file.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: `Add ${entry.name} (${entry.isin}) as alternative under ${parentKey}`,
    content: Buffer.from(result.content, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  // 5. Open the PR.
  const renderedBlock = renderAlternativeBlock(entry, "      ");
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${entry.name} (${entry.isin}) as alternative under ${parentKey}`,
    body: buildAlternativePrBody(parentKey, entry, renderedBlock),
  });

  return { url: pr.html_url, number: pr.number };
}

// ---------------------------------------------------------------------------
// removeAlternative — pure mirror of injectAlternative for deletion (2026-04-28)
// ---------------------------------------------------------------------------
// Locates the matching `{ ... }` block by ISIN inside the parent's
// `alternatives:[…]` array and excises it (along with the trailing comma
// + newline, mirroring the hand-written catalog style). Look-through pool
// data lives in lookthrough.overrides.json — completely separate from
// etfs.ts — so removing an alt here NEVER touches the look-through data
// pool. That is the contract operators rely on: "remove from picker but
// keep the per-ISIN holdings/geo/sector profile so the engine still has
// data if anyone references that ISIN elsewhere".
// ---------------------------------------------------------------------------
export type RemoveAlternativeStatus =
  | "ok"
  | "parent_missing"
  | "isin_not_found";

export interface RemoveAlternativeResult {
  content: string;
  status: RemoveAlternativeStatus;
}

// Task #111: replace the `default` ISIN of a bucket. Used by the future
// "set Default" picker in the tree-row UI. Returns `parent_missing`
// when the bucket key is not in BUCKETS, `default_unchanged` when the
// new ISIN is identical to the current default (idempotent no-op), or
// `ok` with the mutated source.
//
// We do NOT validate that the new ISIN exists in INSTRUMENTS — the
// caller is expected to chain this with a separate "ensure instrument"
// step (admin Instruments sub-tab CRUD). The runtime catalog joiner
// throws if a bucket points at a missing instrument, so the operator
// would see the error on the next reload.
export type SetBucketDefaultStatus =
  | "ok"
  | "parent_missing"
  | "default_unchanged";
export interface SetBucketDefaultResult {
  content: string;
  status: SetBucketDefaultStatus;
}
export function setBucketDefault(
  source: string,
  parentKey: string,
  newDefaultIsin: string,
): SetBucketDefaultResult {
  const bucketsBlock = findLiteralBlock(source, BUCKETS_HEADER);
  const bucketBody = findBucketEntry(source, bucketsBlock, parentKey);
  if (!bucketBody) {
    return { content: source, status: "parent_missing" };
  }
  const inner = source.slice(bucketBody.openBrace + 1, bucketBody.closeBrace);
  // Find `default:` at depth 0 within the bucket body. The catalog's
  // hand-written shape always has it as the first field.
  const defIdx = findFieldIndex(inner, "default");
  if (defIdx < 0) {
    throw new Error(
      `BUCKETS["${parentKey}"] has no \`default:\` field — refusing to edit.`,
    );
  }
  // Locate the quoted string value after `default:`.
  let cursor = defIdx + "default:".length;
  while (cursor < inner.length && /\s/.test(inner[cursor])) cursor++;
  if (inner[cursor] !== '"') {
    throw new Error(
      `BUCKETS["${parentKey}"].default is not a string literal — refusing to edit.`,
    );
  }
  const valStart = cursor + 1;
  let i = valStart;
  while (i < inner.length && inner[i] !== '"') {
    if (inner[i] === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  const currentDefault = inner.slice(valStart, i);
  if (currentDefault.toUpperCase() === newDefaultIsin.trim().toUpperCase()) {
    return { content: source, status: "default_unchanged" };
  }
  const absStart = bucketBody.openBrace + 1 + valStart;
  const absEnd = bucketBody.openBrace + 1 + i;
  const content =
    source.slice(0, absStart) + newDefaultIsin + source.slice(absEnd);
  return { content, status: "ok" };
}

export function removeAlternative(
  source: string,
  parentKey: string,
  isin: string,
): RemoveAlternativeResult {
  const bucketsBlock = findLiteralBlock(source, BUCKETS_HEADER);
  const bucketBody = findBucketEntry(source, bucketsBlock, parentKey);
  if (!bucketBody) {
    return { content: source, status: "parent_missing" };
  }
  const altsField = findBucketAlternatives(source, bucketBody);
  if (!altsField) {
    return { content: source, status: "isin_not_found" };
  }
  const target = isin.trim().toUpperCase();
  const remaining = altsField.isins.filter(
    (s) => s.toUpperCase() !== target,
  );
  if (remaining.length === altsField.isins.length) {
    return { content: source, status: "isin_not_found" };
  }
  // Rebuild the array literal in the catalog's single-line style.
  const newArrayLiteral =
    remaining.length === 0
      ? "[]"
      : `[${remaining.map((s) => JSON.stringify(s)).join(", ")}]`;
  const content =
    source.slice(0, altsField.openBracket) +
    newArrayLiteral +
    source.slice(altsField.closeBracket + 1);
  // INSTRUMENTS table is intentionally left untouched — an instrument
  // may be referenced by another bucket, and even when orphaned, deleting
  // the row is a separate explicit operation (see future Instruments
  // sub-tab DELETE flow).
  return { content, status: "ok" };
}

// ---------------------------------------------------------------------------
// openRemoveBucketAlternativePr — orchestration mirroring openAddBucketAlternativePr
// ---------------------------------------------------------------------------
// Branch name: `rm-alt/<isin-lower>` so listOpenPrs can scope to the
// removal flow distinctly from add-alt.
// ---------------------------------------------------------------------------
export async function openRemoveBucketAlternativePr(
  parentKey: string,
  isin: string,
): Promise<{ url: string; number: number }> {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub PR creation is not configured. Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO.",
    );
  }
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const base = process.env.GITHUB_BASE_BRANCH ?? "main";
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;

  const { data: fileMeta } = await octokit.repos.getContent({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    ref: baseSha,
  });
  if (Array.isArray(fileMeta) || fileMeta.type !== "file") {
    throw new Error(`Unexpected GitHub response for ${ETFS_FILE_PATH}.`);
  }
  const currentContent = Buffer.from(fileMeta.content, "base64").toString(
    "utf8",
  );

  const result = removeAlternative(currentContent, parentKey, isin);
  if (result.status === "parent_missing") {
    throw new Error(`Parent bucket "${parentKey}" not found in catalog.`);
  }
  if (result.status === "isin_not_found") {
    throw new Error(
      `ISIN ${isin} is not an alternative under "${parentKey}". Nothing to remove.`,
    );
  }

  // Create the branch — or auto-recover a stale leftover (Task #48).
  const branch = `rm-alt/${isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: `Remove ${isin} from alternatives under ${parentKey}`,
    content: Buffer.from(result.content, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Remove ${isin} from alternatives under ${parentKey}`,
    body: [
      `Removes ISIN \`${isin}\` from the curated alternatives of bucket \`${parentKey}\`.`,
      "",
      "Generated from the in-app admin pane (Bucket Alternatives editor).",
      "",
      "**Note:** the per-ISIN look-through profile in `lookthrough.overrides.json` is intentionally **not** touched. The ETF disappears from the per-bucket picker but its holdings / country / sector breakdown stays in the look-through data pool, so any other reference (look-through aggregation, methodology overrides) keeps working.",
      "",
      "**Reviewer checklist**",
      `- Confirm the operator intended to retire this alternative for \`${parentKey}\`.`,
      "- After merging the picker no longer offers this ISIN — verify with a Build-tab refresh.",
    ].join("\n"),
  });

  return { url: pr.html_url, number: pr.number };
}

function buildAlternativePrBody(
  parentKey: string,
  entry: NewAlternativeEntry,
  renderedBlock: string,
): string {
  return [
    `Adds **${entry.name}** (\`${entry.isin}\`) as a curated alternative under bucket \`${parentKey}\`.`,
    "",
    "Generated from the in-app admin pane (Bucket Alternatives editor). Please review:",
    "",
    "**Generated alternative entry**",
    "",
    "```ts",
    renderedBlock,
    "```",
    "",
    "**Reviewer checklist**",
    `- Confirm \`${parentKey}\` is the correct bucket for this ETF (operator phrase: every ETF needs a unique bucket assignment).`,
    "- Confirm the ISIN is not already used by any other catalog entry or alternative (the in-app validator enforces this, but a manual check is cheap insurance).",
    "- Confirm `defaultExchange` matches your preferred listing.",
    "- Confirm the `comment` is accurate (it shows up in tooltips and in the picker dropdown).",
    "",
    "After merging, the new alternative becomes selectable in the Build tab's per-bucket ETF picker.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// listOpenPrs — used by the admin UI to render a reliable "open PRs awaiting
// merge" list inline. Critically uses the REST list-pulls API (not the
// search API) so it's not affected by the GitHub search-index lag that
// occasionally causes the public /pulls page to show "0 open" for new
// repos with low activity (real bug, 2026-04-27).
//
// `prefix` filters to PRs whose head branch starts with the given string —
// e.g. "add-lookthrough-pool/" to scope the list to a single admin flow.
// Pass undefined / empty to get all open PRs in the repo.
// ---------------------------------------------------------------------------
export interface OpenPrInfo {
  number: number;
  url: string;
  title: string;
  headRef: string;
  createdAt: string;
  draft: boolean;
}

export async function listOpenPrs(prefix?: string): Promise<OpenPrInfo[]> {
  if (!githubConfigured()) return [];
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const octokit = new Octokit({ auth: process.env.GITHUB_PAT });
  // Paginate fully (per_page max 100). The whole point of this helper is to
  // be a *reliable* source of truth for the operator — silently capping at
  // page 1 would re-introduce the same "missing PR" class of bug we built
  // this widget to defeat. NEVER use the search API here (search-index lag
  // is the entire reason for this work).
  const all = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
    sort: "created",
    direction: "desc",
  });
  const filtered = prefix ? all.filter((p) => p.head.ref.startsWith(prefix)) : all;
  return filtered.map((p) => ({
    number: p.number,
    url: p.html_url,
    title: p.title,
    headRef: p.head.ref,
    createdAt: p.created_at,
    draft: p.draft ?? false,
  }));
}
