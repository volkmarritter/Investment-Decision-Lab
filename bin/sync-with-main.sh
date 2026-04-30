#!/usr/bin/env bash
#
# Sync this Replit workspace with the GitHub `main` branch, auto-resolving
# conflicts on admin-mutated data files by always taking main's version.
#
# WHEN TO RUN:
#   - Before clicking Publish, if any admin PRs may have been merged on
#     GitHub since your last pull. (When in doubt, run it — it's safe and
#     idempotent.)
#   - Whenever the Git pane shows incoming commits (the `↓ N` counter).
#
# WHAT IT DOES:
#   1. Finds the GitHub remote (Replit names it `subrepl-<hash>`, not
#      `origin`, so we detect it dynamically).
#   2. Refuses to run if you have uncommitted changes — commit or discard
#      first so you don't accidentally lose work.
#   3. Pulls main with a merge commit (preserves the diverge-and-merge model
#      the workspace already uses).
#   4. If the merge conflicts on any of the operator-mutated data files
#      (etfs.ts, *.overrides.json, refresh logs), automatically takes
#      main's version — those files are written by admin PRs and main is
#      the canonical source.
#   5. Stops with a clear error if any OTHER conflicts remain (i.e. real
#      code conflicts that need human judgement).
#
# WHAT IT DOES NOT DO:
#   - It does not push. After this script finishes cleanly, push from the
#     Git pane (or run: git push <remote> main).
#   - It does not handle conflicts in code files — those are rare and
#     should be resolved by hand.

set -euo pipefail

# 1. Locate the GitHub remote dynamically (Replit's naming differs per fork).
REMOTE="$(git remote -v | awk '/github\.com.*\(fetch\)/ {print $1; exit}')"
if [[ -z "$REMOTE" ]]; then
  echo "error: no GitHub remote found in 'git remote -v'." >&2
  echo "       Expected a remote whose URL contains 'github.com'." >&2
  exit 1
fi
echo "→ GitHub remote: $REMOTE"

# 2. Refuse if working tree is dirty.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: uncommitted changes detected." >&2
  echo "       Commit or discard your changes in the Git pane first," >&2
  echo "       then re-run this script." >&2
  exit 1
fi

# 3. Fetch + merge.
echo "→ Fetching $REMOTE/main…"
git fetch "$REMOTE" main

if git merge --no-edit "$REMOTE/main"; then
  echo "✓ Clean merge — nothing to resolve."
  echo ""
  echo "Now push: open the Git pane and click Push"
  echo "(or run: git push $REMOTE main)"
  exit 0
fi

# 4. Auto-resolve conflicts on the known operator-mutated data files.
DATA_FILES=(
  "artifacts/investment-lab/src/data/lookthrough.overrides.json"
  "artifacts/investment-lab/src/data/etfs.overrides.json"
  "artifacts/investment-lab/src/data/refresh-changes.log.jsonl"
  "artifacts/investment-lab/src/data/refresh-runs.log.md"
  "artifacts/investment-lab/src/lib/etfs.ts"
)

echo "→ Auto-resolving conflicts on data files (always take main's version):"
RESOLVED_ANY=0
for f in "${DATA_FILES[@]}"; do
  if git ls-files --unmerged -- "$f" | grep -q .; then
    echo "  · $f"
    git checkout --theirs -- "$f"
    git add -- "$f"
    RESOLVED_ANY=1
  fi
done

if [[ $RESOLVED_ANY -eq 0 ]]; then
  echo "  (none of the known data files were in conflict)"
fi

# 5. If anything else still conflicts, stop and let the human handle it.
if git ls-files --unmerged | grep -q .; then
  echo "" >&2
  echo "error: conflicts remain in files this script does not auto-resolve:" >&2
  git ls-files --unmerged | awk '{print "  · " $4}' | sort -u >&2
  echo "" >&2
  echo "Resolve these by hand (open each file, edit out the <<<<<<< markers)," >&2
  echo "then run:" >&2
  echo "  git add <file>" >&2
  echo "  git commit --no-edit" >&2
  exit 1
fi

git commit --no-edit
echo ""
echo "✓ Merge complete — auto-resolved data file conflicts."
echo ""
echo "Now push: open the Git pane and click Push"
echo "(or run: git push $REMOTE main)"
