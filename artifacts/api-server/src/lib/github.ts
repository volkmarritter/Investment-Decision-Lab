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

export interface NewEtfEntry {
  key: string;
  name: string;
  isin: string;
  terBps: number;
  domicile: string;
  replication: "Physical" | "Physical (sampled)" | "Synthetic";
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  defaultExchange: "LSE" | "XETRA" | "SIX" | "Euronext";
  listings: Partial<
    Record<"LSE" | "XETRA" | "SIX" | "Euronext", { ticker: string }>
  >;
  aumMillionsEUR?: number;
  inceptionDate?: string;
}

export interface PrCreationContext {
  policyFit: { aumOk: boolean; terOk: boolean; notes: string[] };
}

const ETFS_FILE_PATH = "artifacts/investment-lab/src/lib/etfs.ts";

export function githubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_PAT &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO,
  );
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

  // 5. Open the PR.
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title: `Add ${entry.name} (${entry.isin}) to ETF catalog`,
    body: buildPrBody(entry, ctx),
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
  // Find the matching closing brace by tracking depth from the opening `{`.
  const openBrace = source.indexOf("{", catalogStart);
  let depth = 0;
  let close = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
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

function renderEntryBlock(entry: NewEtfEntry, indent: string): string {
  // Defence-in-depth: even though validateEntry whitelists exchange keys,
  // we ALSO emit them through JSON.stringify (which produces quoted
  // identifiers) so a future validation regression can't inject raw TS
  // tokens via a malicious listings key.
  const listingsParts: string[] = [];
  for (const [ex, val] of Object.entries(entry.listings)) {
    if (!val) continue;
    listingsParts.push(`${json(ex)}: { ticker: ${json(val.ticker)} }`);
  }
  const listingsLiteral = `{ ${listingsParts.join(", ")} }`;

  const optionalLines: string[] = [];
  if (entry.aumMillionsEUR !== undefined) {
    optionalLines.push(`${indent}  aumMillionsEUR: ${entry.aumMillionsEUR},`);
  }
  if (entry.inceptionDate) {
    optionalLines.push(`${indent}  inceptionDate: ${json(entry.inceptionDate)},`);
  }
  return [
    `${indent}${json(entry.key)}: E({`,
    `${indent}  name: ${json(entry.name)},`,
    `${indent}  isin: ${json(entry.isin)},`,
    `${indent}  terBps: ${entry.terBps},`,
    `${indent}  domicile: ${json(entry.domicile)},`,
    `${indent}  replication: ${json(entry.replication)},`,
    `${indent}  distribution: ${json(entry.distribution)},`,
    `${indent}  currency: ${json(entry.currency)},`,
    `${indent}  comment: ${json(entry.comment)},`,
    `${indent}  listings: ${listingsLiteral},`,
    `${indent}  defaultExchange: ${json(entry.defaultExchange)},`,
    ...optionalLines,
    `${indent}}),`,
  ].join("\n");
}

function buildPrBody(entry: NewEtfEntry, ctx: PrCreationContext): string {
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
    "**Reviewer checklist**",
    "- Confirm the catalog key is in the right asset class.",
    "- Confirm `defaultExchange` matches your preferred listing.",
    "- Confirm the `comment` is accurate (it shows up in tooltips).",
    "- Confirm the listings are real (cross-check on justETF).",
    "",
    "After merging, the next scheduled refresh will populate the override layer.",
  ].join("\n");
}

function json(v: string): string {
  return JSON.stringify(v);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
