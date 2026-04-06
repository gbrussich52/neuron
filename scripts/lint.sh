#!/bin/bash
# lint.sh — Wiki health checks and self-improvement
# Finds inconsistencies, broken links, missing data, and suggests new articles.

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
WIKI_DIR="$KB_DIR/wiki"
LOG_FILE="$KB_DIR/scripts/lint.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting wiki lint" >> "$LOG_FILE"

# Step 0: Run classification audit first
echo "Running classification audit..."
"$KB_DIR/scripts/classify-check.sh" 2>&1 || echo "  (classification issues found — will be addressed in lint)"
echo ""

# Count current articles for context
CONCEPTS=$(ls "$WIKI_DIR/concepts/"*.md 2>/dev/null | wc -l | tr -d ' ')
SUMMARIES=$(ls "$WIKI_DIR/summaries/"*.md 2>/dev/null | wc -l | tr -d ' ')
SESSIONS=$(ls "$WIKI_DIR/sessions/"*.md 2>/dev/null | wc -l | tr -d ' ')

if [[ "$CONCEPTS" == "0" && "$SUMMARIES" == "0" ]]; then
  echo "Wiki is empty. Run compile.sh first."
  exit 0
fi

echo "Linting wiki ($CONCEPTS concepts, $SUMMARIES summaries, $SESSIONS sessions)..."

claude --print "
You are a wiki linter and quality auditor. Your job is to improve an existing knowledge base.

## Your workspace
- Wiki: $WIKI_DIR/
  - concepts/ — concept articles
  - summaries/ — source summaries
  - queries/ — filed Q&A results
  - index.md — master index

## Lint checks (run all of these)

### 1. Broken links
- Find all [[wikilinks]] in every .md file
- Check each link resolves to an actual file
- Fix or remove broken links

### 2. Orphaned articles
- Find articles with zero inbound links
- Add links from related articles, or flag for review

### 3. Inconsistencies
- Find contradictory facts across articles
- Resolve by keeping the most authoritative/recent source
- Add a note about the resolution

### 4. Missing data
- Find vague statements that could be made specific ('some studies show' → which studies?)
- Find dates written relatively ('recently') and convert to absolute dates
- Flag gaps where an article references a concept with no article of its own

### 5. Connection discovery
- Identify non-obvious connections between concepts that aren't yet linked
- Add [[wikilinks]] where appropriate
- Suggest 3-5 new article topics that would fill gaps in the knowledge base

### 6. Index freshness
- Verify index.md accurately reflects current articles
- Update stats, fix any stale entries

## Output
- Fix everything you can directly (edit files in place)
- Write a lint report to $WIKI_DIR/lint-report.md with:
  - What was fixed
  - What needs human attention
  - Suggested new articles to explore
  - Overall health score (A/B/C/D/F)

Be aggressive about fixing issues. Conservative about deleting content.
" --allowedTools "Read,Write,Glob,Grep,Edit" 2>&1 | tail -30 >> "$LOG_FILE"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Lint complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
echo "Done. Check $WIKI_DIR/lint-report.md for results."
