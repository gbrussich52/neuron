#!/bin/bash
# lint.sh — Wiki health checks, produces lint-report.json for the improvement loop.
# Calls claude -p directly (bypassing llm-run) to pass --permission-mode acceptEdits,
# which auto-accepts the Write tool calls. Without it, claude silently no-ops file writes
# in non-interactive mode and the loop never gets its JSON contract.

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
WIKI_DIR="$KB_DIR/wiki"
LOG_FILE="$KB_DIR/scripts/lint.log"
TS_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting wiki lint" >> "$LOG_FILE"

"$KB_DIR/scripts/classify-check.sh" 2>&1 || true

CONCEPTS=$(find "$WIKI_DIR/concepts" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
SUMMARIES=$(find "$WIKI_DIR/summaries" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

if [[ "$CONCEPTS" == "0" && "$SUMMARIES" == "0" ]]; then
  echo "Wiki is empty. Run compile.sh first."
  exit 0
fi

echo "Linting wiki ($CONCEPTS concepts, $SUMMARIES summaries)..."

# Bypass llm-run; call claude -p directly so we can pass --permission-mode acceptEdits.
PROMPT_TEXT=$(cat <<PROMPT
Write ONE file: $WIKI_DIR/lint-report.json

Steps (do silently):
1. Use Glob to list every .md under $WIKI_DIR/concepts/ and $WIKI_DIR/summaries/.
2. Use Read on the relevant ones.
3. Identify broken wikilinks, orphans (zero inbound links), missing concept articles (referenced by [[link]] but no file exists), vague content.
4. Assign overall letter grade A-F and numeric score 0-100 (A=90+, B=75-89, C=60-74, D=40-59, F<40).
5. List concrete researchable gaps with priorities 1-5.

Use the Write tool to write $WIKI_DIR/lint-report.json with EXACTLY this JSON (no markdown fences):

{
  "grade": "A|B|C|D|F",
  "score": <number 0-100>,
  "generated": "$TS_ISO",
  "gaps": [
    { "topic": "<short researchable topic>", "reason": "<why it's a gap>", "priority": <1-5> }
  ],
  "issues": [
    { "type": "broken-link|orphan|missing-article|vague-content", "detail": "<short>" }
  ]
}

Empty arrays are fine. Do not print the report. Use Write only. Exit immediately after writing.
PROMPT
)

echo "$PROMPT_TEXT" | claude -p \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Glob,Write" \
  --model sonnet \
  >> "$LOG_FILE" 2>&1
LINT_LLM_EXIT=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') — Lint LLM exit: $LINT_LLM_EXIT" >> "$LOG_FILE"

if [[ ! -f "$WIKI_DIR/lint-report.json" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: lint-report.json was not written" >> "$LOG_FILE"
  echo "ERROR: lint-report.json was not produced. Check $LOG_FILE."
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync('$WIKI_DIR/lint-report.json','utf-8'))" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: lint-report.json is invalid JSON" >> "$LOG_FILE"
  echo "ERROR: lint-report.json is not valid JSON. Check $LOG_FILE."
  exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') — Lint complete (JSON valid)" >> "$LOG_FILE"
echo "Done. lint-report.json written."
