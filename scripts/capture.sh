#!/bin/bash
# capture.sh — Single entry point for capturing anything into the knowledge base
#
# Usage:
#   capture.sh url <url> [tags]              — Ingest a web source
#   capture.sh file <path> [tags]            — Ingest a local file
#   capture.sh thought "text" [tags]         — Capture a thought/idea
#   capture.sh decision "text" [project]     — Log an architectural decision
#   capture.sh gotcha "text" [project]       — Log a gotcha/trap
#   capture.sh query "question"              — Q&A against the wiki
#   capture.sh audit                         — Run classification audit
#
# Examples:
#   capture.sh url https://example.com/article ai,research
#   capture.sh thought "Stripe webhooks need idempotency keys" pap
#   capture.sh decision "Using SECURITY DEFINER for RLS helpers" pap
#   capture.sh gotcha "PostgREST drops schemas on dashboard edit" pap
#   capture.sh query "What are FNMA bracketing requirements?"

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
SCRIPTS_DIR="$KB_DIR/scripts"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DATE_SLUG=$(date '+%Y-%m-%d_%H%M%S')

# ── Smart Routing ──────────────────────────────────────────────
# If the first argument looks like a URL or file path, skip the subcommand
# and route it automatically. This makes `capture.sh <url>` just work.

FIRST_ARG="${1:-help}"

if [[ "$FIRST_ARG" =~ ^https?:// ]]; then
  # It's a URL — route directly to ingest
  exec "$KB_DIR/scripts/ingest.sh" "$@"
elif [[ -f "$FIRST_ARG" && "$FIRST_ARG" != "help" ]]; then
  # It's a file path — route to ingest
  exec "$KB_DIR/scripts/ingest.sh" "$@"
fi

ACTION="$FIRST_ARG"
shift || true

# Project alias → memory directory mapping
resolve_project_memory() {
  local project="${1:-}"
  case "$project" in
    pap|property-appraisal-pro)
      echo "$HOME/project-claude/property-appraisal-pro/.claude/memory"
      ;;
    ft|finance-tracker)
      echo "$HOME/project-claude/finance-tracker-v3/.claude/memory"
      ;;
    *)
      echo "$KB_DIR/memory"
      ;;
  esac
}

case "$ACTION" in

  url)
    exec "$SCRIPTS_DIR/ingest.sh" "$@"
    ;;

  file)
    exec "$SCRIPTS_DIR/ingest.sh" "$@"
    ;;

  thought)
    TEXT="${1:?Usage: capture.sh thought \"your thought\" [tags]}"
    TAGS="${2:-untagged}"
    SLUG=$(echo "$TEXT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g' | cut -c1-50)
    OUTFILE="$KB_DIR/wiki/sessions/${DATE_SLUG}_${SLUG}.md"

    cat > "$OUTFILE" <<EOF
---
classification: PRIVATE
type: thought
captured: $TIMESTAMP
tags: [$TAGS]
compiled: false
---

# Thought

$TEXT
EOF
    echo "Captured thought → $(basename "$OUTFILE")"
    ;;

  decision)
    TEXT="${1:?Usage: capture.sh decision \"your decision\" [project]}"
    PROJECT="${2:-global}"
    MEM_DIR=$(resolve_project_memory "$PROJECT")
    mkdir -p "$MEM_DIR"
    TARGET="$MEM_DIR/decisions.md"

    if [[ ! -f "$TARGET" ]]; then
      cat > "$TARGET" <<EOF
---
classification: PRIVATE
updated: $(date '+%Y-%m-%d')
---

# Decisions

EOF
    fi

    # Append the decision
    cat >> "$TARGET" <<EOF

## $(date '+%Y-%m-%d') — Decision
$TEXT

EOF
    # Update the date in frontmatter
    sed -i '' "s/^updated: .*/updated: $(date '+%Y-%m-%d')/" "$TARGET"
    echo "Decision logged → $TARGET"
    ;;

  gotcha)
    TEXT="${1:?Usage: capture.sh gotcha \"the gotcha\" [project]}"
    PROJECT="${2:-global}"
    MEM_DIR=$(resolve_project_memory "$PROJECT")
    mkdir -p "$MEM_DIR"
    TARGET="$MEM_DIR/gotchas.md"

    if [[ ! -f "$TARGET" ]]; then
      cat > "$TARGET" <<EOF
---
classification: PRIVATE
updated: $(date '+%Y-%m-%d')
---

# Gotchas

EOF
    fi

    cat >> "$TARGET" <<EOF

