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
import {
  findMatchingClose,
  parseCatalogFromSource,
  parseInstrumentsFromSource,
} from "./catalog-parser";
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
// commitMultiFile — single commit, N file changes (Task #122, 2026-04-29)
// ---------------------------------------------------------------------------
// Replaces the per-file `repos.createOrUpdateFileContents` idiom for the
// "+ Alternative" admin flows (single, bulk, attach). Those flows now
// touch BOTH `etfs.ts` AND `lookthrough.overrides.json` in ONE PR — the
// per-file helper would land two commits on the same branch (and, more
// importantly, two separate PRs in the operator's queue), defeating
// the unification of the ETF master list and the look-through data
// promised by Task #122.
//
// The branch MUST already exist — call `ensureFreshBranch` first. The
// final `git.updateRef` uses `force: true` so a stale branch reset
// in-place by ensureFreshBranch can be advanced cleanly to the new
// commit (the previous tip was just a copy of `baseSha` so there's
// nothing to lose).
//
// Files are sent inline as UTF-8 strings; GitHub creates the blobs
// transparently. `mode: "100644"` matches the file mode of every text
// file we currently commit through this code path.
// ---------------------------------------------------------------------------
export async function commitMultiFile(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  baseSha: string;
  files: Array<{ path: string; content: string }>;
  message: string;
}): Promise<{ commitSha: string }> {
  const { octokit, owner, repo, branch, baseSha, files, message } = args;
  if (files.length === 0) {
    throw new Error("commitMultiFile called with zero files.");
  }
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const { data: tree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: files.map((f) => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      content: f.content,
    })),
  });
  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
    force: true,
  });
  return { commitSha: commit.sha };
}

