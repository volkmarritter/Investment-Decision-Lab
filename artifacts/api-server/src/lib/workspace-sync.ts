// ----------------------------------------------------------------------------
// workspace-sync.ts
// ----------------------------------------------------------------------------
// Helpers for the admin "Sync workspace from main" panel (Task #51).
//
// Wraps a small set of `git` invocations so the route handler stays
// declarative. Every command runs inside the workspace's git toplevel
// (resolved once via `git rev-parse --show-toplevel`); shells out via
// execFile (no shell interpolation, no command-injection vector); has a
// short timeout so a hung clone can't wedge the api-server.
//
// The endpoint is operator-initiated and never force-pulls — refusal
// cases (uncommitted changes, non-fast-forward, lock file present) are
// surfaced as typed reasons so the UI can render plain-language messages
// with the correct next step.
// ----------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;

export interface DirtyCounts {
  staged: number;
  modified: number;
  untracked: number;
}

export interface WorkspaceSyncStatus {
  available: boolean;
  // When `available === false`, `reason` carries a plain-language hint
  // (e.g. "not a git checkout"). Everything else is undefined.
  reason?: string;
  branch?: string;
  headSha?: string;
  headShortSha?: string;
  // Commits behind / ahead of `origin/main`. If we couldn't fetch the
  // remote (offline, no permission), values stay undefined and `fetchOk`
  // is false — the UI shows a "could not refresh remote" hint.
  behind?: number;
  ahead?: number;
  fetchOk?: boolean;
  fetchError?: string;
  // Snapshot of `git status --porcelain` bucketed into the three groups
  // most actionable for the operator.
  dirty?: DirtyCounts;
  // True when `.git/index.lock` is present (a previous git command
  // crashed or another git process is currently running). The merge
  // step refuses with a friendly message until this clears.
  indexLockPresent?: boolean;
  // Always-relative path to the file the lock would block on (rendered
  // as a hint in the UI so the operator knows what to delete if needed).
  indexLockPath?: string;
  // The configured base branch we sync against (always `main` unless
  // GITHUB_BASE_BRANCH is overridden — surfaced so the UI label matches).
  baseBranch: string;
}

export type WorkspaceSyncRefusal =
  | "not_a_git_checkout"
  | "uncommitted_changes"
  | "index_lock_present"
  | "fetch_failed"
  | "non_fast_forward"
  | "merge_failed";

export interface WorkspaceSyncResult {
  ok: true;
  oldSha: string;
  newSha: string;
  // Files changed between oldSha and newSha (relative to repo root).
  // Empty when oldSha === newSha (already up to date).
  changedFiles: string[];
  alreadyUpToDate: boolean;
  baseBranch: string;
}

export interface WorkspaceSyncRefusalResult {
  ok: false;
  reason: WorkspaceSyncRefusal;
  // Plain-language message to render verbatim in the admin UI. Always
  // ends with a clear next step the operator can take.
  message: string;
  // Optional structured detail the UI may surface inline (e.g. the dirty
  // file list, or the git stderr captured from the failed merge).
  detail?: string;
}

function baseBranchName(): string {
  return process.env.GITHUB_BASE_BRANCH ?? "main";
}

// Resolve the workspace's git toplevel ONCE so every subsequent command
// uses a stable cwd. We try the api-server's process.cwd() first (which
// in dev points at the artifact dir or the monorepo root depending on
// how the workflow was started); `--show-toplevel` then walks up until
// it finds the .git dir. Returns null when not in a git checkout (e.g.
// running a tarball deploy in production).
async function resolveGitRoot(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { timeout: GIT_TIMEOUT_MS, cwd: process.cwd() },
    );
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

async function gitRun(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout, stderr };
}

function countPorcelain(porcelain: string): DirtyCounts {
  const counts: DirtyCounts = { staged: 0, modified: 0, untracked: 0 };
  for (const rawLine of porcelain.split("\n")) {
    if (!rawLine) continue;
    // Porcelain v1 format: "XY <path>" where X = staged status, Y =
    // worktree status. "??" = untracked.
    const x = rawLine[0];
    const y = rawLine[1];
    if (x === "?" && y === "?") {
      counts.untracked++;
      continue;
    }
    if (x !== " " && x !== "?") counts.staged++;
    if (y !== " " && y !== "?") counts.modified++;
  }
  return counts;
}

