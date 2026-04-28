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
import { renderEntryBlock, type NewEtfEntry } from "./render-entry";
import {
  renderAlternativeBlock,
  type NewAlternativeEntry,
} from "./render-alternative";
import { findMatchingClose, parseCatalogFromSource } from "./catalog-parser";

// Re-exported so downstream callers (admin.ts, tests) keep importing the
// canonical entry shape from one place. The implementation lives in
// render-entry.ts so the renderer can be reused by the admin UI's
// "Show generated code" disclosure without dragging octokit into the
// test bundle.
export type { NewEtfEntry, NewAlternativeEntry };
export { renderEntryBlock, renderAlternativeBlock };

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

  // 3. Create the branch (or fail if it already exists — surfaces stale
  // attempts cleanly rather than silently force-pushing).
  const branch = `add-etf/${entry.isin.toLowerCase()}`;
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
      throw new Error(
        `Branch ${branch} already exists. Delete it on GitHub or rename, then retry.`,
      );
    }
    throw err;
  }

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
  // Pre-flight: refuse if the key is already in the catalog. Cheap to
  // check via simple string contains because catalog keys are unique
  // identifiers like "Equity-Global".
  const keyLine = new RegExp(`^\\s*"${escapeRegex(entry.key)}":\\s*E\\(`, "m");
  if (keyLine.test(source)) {
    return { content: source, alreadyPresent: true };
  }

  const catalogStart = source.indexOf(
    "const CATALOG: Record<string, ETFRecord> = {",
  );
  if (catalogStart < 0) {
    throw new Error(
      "Could not locate `const CATALOG: Record<string, ETFRecord> = {` in etfs.ts.",
    );
  }
  // Find the matching closing brace using the string- and comment-aware
  // walker so a comment field containing literal `{`/`}` (which JSON
  // doesn't escape) can't truncate the catalog and corrupt the diff.
  const openBrace = source.indexOf("{", catalogStart);
  const close = findMatchingClose(source, openBrace);
  if (close < 0) {
    throw new Error("Unbalanced braces in etfs.ts — refusing to edit.");
  }

  const indent = "  ";
  const block = renderEntryBlock(entry, indent);
  // Insert just before the closing brace (which is on its own line as `};`).
  const before = source.slice(0, close);
  const after = source.slice(close);
  // Ensure there's exactly one trailing newline on the previous entry
  // (catalog uses `}),\n` then optional comment line then next entry).
  const trimmed = before.replace(/\s*$/, "");
  const content = `${trimmed}\n${block}\n${after}`;
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
// addressed positionally by slot index 1..2).
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
  // Pre-flight #1: parent must exist. Use the same single-line regex as
  // injectEntry's key check — cheap and unambiguous.
  const parentLine = new RegExp(
    `^(\\s*)"${escapeRegex(parentKey)}":\\s*E\\(\\{`,
    "m",
  );
  const parentMatch = parentLine.exec(source);
  if (!parentMatch) {
    return { content: source, status: "parent_missing" };
  }

  // Pre-flight #2: ISIN must be globally unique vs every default AND
  // every existing alternative. Reuse parseCatalogFromSource so the check
  // walks the same brace-aware tree the runtime catalog reads from.
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

  // Locate the parent's record body: `{` of the `E({` we matched, walked
  // to its matching `}`. The `})` that closes the parent always follows.
  const eOpenIdx = parentMatch.index + parentMatch[0].length - 1; // the `{`
  const eCloseIdx = findMatchingClose(source, eOpenIdx);
  if (eCloseIdx < 0) {
    throw new Error(
      `Unbalanced braces inside catalog entry "${parentKey}" — refusing to edit.`,
    );
  }
  const recordBody = source.slice(eOpenIdx + 1, eCloseIdx);

  // Does the parent already have an `alternatives:` array?
  const altsIdx = findFieldIndex(recordBody, "alternatives");
  if (altsIdx >= 0) {
    // Find the `[` that starts the array, then its matching `]`.
    let openBracketRel = altsIdx + "alternatives:".length;
    while (
      openBracketRel < recordBody.length &&
      /\s/.test(recordBody[openBracketRel])
    ) {
      openBracketRel++;
    }
    if (recordBody[openBracketRel] !== "[") {
      throw new Error(
        `\`alternatives\` field of "${parentKey}" is not an array literal — refusing to edit.`,
      );
    }
    const closeBracketRel = findMatchingBracket(recordBody, openBracketRel);
    if (closeBracketRel < 0) {
      throw new Error(
        `Unbalanced brackets in \`alternatives\` array of "${parentKey}".`,
      );
    }

    // Pre-flight #3: cap. Count existing alternatives by counting top-level
    // `{` braces inside the array body.
    const arrayBody = recordBody.slice(openBracketRel + 1, closeBracketRel);
    const existingCount = countTopLevelObjects(arrayBody);
    if (existingCount >= 2) {
      return { content: source, status: "cap_exceeded" };
    }

    // Insert just before the closing `]`. The catalog's hand-written style
    // indents alternative bodies at "      " (6 spaces) and uses trailing
    // commas after each `}`. Match it.
    const indent = "      ";
    const block = renderAlternativeBlock(entry, indent);
    const absoluteCloseBracket = eOpenIdx + 1 + closeBracketRel;
    const before = source.slice(0, absoluteCloseBracket);
    const after = source.slice(absoluteCloseBracket);
    // Trim trailing whitespace on the line preceding `]` so the insertion
    // doesn't double-blank-line. Then re-insert the indent the closing
    // bracket sat on.
    const trimmed = before.replace(/[ \t]*$/, "");
    const content = `${trimmed}\n${block}\n    ${after}`;
    return { content, status: "ok" };
  }

  // Parent has no alternatives field — insert one just before the parent's
  // closing `})`. The closing brace of the record is at eCloseIdx; we want
  // to insert before it but on its own indentation level, matching the
  // hand-written style (alternatives field at indent "    ", 4 spaces, to
  // align with the other top-level fields of the record body).
  const indent = "      "; // alternative-object indent inside the array
  const block = renderAlternativeBlock(entry, indent);
  const before = source.slice(0, eCloseIdx);
  const after = source.slice(eCloseIdx); // starts with `})`
  // Strip any trailing whitespace before `})`, then add a newline and the
  // new field. The catalog convention puts a newline before `})`.
  const trimmed = before.replace(/[ \t]*$/, "").replace(/\n+$/, "");
  const insertion = `\n    alternatives: [\n${block}\n    ],\n  `;
  const content = `${trimmed}${insertion}${after}`;
  return { content, status: "ok" };
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
      `"${parentKey}" already has 2 alternatives. Remove one before adding another.`,
    );
  }

  // 3. Create the branch (or fail if it already exists).
  const branch = `add-alt/${entry.isin.toLowerCase()}`;
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
      throw new Error(
        `Branch ${branch} already exists. Delete it on GitHub or rename, then retry.`,
      );
    }
    throw err;
  }

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
