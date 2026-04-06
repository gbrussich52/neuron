#!/bin/bash
# compile.sh — Incrementally compile raw/ sources into wiki/
# Reads uncompiled sources, generates summaries + concept articles, updates index.
# Uses Claude CLI with restricted tools.

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
RAW_DIR="$KB_DIR/raw"
WIKI_DIR="$KB_DIR/wiki"
LOG_FILE="$KB_DIR/scripts/compile.log"
LAST_RUN="$KB_DIR/scripts/.last-compile"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting wiki compilation" >> "$LOG_FILE"

# Count uncompiled sources (files with 'compiled: false' in frontmatter)
UNCOMPILED=$(grep -rl 'compiled: false' "$RAW_DIR"/ 2>/dev/null | wc -l | tr -d ' ')

if [[ "$UNCOMPILED" == "0" ]]; then
  echo "No new sources to compile. Wiki is up to date."
  echo "$(date '+%Y-%m-%d %H:%M:%S') — No new sources, skipping" >> "$LOG_FILE"
  exit 0
fi

echo "Found $UNCOMPILED uncompiled source(s). Compiling..."

claude --print "
You are a knowledge base compiler. Your job is to incrementally compile raw sources into a structured wiki.

## Your workspace
- Raw sources: $RAW_DIR/ (look for files with 'compiled: false' in frontmatter)
- Wiki output: $WIKI_DIR/
  - summaries/ — one summary per source (named after the source file)
  - concepts/ — concept articles (one per topic, linked together)
  - index.md — master index (auto-maintained)

## Compilation steps

1. **Read all uncompiled sources** in $RAW_DIR/ (files containing 'compiled: false')
2. **For each source**, create a summary in $WIKI_DIR/summaries/:
   - Title, key points, tags, backlinks to related concepts
   - Filename: match the source filename but with .md extension
3. **Extract concepts** from the new sources:
   - If a concept article already exists in $WIKI_DIR/concepts/, UPDATE it with new information
   - If it's a new concept, CREATE a new article
   - Each concept article should have: definition, key facts, related concepts (as [[wikilinks]]), source references
4. **Update $WIKI_DIR/index.md**:
   - List all concepts alphabetically with one-line descriptions
   - List all sources with dates and tags
   - Update stats (total sources, concepts, last compile date)
5. **Mark sources as compiled**: change 'compiled: false' to 'compiled: true' in each processed raw file

## Formatting rules
- Use [[wikilinks]] for cross-references between concept articles (Obsidian-compatible)
- Every article gets frontmatter: title, tags, created, updated, sources
- Keep articles focused — one concept per file, split if too broad
- Summaries should be 200-500 words, concept articles 300-1000 words
- Use ## headings, bullet points, and bold for scanability

## Quality rules
- Prefer specific facts over vague statements
- Include numbers, dates, names when available
- Flag contradictions between sources explicitly
- If a source is low quality or redundant, note it but still compile it

Be thorough. Read every uncompiled source fully before writing.
" --allowedTools "Read,Write,Glob,Grep,Edit" 2>&1 | tail -30 >> "$LOG_FILE"
COMPILE_EXIT=$?

if [[ $COMPILE_EXIT -ne 0 ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: Claude CLI exited with code $COMPILE_EXIT" >> "$LOG_FILE"
  echo "---" >> "$LOG_FILE"
  echo "Compilation failed (exit code $COMPILE_EXIT). Check $LOG_FILE"
  exit 1
fi

# Update last-run timestamp
date '+%Y-%m-%d %H:%M:%S' > "$LAST_RUN"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Compilation complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
echo "Done. Open ~/knowledge-base/ in Obsidian to browse."