export async function getWorkspaceSyncStatus(): Promise<WorkspaceSyncStatus> {
  const baseBranch = baseBranchName();
  const root = await resolveGitRoot();
  if (!root) {
    return {
      available: false,
      reason:
        "Not a git checkout — workspace sync is unavailable. This is expected in production deployments where the bundle ships without a `.git` directory.",
      baseBranch,
    };
  }

  // Best-effort: fetch the remote so the behind count reflects reality.
  // We swallow fetch errors (offline, no remote configured, network
  // hiccup) and surface them as `fetchOk: false` — the rest of the
  // status payload is still useful (HEAD sha, dirty counts, lock).
  let fetchOk = true;
  let fetchError: string | undefined;
  try {
    await gitRun(root, ["fetch", "origin", baseBranch]);
  } catch (err) {
    fetchOk = false;
    fetchError = stderrOf(err);
  }

  let branch = "";
  let headSha = "";
  try {
    branch = (await gitRun(root, ["rev-parse", "--abbrev-ref", "HEAD"]))
      .stdout.trim();
  } catch {
    branch = "(detached)";
  }
  try {
    headSha = (await gitRun(root, ["rev-parse", "HEAD"])).stdout.trim();
  } catch (err) {
    return {
      available: false,
      reason: `git rev-parse HEAD failed: ${stderrOf(err)}`,
      baseBranch,
    };
  }

  // behind / ahead counts. `rev-list --left-right --count A...B` would
  // also work but two scalar invocations keep parsing trivial.
  let behind: number | undefined;
  let ahead: number | undefined;
  try {
    const b = await gitRun(root, [
      "rev-list",
      "--count",
      `HEAD..origin/${baseBranch}`,
    ]);
    behind = Number(b.stdout.trim());
    const a = await gitRun(root, [
      "rev-list",
      "--count",
      `origin/${baseBranch}..HEAD`,
    ]);
    ahead = Number(a.stdout.trim());
  } catch {
    // origin/main doesn't exist (no remote, never fetched). Leave
    // behind/ahead undefined; the UI will show a "remote unknown" hint.
  }

  // Dirty workdir snapshot.
  let dirty: DirtyCounts = { staged: 0, modified: 0, untracked: 0 };
  try {
    const { stdout } = await gitRun(root, [
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ]);
    dirty = countPorcelain(stdout);
  } catch {
    // Fall back to zeros — operator will see the merge refuse if the
    // workdir is actually dirty.
  }

  // Index lock file. A stale lock from a crashed prior git command
  // would block the merge with an opaque error; surface it up-front.
  const lockPath = join(root, ".git", "index.lock");
  let indexLockPresent = false;
  try {
    await access(lockPath);
    indexLockPresent = true;
  } catch {
    indexLockPresent = false;
  }

  return {
    available: true,
    branch,
    headSha,
    headShortSha: headSha.slice(0, 7),
    behind,
    ahead,
    fetchOk,
    ...(fetchError ? { fetchError } : {}),
    dirty,
    indexLockPresent,
    ...(indexLockPresent ? { indexLockPath: ".git/index.lock" } : {}),
    baseBranch,
  };
}

export async function syncWorkspaceFromMain(): Promise<
  WorkspaceSyncResult | WorkspaceSyncRefusalResult