// ---------------------------------------------------------------------------
// mergeLookthroughEntries — pure JSON merge for the unified PR helpers
// ---------------------------------------------------------------------------
// Takes the current `lookthrough.overrides.json` content and a list of
// (isin, entry) pairs to inject. Mirrors `openAddLookthroughPoolPr`'s
// behaviour:
//   • An ISIN already present in EITHER `pool` OR `overrides` is a
//     skip — never overwritten (curated overrides win, refresh job
//     replaces pool entries via its own path).
//   • A new ISIN lands under `pool[isin]` (same key the auto-refresh
//     job writes to, distinct from the curated `overrides` baseline).
// Returns the new JSON content, the list of accepted ISINs, and the
// list of skipped ISINs for caller-side outcome reporting.
// ---------------------------------------------------------------------------
export function mergeLookthroughEntries(args: {
  currentContent: string;
  entries: Array<{ isin: string; entry: LookthroughPoolEntry }>;
}): {
  nextContent: string;
  added: string[];
  skippedAlreadyPresent: string[];
} {
  let parsed: {
    _meta?: unknown;
    overrides?: Record<string, unknown>;
    pool?: Record<string, unknown>;
    [k: string]: unknown;
  };
  try {
    parsed = JSON.parse(args.currentContent);
  } catch (err) {
    throw new Error(
      `lookthrough.overrides.json is not valid JSON: ${
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
  parsed.pool = pool;
  const nextContent = added.length === 0
    ? args.currentContent
    : JSON.stringify(parsed, null, 2) + "\n";
  return { nextContent, added, skippedAlreadyPresent };
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
  const injectResult = injectEntry(currentContent, entry);
  if (injectResult.status === "key_present") {
    throw new Error(
      `An entry with key "${entry.key}" already exists in the catalog.`,
    );
  }
  if (injectResult.status === "isin_in_use") {
    throw new Error(
      `ISIN ${entry.isin} is already assigned to bucket "${injectResult.conflict}". Every ISIN may belong to at most one bucket — pick a different ISIN or remove it from "${injectResult.conflict}" first.`,
    );
  }
  const nextContent = injectResult.content;

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

export type InjectEntryStatus = "ok" | "key_present" | "isin_in_use";
export interface InjectEntryResult {
  content: string;
  status: InjectEntryStatus;
  // When status === "isin_in_use", the bucket key (or "<key> alt N")
  // where the ISIN is already assigned, so the operator gets an
  // actionable error rather than a generic "duplicate" message.
  conflict?: string;
}

export function injectEntry(
  source: string,
  entry: NewEtfEntry,
): InjectEntryResult {
  // Pre-flight #1: refuse if the bucket key is already in BUCKETS.
  const keyLine = new RegExp(
    `^\\s*"${escapeRegex(entry.key)}":\\s*B\\(`,
    "m",
  );
  if (keyLine.test(source)) {
    return { content: source, status: "key_present" };
  }

  // Pre-flight #2: strict cross-bucket ISIN uniqueness (Task #111).
  // The INSTRUMENTS table may already carry this ISIN as an orphaned
  // row (created via the Instruments sub-tab without a bucket
  // assignment); that's fine — we just don't append a duplicate row
  // below. What we MUST refuse is creating a new BUCKETS entry whose
  // default ISIN already lives in another bucket (default OR alt).
  const normIsin = entry.isin.trim().toUpperCase();
  if (normIsin) {
    const summary = parseCatalogFromSource(source);
    for (const [k, e] of Object.entries(summary)) {
      if (e.isin.toUpperCase() === normIsin) {
        return { content: source, status: "isin_in_use", conflict: k };
      }
      if (e.alternatives) {
        for (let i = 0; i < e.alternatives.length; i++) {
          if (e.alternatives[i].isin.toUpperCase() === normIsin) {
            return {
              content: source,
              status: "isin_in_use",
              conflict: `${k} alt ${i + 1}`,
            };
          }
        }
      }
    }
  }

  // Step 1: ensure the INSTRUMENTS row exists. Append a fresh I({...})
  // entry only when the ISIN isn't already in the master table — an
  // unassigned-instrument row may exist already.
  let next = source;
  const instrumentsBlock = findLiteralBlock(next, INSTRUMENTS_HEADER);
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
  return { content, status: "ok" };
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
  // Task #122 (T004): optional look-through bundle. When non-empty,
  // the PR carries lookthrough.overrides.json changes in the SAME
  // commit as the etfs.ts changes — collapsing what used to be one
  // etfs.ts PR + one look-through PR into a single review surface.
  // Entries already present in `pool` or `overrides` are silently
  // skipped at merge time and surface in `lookthroughSkippedAlreadyPresent`.
  lookthroughEntries?: Array<{ isin: string; entry: LookthroughPoolEntry }>;
}): Promise<{
  url: string;
  number: number;
  perRow: BulkBucketAltRowOutcome[];
  added: Array<{ parentKey: string; isin: string }>;
  // Task #122 (T004): per-ISIN outcome of the look-through bundle.
  // `lookthroughAdded` is the subset of `lookthroughEntries` that
  // actually landed in the PR (the rest were already in the file at
  // PR-open time).
  lookthroughAdded: string[];
  lookthroughSkippedAlreadyPresent: string[];
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

  // 2b. Build the look-through bundle in-memory (Task #122 T004). We
  //     scope the entries to ISINs that actually made it into `added`
  //     so the JSON change stays consistent with the etfs.ts change —
  //     no orphan look-through entry lands when its row was skipped
  //     (parent missing, isin dup vs catalog, cap exceeded).
  const addedIsins = new Set(added.map((a) => a.isin.toUpperCase()));
  const lookthroughCandidates = (args.lookthroughEntries ?? []).filter((e) =>
    addedIsins.has(e.isin.toUpperCase()),
  );
  let lookthroughAdded: string[] = [];
  let lookthroughSkippedAlreadyPresent: string[] = [];
  let nextLookthroughContent: string | null = null;
  if (lookthroughCandidates.length > 0) {
    const { data: ltMeta } = await octokit.repos.getContent({
      owner,
      repo,
      path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
      ref: baseSha,
    });
    if (Array.isArray(ltMeta) || ltMeta.type !== "file") {
      throw new Error(
        `Unexpected GitHub response for ${LOOKTHROUGH_OVERRIDES_FILE_PATH}.`,
      );
    }
    const ltCurrent = Buffer.from(ltMeta.content, "base64").toString("utf8");
    const merged = mergeLookthroughEntries({
      currentContent: ltCurrent,
      entries: lookthroughCandidates,
    });
    lookthroughAdded = merged.added;
    lookthroughSkippedAlreadyPresent = merged.skippedAlreadyPresent;
    if (merged.added.length > 0) {
      nextLookthroughContent = merged.nextContent;
    }
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

  // 4. Single commit with the fully-accumulated content. When the
  //    look-through bundle is active, the JSON change rides along in
  //    the SAME commit via commitMultiFile (Task #122).
  const commitMessage = `Add ${added.length} curated alternatives across ${
    new Set(added.map((a) => a.parentKey)).size
  } buckets (batch)${
    lookthroughAdded.length > 0
      ? ` + ${lookthroughAdded.length} look-through entries`
      : ""
  }`;
  if (nextLookthroughContent !== null) {
    await commitMultiFile({
      octokit,
      owner,
      repo,
      branch,
      baseSha,
      message: commitMessage,
      files: [
        { path: ETFS_FILE_PATH, content: currentContent },
        {
          path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
          content: nextLookthroughContent,
        },
      ],
    });
  } else {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: ETFS_FILE_PATH,
      branch,
      message: commitMessage,
      content: Buffer.from(currentContent, "utf8").toString("base64"),
      sha: fileMeta.sha,
    });
  }

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
    }** buckets${lookthroughAdded.length > 0 ? ` and bundles **${lookthroughAdded.length}** look-through entries` : ""}.`,
    "",
    "Generated from `/admin` → Batch-Add-Alternatives. One PR collapses what would otherwise be one-PR-per-ISIN; rows that failed validation are listed below and were not committed.",
    ...(lookthroughAdded.length > 0
      ? [
          "",
          "Look-through data (`lookthrough.overrides.json`, `pool` section) for the added ISINs is bundled in the SAME commit so the alternatives are usable on day 1 without waiting for the monthly refresh job.",
        ]
      : []),
    "",
    "**Added**",
    ...addedSection,
    ...(skippedLines.length > 0
      ? ["", "**Skipped (validated server-side, not committed)**", ...skippedLines]
      : []),
    ...(lookthroughSkippedAlreadyPresent.length > 0
      ? [
          "",
          "**Look-through bundle skips (already in `lookthrough.overrides.json`)**",
          ...lookthroughSkippedAlreadyPresent.map((isin) => `- \`${isin}\``),
        ]
      : []),
    "",
    "**Reviewer checklist**",
    "- Confirm each ISIN is the correct alternative for its bucket.",
    `- Confirm the per-bucket cap (default + ≤ ${MAX_ALTERNATIVES_PER_BUCKET} alternatives) is respected after merge.`,
    ...(lookthroughAdded.length > 0
      ? [
          "- Spot-check the bundled look-through entries (top-holding names, geo / sector totals near 1.0).",
        ]
      : []),
  ].join("\n");

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${added.length} curated alternatives (batch)${lookthroughAdded.length > 0 ? " + look-through bundle" : ""}`,
    body,
  });

  return {
    url: pr.html_url,
    number: pr.number,
    perRow,
    added,
    lookthroughAdded,
    lookthroughSkippedAlreadyPresent,
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
  // Task #122 (T004): optional look-through bundle. When provided, the
  // PR carries a SECOND file change (lookthrough.overrides.json) in the
  // SAME commit so the operator's queue collapses from two PRs to one.
  // If the JSON already has data for this ISIN (in `pool` or
  // `overrides`), the bundle is silently skipped — the etfs.ts change
  // still goes through and `lookthroughIncluded` reports false.
  lookthroughEntry?: { isin: string; entry: LookthroughPoolEntry },
): Promise<{
  url: string;
  number: number;
  // True iff the PR included a `lookthrough.overrides.json` change.
  // False either because no entry was passed, or because the JSON
  // already had data for this ISIN at PR-open time (race with a
  // concurrent merge).
  lookthroughIncluded: boolean;
}> {
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

  // 2b. Build the look-through file change in-memory (if requested).
  // We read the JSON from the same baseSha so the multi-file commit
  // sits on a consistent snapshot. The merge helper skips ISINs that
  // are already in `overrides` or `pool` — that's the race-window
  // case (another PR landed between admin.ts's pre-flight read and
  // ours), and it's the only reason `lookthroughIncluded` may flip
  // back to false here.
  let lookthroughIncluded = false;
  let nextLookthroughContent: string | null = null;
  if (lookthroughEntry) {
    const { data: ltMeta } = await octokit.repos.getContent({
      owner,
      repo,
      path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
      ref: baseSha,
    });
    if (Array.isArray(ltMeta) || ltMeta.type !== "file") {
      throw new Error(
        `Unexpected GitHub response for ${LOOKTHROUGH_OVERRIDES_FILE_PATH}.`,
      );
    }
    const ltCurrent = Buffer.from(ltMeta.content, "base64").toString("utf8");
    const merged = mergeLookthroughEntries({
      currentContent: ltCurrent,
      entries: [lookthroughEntry],
    });
    if (merged.added.length > 0) {
      lookthroughIncluded = true;
      nextLookthroughContent = merged.nextContent;
    }
  }

  // 3. Create the branch — or auto-recover a stale leftover (Task #48).
  const branch = `add-alt/${entry.isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  // 4. Commit the modified file(s). When the look-through bundle is
  // active, both files land in ONE commit via commitMultiFile (Task
  // #122) so the resulting PR is a single review surface.
  const commitMessage = `Add ${entry.name} (${entry.isin}) as alternative under ${parentKey}${lookthroughIncluded ? " (with look-through data)" : ""}`;
  if (lookthroughIncluded && nextLookthroughContent !== null) {
    await commitMultiFile({
      octokit,
      owner,
      repo,
      branch,
      baseSha,
      message: commitMessage,
      files: [
        { path: ETFS_FILE_PATH, content: result.content },
        {
          path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
          content: nextLookthroughContent,
        },
      ],
    });
  } else {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: ETFS_FILE_PATH,
      branch,
      message: commitMessage,
      content: Buffer.from(result.content, "utf8").toString("base64"),
      sha: fileMeta.sha,
    });
  }

  // 5. Open the PR.
  const renderedBlock = renderAlternativeBlock(entry, "      ");
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${entry.name} (${entry.isin}) as alternative under ${parentKey}`,
    body: buildAlternativePrBody(parentKey, entry, renderedBlock, {
      lookthroughIncluded,
    }),
  });

  return { url: pr.html_url, number: pr.number, lookthroughIncluded };
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

// Task #111: replace the `default` ISIN of a bucket. Used by the
// "Set as default" picker in the tree-row UI. Returns:
//   • `parent_missing`     bucket key is not in BUCKETS.
//   • `default_unchanged`  new ISIN equals the current default (no-op).
//   • `instrument_missing` no INSTRUMENTS row exists for the new ISIN.
//   • `isin_in_use`        new ISIN already lives in another bucket.
//   • `ok`                 mutated source ready to PR.
//
// We DO require the instrument row to exist (the runtime catalog joiner
// throws if a bucket points at a missing instrument, so a missing row
// would crash the next reload — better to refuse upfront with an
// actionable error). The Instruments sub-tab is the place to register
// new ISINs before they can be assigned to buckets.
export type SetBucketDefaultStatus =
  | "ok"
  | "parent_missing"
  | "default_unchanged"
  | "instrument_missing"
  | "isin_in_use";
export interface SetBucketDefaultResult {
  content: string;
  status: SetBucketDefaultStatus;
  // When status === "isin_in_use", the bucket key (or "<key> alt N")
  // where the ISIN is already assigned.
  conflict?: string;
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
  const normNew = newDefaultIsin.trim().toUpperCase();
  if (currentDefault.toUpperCase() === normNew) {
    return { content: source, status: "default_unchanged" };
  }
  // Pre-flight: the new ISIN must (a) already live in INSTRUMENTS and
  // (b) not be assigned to any other bucket — strict cross-bucket
  // uniqueness (Task #111). We reuse the parser to check INSTRUMENTS
  // existence so the lookup is case-insensitive (parser uppercases
  // ISINs), matching the rest of the function's case handling.
  const instrumentsFromParser = parseInstrumentsFromSource(source);
  if (!Object.keys(instrumentsFromParser).some((k) => k.toUpperCase() === normNew)) {
    return { content: source, status: "instrument_missing" };
  }
  const summary = parseCatalogFromSource(source);
  for (const [k, e] of Object.entries(summary)) {
    if (k !== parentKey) {
      // Other buckets — strict cross-bucket check: the new ISIN must
      // not be assigned anywhere else, default OR alternative.
      if (e.isin.toUpperCase() === normNew) {
        return { content: source, status: "isin_in_use", conflict: k };
      }
    }
    // Same bucket OR another bucket — alternatives are always scanned.
    // For the parent we MUST scan because if the new ISIN already lives
    // inside this bucket's alternatives, swapping it into `default`
    // would create a within-bucket duplicate (default == alt). The
    // operator must detach the alternative first OR pick a genuinely
    // unassigned ISIN.
    if (e.alternatives) {
      for (let j = 0; j < e.alternatives.length; j++) {
        if (e.alternatives[j].isin.toUpperCase() === normNew) {
          return {
            content: source,
            status: "isin_in_use",
            conflict: `${k} alt ${j + 1}`,
          };
        }
      }
    }
  }
  const absStart = bucketBody.openBrace + 1 + valStart;
  const absEnd = bucketBody.openBrace + 1 + i;
  const content =
    source.slice(0, absStart) + normNew + source.slice(absEnd);
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
  // Task #122 (T004): the unified PR may also touch
  // `lookthrough.overrides.json`. The body explicitly calls that out so
  // the reviewer knows to review BOTH file diffs (the look-through
  // entry is an opaque blob of justETF data — they should at least
  // sanity-check the ISIN and the holdings count).
  options?: { lookthroughIncluded?: boolean },
): string {
  const lookthroughIncluded = options?.lookthroughIncluded === true;
  return [
    `Adds **${entry.name}** (\`${entry.isin}\`) as a curated alternative under bucket \`${parentKey}\`.`,
    ...(lookthroughIncluded
      ? [
          "",
          "This PR also bundles the look-through data (`lookthrough.overrides.json`, `pool` section) for the ISIN, scraped from justETF at PR-open time. The two file changes land in a single commit so the alternative is usable on day 1 without waiting for the monthly refresh job.",
        ]
      : []),
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
    ...(lookthroughIncluded
      ? [
          "- Spot-check the look-through entry under `pool[\"" +
            entry.isin +
            "\"]` — the top holding names and the geo / sector totals (should sum close to 1.0).",
        ]
      : []),
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

// ---------------------------------------------------------------------------
// Task #111: INSTRUMENTS row CRUD (admin Instruments sub-tab).
// ---------------------------------------------------------------------------
// The Instruments sub-tab manages the master ISIN-keyed INSTRUMENTS table
// independently of any bucket assignment. Operators register a fund here
// once, then attach it to a bucket via the tree-row pickers (set as
// default OR add as alternative). The split-data invariant the runtime
// catalog joiner enforces is:
//
//   • Every BUCKETS row's `default` AND every alternative ISIN MUST
//     have a matching INSTRUMENTS row, otherwise the joiner throws.
//
// So the CRUD helpers below MUST refuse a delete that would orphan a
// live bucket reference. The Instruments sub-tab UI surfaces the
// in-use list ("default of Equity-USA-CHF", "alternative #1 of
// Equity-Global") so the operator can detach first, then retry the
// delete.
// ---------------------------------------------------------------------------

// Same shape as NewEtfEntry minus the bucket key — Instruments rows
// have no key (they're keyed by ISIN). Re-using the existing renderer
// (renderInstrumentRow) keeps a single source of truth for the per-field
// layout the catalog ships with today.
export type NewInstrumentEntry = Omit<NewEtfEntry, "key">;

export type AddInstrumentRowStatus = "ok" | "isin_present";
export interface AddInstrumentRowResult {
  content: string;
  status: AddInstrumentRowStatus;
}

export type UpdateInstrumentRowStatus = "ok" | "instrument_missing";
export interface UpdateInstrumentRowResult {
  content: string;
  status: UpdateInstrumentRowStatus;
}

export type RemoveInstrumentRowStatus =
  | "ok"
  | "instrument_missing"
  | "in_use";
export interface RemoveInstrumentRowResult {
  content: string;
  status: RemoveInstrumentRowStatus;
  // Populated when status === "in_use": the bucket slot(s) that still
  // reference this ISIN, formatted "<key>" for default and
  // "<key> alt N" for alternatives.
  usages?: string[];
}

// Locate `"<ISIN>": I({...}),` in the INSTRUMENTS literal. Returns
// absolute indices for the start of the row (the opening `"`) and the
// end (one past the trailing `,`/newline so a slice deletes the whole
// row cleanly). Returns null if the ISIN row isn't present.
function findInstrumentRowRange(
  source: string,
  isin: string,
): { start: number; end: number } | null {
  const block = findLiteralBlock(source, INSTRUMENTS_HEADER);
  const body = source.slice(block.openBrace + 1, block.closeBrace);
  const re = new RegExp(`"${escapeRegex(isin)}":\\s*I\\(\\{`, "g");
  const m = re.exec(body);
  if (!m) return null;
  const relRowStart = m.index;
  const relOpenBrace = m.index + m[0].length - 1;
  const relCloseBrace = findMatchingClose(body, relOpenBrace);
  if (relCloseBrace < 0) {
    throw new Error(
      `Unbalanced braces inside INSTRUMENTS["${isin}"] — refusing to edit.`,
    );
  }
  // Walk past the closing `})` and the optional trailing `,`. Then
  // include exactly one trailing newline so the surrounding rows stay
  // tidy (the renderer always emits a row terminated with `}),\n`).
  let i = relCloseBrace + 1; // past `}`
  if (body[i] === ")") i++; // past `)`
  if (body[i] === ",") i++;
  if (body[i] === "\n") i++;
  return {
    start: block.openBrace + 1 + relRowStart,
    end: block.openBrace + 1 + i,
  };
}

export function addInstrumentRow(
  source: string,
  entry: NewInstrumentEntry,
): AddInstrumentRowResult {
  const block = findLiteralBlock(source, INSTRUMENTS_HEADER);
  if (instrumentRowExists(source, block, entry.isin)) {
    return { content: source, status: "isin_present" };
  }
  // Re-use the same renderer + insertion strategy as injectEntry's
  // INSTRUMENTS-side step so the diff style matches the rest of the
  // catalog.
  const next = appendInstrumentRow(source, block, {
    ...entry,
    // appendInstrumentRow / renderInstrumentRow read from a NewEtfEntry
    // shape; the unused `key` field is ignored by renderInstrumentRow
    // (which keys the row by ISIN). Stub it with a placeholder so the
    // type checks; injectEntry never sees this entry, only the renderer
    // does, and the renderer doesn't read `key`.
    key: "Unassigned",
  });
  return { content: next, status: "ok" };
}

export function updateInstrumentRow(
  source: string,
  isin: string,
  entry: NewInstrumentEntry,
): UpdateInstrumentRowResult {
  if (entry.isin.trim().toUpperCase() !== isin.trim().toUpperCase()) {
    throw new Error(
      `Refusing to update INSTRUMENTS["${isin}"] with payload ISIN ${entry.isin} — ISIN renames are not supported (delete + re-add).`,
    );
  }
  const range = findInstrumentRowRange(source, isin);
  if (!range) {
    return { content: source, status: "instrument_missing" };
  }
  const rendered = renderInstrumentRow({ ...entry, key: "Unassigned" }, "  ");
  const content =
    source.slice(0, range.start) + rendered + "\n" + source.slice(range.end);
  return { content, status: "ok" };
}

export function removeInstrumentRow(
  source: string,
  isin: string,
): RemoveInstrumentRowResult {
  const range = findInstrumentRowRange(source, isin);
  if (!range) {
    return { content: source, status: "instrument_missing" };
  }
  // Refuse if any bucket still references this ISIN — the runtime
  // joiner would crash on the next reload otherwise.
  const summary = parseCatalogFromSource(source);
  const norm = isin.trim().toUpperCase();
  const usages: string[] = [];
  for (const [k, e] of Object.entries(summary)) {
    if (e.isin.toUpperCase() === norm) usages.push(k);
    if (e.alternatives) {
      for (let i = 0; i < e.alternatives.length; i++) {
        if (e.alternatives[i].isin.toUpperCase() === norm) {
          usages.push(`${k} alt ${i + 1}`);
        }
      }
    }
  }
  if (usages.length > 0) {
    return { content: source, status: "in_use", usages };
  }
  const content = source.slice(0, range.start) + source.slice(range.end);
  return { content, status: "ok" };
}

// ---------------------------------------------------------------------------
// openInstrumentPr — orchestration for the three Instruments CRUD ops.
// ---------------------------------------------------------------------------
// Branch naming:
//   instr-add/<isin>   — register a new ISIN with no bucket assignment.
//   instr-edit/<isin>  — patch an existing INSTRUMENTS row's metadata.
//   instr-rm/<isin>    — delete an unassigned INSTRUMENTS row.
//
// Each variant produces a focused single-file diff against etfs.ts so
// the reviewer sees exactly the rows being touched. The PR body
// summarises the action + lists any bucket assignments the operator
// will need to follow up on (e.g. "this row is unassigned — attach via
// the tree-row picker after merge").
// ---------------------------------------------------------------------------
export type InstrumentPrAction = "add" | "edit" | "remove";
export interface OpenInstrumentPrArgs {
  action: InstrumentPrAction;
  // For add/edit: the full entry. For remove: only `isin` is read.
  entry: NewInstrumentEntry;
}
export async function openInstrumentPr(
  args: OpenInstrumentPrArgs,
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

  let nextContent: string;
  let title: string;
  let body: string;
  let branchPrefix: string;

  if (args.action === "add") {
    const result = addInstrumentRow(currentContent, args.entry);
    if (result.status === "isin_present") {
      throw new Error(
        `ISIN ${args.entry.isin} is already in INSTRUMENTS — use the edit action to change its metadata.`,
      );
    }
    nextContent = result.content;
    title = `Register ${args.entry.name} (${args.entry.isin}) in instruments table`;
    body = buildInstrumentPrBody("add", args.entry);
    branchPrefix = "instr-add";
  } else if (args.action === "edit") {
    const result = updateInstrumentRow(
      currentContent,
      args.entry.isin,
      args.entry,
    );
    if (result.status === "instrument_missing") {
      throw new Error(
        `ISIN ${args.entry.isin} is not in INSTRUMENTS — register it first via the add action.`,
      );
    }
    nextContent = result.content;
    title = `Update instrument ${args.entry.name} (${args.entry.isin})`;
    body = buildInstrumentPrBody("edit", args.entry);
    branchPrefix = "instr-edit";
  } else {
    const result = removeInstrumentRow(currentContent, args.entry.isin);
    if (result.status === "instrument_missing") {
      throw new Error(
        `ISIN ${args.entry.isin} is not in INSTRUMENTS — nothing to remove.`,
      );
    }
    if (result.status === "in_use") {
      throw new Error(
        `ISIN ${args.entry.isin} is still assigned to: ${(result.usages ?? []).join(", ")}. Detach it from those buckets first, then retry.`,
      );
    }
    nextContent = result.content;
    title = `Remove instrument ${args.entry.isin} from registry`;
    body = buildInstrumentPrBody("remove", args.entry);
    branchPrefix = "instr-rm";
  }

  const branch = `${branchPrefix}/${args.entry.isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: title,
    content: Buffer.from(nextContent, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title,
    body,
  });
  return { url: pr.html_url, number: pr.number };
}

function buildInstrumentPrBody(
  action: InstrumentPrAction,
  entry: NewInstrumentEntry,
): string {
  if (action === "remove") {
    return [
      `Removes ISIN \`${entry.isin}\` from the INSTRUMENTS registry.`,
      "",
      "Generated from the in-app admin pane (Instruments sub-tab). The pre-flight check confirmed no bucket still references this ISIN — safe to merge.",
      "",
      "**Reviewer checklist**",
      "- Confirm no in-flight PR re-attaches this ISIN to a bucket (would crash the catalog joiner).",
      "- The ETF's look-through profile in `lookthrough.overrides.json` is intentionally NOT touched — operators may re-register the same ISIN later without losing scrape data.",
    ].join("\n");
  }
  const headline =
    action === "add"
      ? `Registers **${entry.name}** (\`${entry.isin}\`) in the INSTRUMENTS table without any bucket assignment.`
      : `Updates the INSTRUMENTS row for **${entry.name}** (\`${entry.isin}\`).`;
  return [
    headline,
    "",
    "Generated from the in-app admin pane (Instruments sub-tab). Per the split-catalog model, INSTRUMENTS holds master per-ISIN metadata; bucket assignments live in the BUCKETS table and are managed via the tree-row pickers.",
    "",
    "**Reviewer checklist**",
    "- Confirm `defaultExchange` matches the operator's preferred listing.",
    "- Confirm `terBps` and `domicile` match the latest factsheet.",
    "- Confirm the `comment` is accurate (it shows up in tooltips and pickers).",
    action === "add"
      ? "- After merge, attach this ISIN to a bucket via the tree-row picker (Set as default OR Add as alternative)."
      : "- Spot-check downstream buckets that already reference this ISIN — every assignment now picks up the updated metadata.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// openSetBucketDefaultPr — orchestration for the tree-row "Set as default"
// ---------------------------------------------------------------------------
// Branch name: `set-default/<key>-<isin-lower>` so multiple in-flight
// default changes for different buckets coexist without colliding.
// ---------------------------------------------------------------------------
export async function openSetBucketDefaultPr(
  parentKey: string,
  newDefaultIsin: string,
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

  const result = setBucketDefault(currentContent, parentKey, newDefaultIsin);
  if (result.status === "parent_missing") {
    throw new Error(`Parent bucket "${parentKey}" not found in catalog.`);
  }
  if (result.status === "default_unchanged") {
    throw new Error(
      `Bucket "${parentKey}" already has ${newDefaultIsin} as its default — nothing to change.`,
    );
  }
  if (result.status === "instrument_missing") {
    throw new Error(
      `ISIN ${newDefaultIsin} is not in the INSTRUMENTS table — register it first via the Instruments sub-tab.`,
    );
  }
  if (result.status === "isin_in_use") {
    throw new Error(
      `ISIN ${newDefaultIsin} is already assigned to bucket "${result.conflict}". Detach it first or pick a different ISIN.`,
    );
  }

  const branch = `set-default/${parentKey.toLowerCase()}-${newDefaultIsin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  const title = `Set ${newDefaultIsin} as default for bucket ${parentKey}`;
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ETFS_FILE_PATH,
    branch,
    message: title,
    content: Buffer.from(result.content, "utf8").toString("base64"),
    sha: fileMeta.sha,
  });

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title,
    body: [
      `Replaces the \`default\` ISIN of bucket \`${parentKey}\` with \`${newDefaultIsin}\`.`,
      "",
      "Generated from the in-app admin pane (tree-row picker). The pre-flight checks confirmed:",
      `- The new ISIN already exists in the INSTRUMENTS table.`,
      `- No other bucket currently references this ISIN (strict global uniqueness).`,
      "",
      "**Reviewer checklist**",
      `- Confirm \`${newDefaultIsin}\` is the right new default for \`${parentKey}\` (currency / hedging / replication match).`,
      `- After merge, the previously-default ISIN becomes unassigned and can be reused on another bucket OR retired via the Instruments sub-tab.`,
    ].join("\n"),
  });

  return { url: pr.html_url, number: pr.number };
}

