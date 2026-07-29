#!/bin/bash
# compile.sh — Compile raw/ sources marked compiled:false into wiki/.
# Calls claude -p directly with --permission-mode acceptEdits so file writes
# actually execute (without it, claude plans but never writes).

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
RAW_DIR="$KB_DIR/raw"
WIKI_DIR="$KB_DIR/wiki"
LOG_FILE="$KB_DIR/scripts/compile.log"
LAST_RUN="$KB_DIR/scripts/.last-compile"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting wiki compilation" >> "$LOG_FILE"

# grep exits 1 on zero matches; under set -e/pipefail that killed the whole
# script every night once raw/ was fully compiled. || true keeps no-match benign.
UNCOMPILED=$({ grep -rl "compiled: false" "$RAW_DIR"/ 2>/dev/null || true; } | wc -l | tr -d ' ')

if [[ "$UNCOMPILED" == "0" ]]; then
  echo "No new sources to compile. Wiki is up to date."
  echo "$(date '+%Y-%m-%d %H:%M:%S') — No new sources, skipping" >> "$LOG_FILE"
  exit 0
fi

echo "Found $UNCOMPILED uncompiled source(s). Compiling..."

PROMPT_TEXT=$(cat <<PROMPT
Compile raw sources into wiki articles. EXECUTE — do not describe a plan.

# Workspace
- Raw sources: $RAW_DIR/  (files containing "compiled: false" in frontmatter)
- Wiki output: $WIKI_DIR/
  - summaries/ — one summary per source
  - concepts/ — concept articles (one per topic)
  - index.md — master index

# Steps (do these silently using Read/Write/Edit tools)
1. Use Glob to find all .md files in $RAW_DIR/.
2. Use Read on each. Skip those that do not contain "compiled: false".
3. For each uncompiled source:
   a. Use Write to create $WIKI_DIR/summaries/<source-stem>.md — a 200-500 word summary with frontmatter (classification: PRIVATE, source: <original filename>, created: <ISO>, tags: [...]).
   b. Extract concepts. For each concept:
      - If $WIKI_DIR/concepts/<concept-slug>.md exists, use Edit to merge new information in.
      - Otherwise use Write to create $WIKI_DIR/concepts/<concept-slug>.md (frontmatter: classification: PRIVATE, type: concept, created, sources, tags). Include [[wikilinks]] to related concepts.
   c. Use Edit on the raw source to change "compiled: false" to "compiled: true".
4. Use Write to update $WIKI_DIR/index.md with current article list, counts, and last-compile timestamp.

# Rules
- Use Obsidian-compatible [[wikilinks]] for cross-references.
- Every wiki file MUST have frontmatter with classification (default PRIVATE).
- Concept articles 300-1000 words, summaries 200-500.
- Do NOT print summaries to stdout. Use the file-writing tools only.
- After processing all sources, exit. No final summary needed.
PROMPT
)

echo "$PROMPT_TEXT" | claude -p \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Write,Glob,Grep,Edit" \
  --model sonnet \
  >> "$LOG_FILE" 2>&1
COMPILE_EXIT=$?

if [[ $COMPILE_EXIT -ne 0 ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: claude exited $COMPILE_EXIT" >> "$LOG_FILE"
  echo "Compilation failed (exit $COMPILE_EXIT). Check $LOG_FILE"
  exit 1
fi

date '+%Y-%m-%d %H:%M:%S' > "$LAST_RUN"

if neuron config show 2>/dev/null | grep -q "semantic_search: ON"; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Running incremental reindex" >> "$LOG_FILE"
  neuron reindex 2>&1 | tail -5 >> "$LOG_FILE" || true
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') — Compilation complete" >> "$LOG_FILE"
echo "Done. Open ~/knowledge-base/ in Obsidian to browse."