> {
  const baseBranch = baseBranchName();
  const root = await resolveGitRoot();
  if (!root) {
    return {
      ok: false,
      reason: "not_a_git_checkout",
      message:
        "This workspace is not a git checkout. Workspace sync is only available in development; production deployments don't ship a `.git` directory.",
    };
  }

  // Refuse early if a lock file is present — the merge would otherwise
  // fail with a confusing "Another git process seems to be running"
  // message. Keep the lock untouched (deleting it without proof of
  // staleness can corrupt an in-flight git operation).
  const lockPath = join(root, ".git", "index.lock");
  try {
    await access(lockPath);
    return {
      ok: false,
      reason: "index_lock_present",
      message:
        "Another git command is still running (lock file `.git/index.lock` exists). Wait for it to finish, or — if you're sure no other git process is active — delete the lock file from a terminal and try again.",
      detail: lockPath,
    };
  } catch {
    // Lock file absent — proceed.
  }

  // Refuse on any uncommitted change. The operator must explicitly
  // commit, stash or discard their work first; we never silently move
  // their edits.
  let dirty: DirtyCounts = { staged: 0, modified: 0, untracked: 0 };
  let porcelainOut = "";
  try {
    const { stdout } = await gitRun(root, [
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ]);
    porcelainOut = stdout;
    dirty = countPorcelain(stdout);
  } catch (err) {
    return {
      ok: false,
      reason: "merge_failed",
      message: `Could not read working-tree status: ${stderrOf(err)}`,
    };
  }
  if (dirty.staged + dirty.modified > 0) {
    // Untracked files don't block a fast-forward, so we deliberately
    // ignore them here. Staged or modified files would.
    const sample = porcelainOut
      .split("\n")
      .filter((l) => l && !l.startsWith("??"))
      .slice(0, 10)
      .join("\n");
    return {
      ok: false,
      reason: "uncommitted_changes",
      message: `Workspace has uncommitted changes (${dirty.staged} staged, ${dirty.modified} modified). Commit, stash or discard them before syncing — workspace sync never moves your local edits.`,
      detail: sample,
    };
  }

  // Fetch latest from origin. A network failure is its own refusal
  // category — the operator can retry once they're back online.
  try {
    await gitRun(root, ["fetch", "origin", baseBranch]);
  } catch (err) {
    return {
      ok: false,
      reason: "fetch_failed",
      message: `Could not fetch from origin: ${stderrOf(err)}. Check your network connection or git credentials, then try again.`,
    };
  }

  // Capture HEAD before the merge so we can diff old → new.
  let oldSha: string;
  try {
    oldSha = (await gitRun(root, ["rev-parse", "HEAD"])).stdout.trim();
  } catch (err) {
    return {
      ok: false,
      reason: "merge_failed",
      message: `Could not read HEAD: ${stderrOf(err)}`,
    };
  }

  // Fast-forward only — never produces a merge commit, never rewrites
  // history. If the local branch has diverged (commits not on
  // origin/main) the merge fails and we surface that as non_fast_forward.
  try {
    await gitRun(root, ["merge", "--ff-only", `origin/${baseBranch}`]);
  } catch (err) {
    const stderr = stderrOf(err);
    if (
      /not possible to fast-forward|Not possible to fast-forward|non-fast-forward|diverged/i.test(
        stderr,
      )
    ) {
      return {
        ok: false,
        reason: "non_fast_forward",
        message: `Cannot fast-forward — your local branch has commits that are not on origin/${baseBranch}. Push or rebase those commits first, or discard them, then re-run sync.`,
        detail: stderr,
      };
    }
    return {
      ok: false,
      reason: "merge_failed",
      message: `Merge failed: ${stderr}`,
      detail: stderr,
    };
  }

  let newSha: string;
  try {
    newSha = (await gitRun(root, ["rev-parse", "HEAD"])).stdout.trim();
  } catch (err) {
    return {
      ok: false,
      reason: "merge_failed",
      message: `Could not read HEAD after merge: ${stderrOf(err)}`,
    };
  }

  if (oldSha === newSha) {
    return {
      ok: true,
      oldSha,
      newSha,
      changedFiles: [],
      alreadyUpToDate: true,
      baseBranch,
    };
  }

  let changedFiles: string[] = [];
  try {
    const { stdout } = await gitRun(root, [
      "diff",
      "--name-only",
      `${oldSha}..${newSha}`,
    ]);
    changedFiles = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // Non-fatal: the sync succeeded; the file list is purely cosmetic.
  }

  return {
    ok: true,
    oldSha,
    newSha,
    changedFiles,
    alreadyUpToDate: false,
    baseBranch,
  };
}

function stderrOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { stderr?: string; message?: string };
    if (e.stderr && e.stderr.trim()) return e.stderr.trim();
    if (e.message) return e.message;
  }
  return String(err);
}