## $(date '+%Y-%m-%d') — Gotcha
$TEXT

EOF
    sed -i '' "s/^updated: .*/updated: $(date '+%Y-%m-%d')/" "$TARGET"
    echo "Gotcha logged → $TARGET"
    ;;

  youtube|yt)
    URL="${1:?Usage: capture.sh youtube <youtube-url> [tags]}"
    TAGS="${2:-youtube}"
    # Write URL to Inbox — brain CLI handles yt-dlp processing
    SLUG=$(date '+%Y-%m-%d_%H%M%S')
    echo "$URL" > "$KB_DIR/Inbox/${SLUG}_youtube.md"
    echo "YouTube URL queued in Inbox/. Run 'neuron process' to extract transcript."
    ;;

  braindump|dump)
    exec node "$KB_DIR/brain-cli/brain.js" braindump
    ;;

  daily)
    exec node "$KB_DIR/brain-cli/brain.js" daily
    ;;

  insights)
    exec node "$KB_DIR/brain-cli/brain.js" insights
    ;;

  status)
    exec node "$KB_DIR/brain-cli/brain.js" status
    ;;

  search)
    exec node "$KB_DIR/brain-cli/brain.js" search "$@"
    ;;

  watch)
    exec node "$KB_DIR/brain-cli/brain.js" watch
    ;;

  process)
    exec node "$KB_DIR/brain-cli/brain.js" process
    ;;

  query)
    exec "$SCRIPTS_DIR/query.sh" "$@"
    ;;

  audit)
    exec "$SCRIPTS_DIR/classify-check.sh"
    ;;

  compile)
    exec "$SCRIPTS_DIR/compile.sh"
    ;;

  lint)
    exec "$SCRIPTS_DIR/lint.sh"
    ;;

  smart-search)
    exec node "$KB_DIR/brain-cli/brain.js" smart-search "$@"
    ;;

  semantic-search)
    exec node "$KB_DIR/brain-cli/brain.js" semantic-search "$@"
    ;;

  config)
    exec node "$KB_DIR/brain-cli/brain.js" config "$@"
    ;;

  reindex)
    exec node "$KB_DIR/brain-cli/brain.js" reindex
    ;;

  connections)
    exec node "$KB_DIR/brain-cli/brain.js" connections "$@"
    ;;

  metrics)
    exec node "$KB_DIR/brain-cli/brain.js" metrics "$@"
    ;;

  research)
    exec node "$KB_DIR/brain-cli/brain.js" research "$@"
    ;;

  deep-research)
    exec node "$KB_DIR/brain-cli/brain.js" deep-research "$@"
    ;;

  improve)
    exec node "$KB_DIR/brain-cli/brain.js" improve "$@"
    ;;

  help|*)
    cat <<EOF
Neuron — Knowledge Base Capture Tool

Usage: capture.sh <action> [args]

Capture:
  url <url> [tags]              Ingest a web source
  file <path> [tags]            Ingest a local file
  youtube <url> [tags]          Ingest YouTube video transcript
  thought "text" [tags]         Capture a thought or idea
  decision "text" [project]     Log an architectural decision
  gotcha "text" [project]       Log a gotcha or trap
  braindump                     Interactive brain dump (paste anything)

Knowledge:
  query "question"              Ask a question against the wiki
  search <query>                Full-text search across KB
  semantic-search <query>       Semantic/vector search (requires reindex)
  daily                         Generate today's daily note
  insights                      Proactive insight generation

Intelligence:
  connections <file>            Find related articles, suggest wikilinks
  metrics [--history]           Show thinking quality score
  research <topic>              Autonomous web research (single pass)
  deep-research <topic>         Karpathy auto-research loop (iterative)
  improve [--max-iterations N]  Self-improvement loop

Pipeline:
  watch                         Watch Inbox/ (or use `neuron watch`)
  process                       Process pending Inbox/ files
  compile                       Compile raw sources into wiki
  lint                          Run wiki health checks
  reindex                       Build/update semantic search index
  audit                         Security classification audit
  status                        Show KB stats and health

Projects: pap, ft, or omit for global

Examples:
  capture.sh url https://example.com ai,ml
  capture.sh youtube https://youtube.com/watch?v=abc123
  capture.sh braindump
  capture.sh thought "Rate limiting needs per-user quotas" pap
  capture.sh decision "Using Haiku for free tier, Sonnet for pro" pap
  capture.sh insights
  capture.sh status
EOF
    ;;
esac
