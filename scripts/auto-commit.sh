#!/bin/bash
# auto-commit.sh — Smart git auto-commit for knowledge base
# Creates a commit with an LLM-generated message summarizing changes.
# Designed to run daily via LaunchAgent (11pm).
#
# Usage: auto-commit.sh [--dry-run] [--staged]
#
# --staged : commit only what is already in the index (used by neuron-sync.sh).
#            Skips the git add step entirely — neuron-sync owns allowlist staging.
# --dry-run: preview what would be committed (no staging changes are made).
#
# When called WITHOUT --staged (nightly cron), this script stages changes
# via an allowlist (no git add -A) before committing.

set -euo pipefail

KB_DIR="${KB_DIR:-$HOME/knowledge-base}"
LOG_FILE="$KB_DIR/scripts/auto-commit.log"

STAGED_MODE=0
DRY_RUN=0
for arg in "${@:-}"; do
  [[ "$arg" == "--staged"   ]] && STAGED_MODE=1
  [[ "$arg" == "--dry-run"  ]] && DRY_RUN=1
done

cd "$KB_DIR"

# Ensure git is initialized
if [[ ! -d ".git" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Git not initialized in $KB_DIR. Run: git init" >> "$LOG_FILE"
  echo "Git not initialized. Run: cd ~/knowledge-base && git init"
  exit 0
fi

# --- Staging ---
# --staged: neuron-sync has already staged exactly what it wants committed.
# Otherwise: allowlist staging — mirrors neuron-sync step 4 (no git add -A).
if [[ "$STAGED_MODE" -eq 0 ]]; then
  for d in wiki memory raw Research Notes Daily UGC-Dual-Path docs; do
    [ -d "$d" ] && git add -- "$d"'/*.md' 2>/dev/null || true
  done
  [ -d skills ] && git add -- skills 2>/dev/null || true
  # Per-file adds: one missing pathspec (approvals.log pre-first-approval) would
  # abort a combined git add for ALL listed files.
  for f in REVIEW.md approvals.log .gitignore CLAUDE.md README.md; do
    [ -f "$KB_DIR/$f" ] && git add -- "$f" 2>/dev/null || true
  done
fi

# Check for changes (after staging, so --staged reflects the current index).
# update-index --refresh first: files rewritten-with-identical-content within the
# same second leave "racy" index entries, and `git diff --quiet` short-circuits
# on the stat mismatch WITHOUT content-checking — producing empty commits.
git update-index -q --refresh 2>/dev/null || true
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null \
   && { [[ "$STAGED_MODE" -eq 1 ]] || [[ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; }; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — No changes to commit" >> "$LOG_FILE"
  exit 0
fi

# Get diff summary for commit message
DIFF_SUMMARY=$(git diff --cached --stat 2>/dev/null | tail -5)
CHANGED_FILES=$(git diff --cached --name-only 2>/dev/null | head -20)

# Dry run mode
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Would commit:"
  echo "$DIFF_SUMMARY"
  echo ""
  echo "Files:"
  echo "$CHANGED_FILES"
  # Only reset staged area when we did the staging ourselves.
  [[ "$STAGED_MODE" -eq 0 ]] && git reset HEAD -- . >/dev/null 2>&1
  exit 0
fi

# Generate smart commit message using classify tier (cheapest).
# Skip LLM when NEURON_NO_LLM=1 (tests, sandboxed runs) — fall through to
# the dated fallback below so the commit still proceeds.
COMMIT_MSG=""
if [[ "${NEURON_NO_LLM:-0}" != "1" ]]; then
  PROMPT_TEXT=$(cat <<PROMPT
Write a concise git commit message (one line, max 72 chars) for this knowledge base update.

Changed files:
$CHANGED_FILES

Diff stats:
$DIFF_SUMMARY

Rules:
- Use conventional commit format: type(scope): description
- Types: docs (wiki/concept changes), feat (new articles), chore (maintenance), fix (corrections)
- Be specific about what changed, not generic
- One line only, no body
- Example: "docs(concepts): add PFAS contamination research, update water-filtration links"

Output ONLY the commit message, nothing else:
PROMPT
)
  COMMIT_MSG=$(echo "$PROMPT_TEXT" | llm-run classify --stdin 2>/dev/null || echo "")
fi

# Clean up the message (remove quotes, trailing whitespace)
COMMIT_MSG=$(echo "$COMMIT_MSG" | head -1 | sed 's/^["'"'"']//;s/["'"'"']$//' | tr -d '\n')

# Fallback if LLM failed
if [[ -z "$COMMIT_MSG" || ${#COMMIT_MSG} -lt 5 ]]; then
  COMMIT_MSG="chore: daily knowledge base update ($(date '+%Y-%m-%d'))"
fi

# Commit
git commit -m "$COMMIT_MSG" --quiet

echo "$(date '+%Y-%m-%d %H:%M:%S') — Committed: $COMMIT_MSG" >> "$LOG_FILE"
echo "Committed: $COMMIT_MSG"
