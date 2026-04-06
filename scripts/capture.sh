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

ACTION="${1:-help}"
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

  help|*)
    cat <<EOF
Knowledge Base Capture Tool

Usage: capture.sh <action> [args]

Actions:
  url <url> [tags]              Ingest a web source into raw/
  file <path> [tags]            Ingest a local file into raw/
  thought "text" [tags]         Capture a thought or idea
  decision "text" [project]     Log an architectural decision
  gotcha "text" [project]       Log a gotcha or trap
  query "question"              Ask a question against the wiki
  compile                       Compile raw sources into wiki
  lint                          Run wiki health checks
  audit                         Run security classification audit

Projects: pap, ft, or omit for global

Examples:
  capture.sh url https://example.com ai,ml
  capture.sh thought "Need to add rate limiting to AI endpoint" pap
  capture.sh decision "Using Haiku for free tier, Sonnet for pro" pap
  capture.sh gotcha "PostgREST schema cache needs manual reload" pap
  capture.sh query "What are the USPAP retention requirements?"
  capture.sh audit
EOF
    ;;
esac
