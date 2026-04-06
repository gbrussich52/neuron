#!/bin/bash
# autoDream — Weekly memory + knowledge base consolidation
# Runs via launchd: ~/Library/LaunchAgents/com.giani.memory-consolidation.plist

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
MEMORY_DIR="$KB_DIR/memory"
LOG_FILE="$KB_DIR/scripts/consolidate.log"

# Discover Claude Code project memory directory dynamically
PROJECT_MEMORY=$(find "$HOME/.claude/projects" -maxdepth 2 -name "MEMORY.md" -type f 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "")

# Discover project-level memory directories (any .claude/memory/ under common project roots)
PROJECT_MEMORIES=$(find "$HOME" -maxdepth 5 -path "*/.claude/memory/gotchas.md" -type f 2>/dev/null | xargs -I{} dirname {} 2>/dev/null || echo "")

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting consolidation" >> "$LOG_FILE"

# Step 1: Run classification audit (non-blocking)
echo "$(date '+%Y-%m-%d %H:%M:%S') — Running classification audit" >> "$LOG_FILE"
"$KB_DIR/scripts/classify-check.sh" >> "$LOG_FILE" 2>&1 || true

# Step 2: Consolidate memory + session extracts
claude --print "
You are a memory and knowledge consolidation agent. Your job is aggressive pruning, deduplication, and integration.

## Your workspace

### Memory files (working context)
1. $MEMORY_DIR/ (global: context.md, preferences.md, projects.md, people.md)
2. $PAP_MEMORY/ (project: domain.md, decisions.md, gotchas.md)
3. $PROJECT_MEMORY/MEMORY.md (the pointer index — pointers only, no content)

### Session extracts (auto-captured learnings)
4. $KB_DIR/wiki/sessions/ — session extract files from recent Claude Code conversations

## Consolidation rules

### Memory pruning
1. DELETE anything derivable from code (file paths, function signatures, test counts, migration lists)
2. DELETE stack traces, debug logs, sprint summaries, PR history
3. MERGE duplicate facts — keep the most specific/recent version
4. RESOLVE contradictions — keep most recent, delete older
5. CONVERT vague entries to absolute ('usually Python' → 'Python 3.13')
6. CONVERT relative dates to absolute ('last week' → actual date)
7. DELETE entries where the referenced file/function no longer exists (check first)

### Session extract integration
8. Read all session extracts in $KB_DIR/wiki/sessions/
9. PROMOTE valuable decisions → append to the appropriate decisions.md
10. PROMOTE valuable gotchas → append to the appropriate gotchas.md
11. PROMOTE new people/stakeholders → append to people.md
12. UPDATE context.md if sessions reveal changed priorities or new open issues
13. After promoting, do NOT delete the session extract — it stays as a historical record

### Classification enforcement
14. Every .md file MUST have 'classification:' in its frontmatter (PUBLIC, PRIVATE, or CONFIDENTIAL)
15. If a file is missing classification, add 'classification: PRIVATE' as default
16. Scan for credential patterns (API keys, tokens, passwords) — flag any found

### Index rules
17. MEMORY.md must be pointers only — no content, ~150 chars per line
18. Keep MEMORY.md under 50 lines total
19. Include classification label on each pointer line

## Tone
Be aggressive about pruning. Conservative about deleting session extracts.
Memory that doesn't actively help future conversations is dead weight.

Write all updated files back. Log what you changed to stdout.
" --allowedTools "Read,Write,Glob,Grep,Edit,Bash" 2>&1 | tail -30 >> "$LOG_FILE"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Consolidation complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
