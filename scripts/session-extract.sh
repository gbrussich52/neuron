#!/bin/bash
# session-extract.sh — Extract learnings from the most recent Claude Code session
# Called automatically via Claude Code Stop hook, or manually.
#
# Usage:
#   session-extract.sh                    — process most recent transcript
#   session-extract.sh <session-id>       — process a specific session

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
LOG_FILE="$KB_DIR/scripts/session-extract.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DATE_SLUG=$(date '+%Y-%m-%d_%H%M%S')

# Discover transcript directory dynamically — search all project dirs for most recent .jsonl
find_latest_transcript() {
  find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -type f 2>/dev/null \
    | xargs ls -t 2>/dev/null \
    | head -1
}

# Find the transcript to process
if [[ -n "${1:-}" ]]; then
  # Specific session ID — search all project dirs
  TRANSCRIPT=$(find "$HOME/.claude/projects" -maxdepth 2 -name "$1.jsonl" -type f 2>/dev/null | head -1)
else
  TRANSCRIPT=$(find_latest_transcript)
fi

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  echo "No transcript found."
  exit 0
fi

SESSION_ID=$(basename "$TRANSCRIPT" .jsonl)
OUTFILE="$KB_DIR/wiki/sessions/${DATE_SLUG}_session_${SESSION_ID:0:8}.md"

# Skip if transcript is too small (< 1KB = probably empty/trivial session)
FILE_SIZE=$(wc -c < "$TRANSCRIPT")
if [[ $FILE_SIZE -lt 1024 ]]; then
  echo "Session too short to extract ($FILE_SIZE bytes). Skipping."
  exit 0
fi

# Skip if already processed
if grep -q "$SESSION_ID" "$KB_DIR/scripts/.processed-sessions" 2>/dev/null; then
  echo "Session $SESSION_ID already processed. Skipping."
  exit 0
fi

echo "$TIMESTAMP — Extracting from session $SESSION_ID" >> "$LOG_FILE"

# Extract with Claude — read the transcript, pull out key learnings
# Use tail to get the most recent portion (last 200 lines) to stay within context
TRANSCRIPT_EXCERPT=$(tail -200 "$TRANSCRIPT")

claude --print "
You are a session extraction agent. You read Claude Code conversation transcripts and extract valuable knowledge.

## Input
Session transcript (last 200 lines of JSONL):
\`\`\`
$TRANSCRIPT_EXCERPT
\`\`\`

## What to extract

Look for these categories and extract ONLY non-obvious, non-code-derivable insights:

1. **Decisions made** — architectural choices, trade-offs, why one approach was chosen over another
2. **Gotchas discovered** — things that broke unexpectedly, workarounds, platform quirks
3. **New facts learned** — domain knowledge, API behaviors, tool limitations
4. **Open questions** — things that were deferred or left unresolved
5. **People mentioned** — stakeholders, collaborators, their roles

## Output

Write a session extract to: $OUTFILE

Format:
\`\`\`markdown
---
classification: PRIVATE
type: session-extract
session_id: $SESSION_ID
extracted: $TIMESTAMP
tags: [auto-extracted]
---

# Session Extract — $(date '+%Y-%m-%d')

## Summary
(2-3 sentence summary of what was accomplished)

## Decisions
(bulleted list, or 'None' if no significant decisions)

## Gotchas
(bulleted list, or 'None')

## Learnings
(bulleted list, or 'None')

## Open Questions
(bulleted list, or 'None')

## People
(bulleted list with roles, or 'None')
\`\`\`

## Rules
- Be aggressive about filtering. Only extract things that would be USEFUL in a future conversation.
- Skip: code changes (git has those), routine operations, status checks, trivial Q&A.
- Keep: WHY decisions were made, WHAT went wrong and how it was fixed, WHO needs to be contacted.
- If the session was trivial (just updates, simple lookups), write a 2-line summary and skip the sections.
- classification is always PRIVATE for session extracts.
" --allowedTools "Write" 2>&1 | tail -10 >> "$LOG_FILE"

# Mark as processed
echo "$SESSION_ID" >> "$KB_DIR/scripts/.processed-sessions"

echo "$TIMESTAMP — Extraction complete → $(basename "$OUTFILE")" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
echo "Extracted → $OUTFILE"