// ---------------------------------------------------------------------------
// openAttachAlternativePr — tree-row "Add as alternative" (attach existing).
// ---------------------------------------------------------------------------
// Differs from openAddBucketAlternativePr (the legacy add-with-metadata
// flow): this variant ONLY appends to BUCKETS[parent].alternatives. The
// ISIN MUST already exist in INSTRUMENTS (registered via the Instruments
// sub-tab); we refuse otherwise. Branch name reuses `add-alt/<isin>` to
// keep the existing PR-list filter consistent.
// ---------------------------------------------------------------------------
export async function openAttachBucketAlternativePr(
  parentKey: string,
  isin: string,
  // Task #122 (T004): optional look-through bundle. The picker flow
  // attaches an INSTRUMENTS-registered ISIN to a bucket; if the JSON
  // doesn't yet have look-through data for it, admin.ts scrapes
  // justETF and passes the entry here so the resulting PR carries
  // both file changes — same single-PR-end-state as the manual-add
  // flow.
  lookthroughEntry?: { isin: string; entry: LookthroughPoolEntry },
): Promise<{ url: string; number: number; lookthroughIncluded: boolean }> {
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

  // Pre-flight: ISIN must already live in INSTRUMENTS. Without this the
  // append below would still succeed (alternatives are stored as ISIN
  // strings only) but the runtime catalog joiner would crash on the
  // next reload.
  const instrumentsBlock = findLiteralBlock(currentContent, INSTRUMENTS_HEADER);
  if (!instrumentRowExists(currentContent, instrumentsBlock, isin)) {
    throw new Error(
      `ISIN ${isin} is not in the INSTRUMENTS table — register it first via the Instruments sub-tab.`,
    );
  }

  // Build a NewAlternativeEntry from the existing INSTRUMENTS row so we
  // can reuse the injectAlternative pre-flight + append logic. Since the
  // row already exists, injectAlternative will skip the INSTRUMENTS-side
  // append and only touch BUCKETS[parent].alternatives.
  const instruments = parseInstrumentsFromSource(currentContent);
  const norm = isin.trim().toUpperCase();
  const inst = instruments[norm];
  if (!inst) {
    // Defensive: instrumentRowExists matched but the parser didn't —
    // means the row uses an unexpected shape. Surface the inconsistency.
    throw new Error(
      `ISIN ${isin} is referenced in INSTRUMENTS but the parser could not read it — manual review needed.`,
    );
  }
  const entry: NewAlternativeEntry = {
    name: inst.name,
    isin: inst.isin,
    terBps: inst.terBps,
    domicile: inst.domicile,
    replication: inst.replication as NewAlternativeEntry["replication"],
    distribution: inst.distribution as NewAlternativeEntry["distribution"],
    currency: inst.currency,
    comment: inst.comment,
    defaultExchange: inst.defaultExchange as NewAlternativeEntry["defaultExchange"],
    listings: inst.listings,
    ...(inst.aumMillionsEUR !== undefined
      ? { aumMillionsEUR: inst.aumMillionsEUR }
      : {}),
    ...(inst.inceptionDate ? { inceptionDate: inst.inceptionDate } : {}),
  };

  const result = injectAlternative(currentContent, parentKey, entry);
  if (result.status === "parent_missing") {
    throw new Error(`Parent bucket "${parentKey}" not found in catalog.`);
  }
  if (result.status === "isin_present") {
    throw new Error(
      `ISIN ${isin} is already assigned to bucket "${result.conflict}". Every ISIN may belong to at most one bucket.`,
    );
  }
  if (result.status === "cap_exceeded") {
    throw new Error(
      `Bucket "${parentKey}" already has the maximum of ${MAX_ALTERNATIVES_PER_BUCKET} alternatives.`,
    );
  }

  // Look-through bundle (Task #122 T004). Same pattern as
  // openAddBucketAlternativePr — read the JSON at baseSha so the
  // multi-file commit is consistent; mergeLookthroughEntries skips
  // ISINs already in `pool` / `overrides`. The picker can pass an
  // entry "just in case", and we silently no-op if the JSON already
  // covers it.
  let lookthroughIncluded = false;
  let nextLookthroughContent: string | null = null;
  if (lookthroughEntry) {
    const { data: ltMeta } = await octokit.repos.getContent({
      owner,
      repo,
      path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
      ref: baseSha,
    });
    if (Array.isArray(ltMeta) || ltMeta.type !== "file") {
      throw new Error(
        `Unexpected GitHub response for ${LOOKTHROUGH_OVERRIDES_FILE_PATH}.`,
      );
    }
    const ltCurrent = Buffer.from(ltMeta.content, "base64").toString("utf8");
    const merged = mergeLookthroughEntries({
      currentContent: ltCurrent,
      entries: [lookthroughEntry],
    });
    if (merged.added.length > 0) {
      lookthroughIncluded = true;
      nextLookthroughContent = merged.nextContent;
    }
  }

  const branch = `add-alt/${isin.toLowerCase()}`;
  await ensureFreshBranch({ octokit, owner, repo, branch, baseSha });

  const title = `Attach ${isin} as alternative under ${parentKey}${lookthroughIncluded ? " (with look-through data)" : ""}`;
  if (lookthroughIncluded && nextLookthroughContent !== null) {
    await commitMultiFile({
      octokit,
      owner,
      repo,
      branch,
      baseSha,
      message: title,
      files: [
        { path: ETFS_FILE_PATH, content: result.content },
        {
          path: LOOKTHROUGH_OVERRIDES_FILE_PATH,
          content: nextLookthroughContent,
        },
      ],
    });
  } else {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: ETFS_FILE_PATH,
      branch,
      message: title,
      content: Buffer.from(result.content, "utf8").toString("base64"),
      sha: fileMeta.sha,
    });
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title,
    body: [
      `Adds existing ISIN \`${isin}\` (${inst.name}) to the curated alternatives of bucket \`${parentKey}\`.`,
      ...(lookthroughIncluded
        ? [
            "",
            "This PR also bundles the look-through data (`lookthrough.overrides.json`, `pool` section) for the ISIN so it is usable on day 1 without waiting for the monthly refresh job.",
          ]
        : []),
      "",
      "Generated from the in-app admin pane (tree-row picker). The pre-flight checks confirmed:",
      `- The ISIN already exists in the INSTRUMENTS table.`,
      `- No other bucket currently references this ISIN (strict global uniqueness).`,
      `- The bucket has fewer than ${MAX_ALTERNATIVES_PER_BUCKET} alternatives, so the cap holds.`,
      "",
      "**Reviewer checklist**",
      `- Confirm \`${parentKey}\` is the correct bucket (currency / asset-class match).`,
      `- After merge, the picker on the Build tab offers this ISIN as an alternative for that bucket.`,
      ...(lookthroughIncluded
        ? [
            `- Spot-check the bundled look-through entry under \`pool["${isin}"]\` (top-holding names, geo / sector totals near 1.0).`,
          ]
        : []),
    ].join("\n"),
  });

  return { url: pr.html_url, number: pr.number, lookthroughIncluded };
}
