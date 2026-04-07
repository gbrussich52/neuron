#!/bin/bash
# auto-commit.sh — Smart git auto-commit for knowledge base
# Creates a commit with an LLM-generated message summarizing changes.
# Designed to run daily via LaunchAgent (11pm).
#
# Usage: auto-commit.sh [--dry-run]

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
LLM_RUN="$KB_DIR/brain-cli/llm-run.js"
LOG_FILE="$KB_DIR/scripts/auto-commit.log"

cd "$KB_DIR"

# Ensure git is initialized
if [[ ! -d ".git" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Git not initialized in $KB_DIR. Run: git init" >> "$LOG_FILE"
  echo "Git not initialized. Run: cd ~/knowledge-base && git init"
  exit 0
fi

# Check for changes
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — No changes to commit" >> "$LOG_FILE"
  exit 0
fi

# Stage all changes (respecting .gitignore)
git add -A

# Get diff summary for commit message
DIFF_SUMMARY=$(git diff --cached --stat 2>/dev/null | tail -5)
CHANGED_FILES=$(git diff --cached --name-only 2>/dev/null | head -20)

# Dry run mode
if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Would commit:"
  echo "$DIFF_SUMMARY"
  echo ""
  echo "Files:"
  echo "$CHANGED_FILES"
  git reset HEAD -- . >/dev/null 2>&1
  exit 0
fi

# Generate smart commit message using classify tier (cheapest)
COMMIT_MSG=$(node "$LLM_RUN" classify --stdin <<PROMPT 2>/dev/null || echo "chore: daily knowledge base update")
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
