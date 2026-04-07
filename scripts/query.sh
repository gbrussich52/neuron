#!/bin/bash
# query.sh — Ask questions against the knowledge base
# Usage: ./scripts/query.sh "Your question here"
# Results are displayed AND filed back into wiki/queries/

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
WIKI_DIR="$KB_DIR/wiki"
QUERY="$1"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')

if [[ -z "$QUERY" ]]; then
  echo "Usage: query.sh \"Your question here\""
  exit 1
fi

# Generate a slug for the output filename
SLUG=$(echo "$QUERY" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g' | cut -c1-60)
OUTFILE="$WIKI_DIR/queries/${TIMESTAMP}_${SLUG}.md"

echo "Researching: $QUERY"
echo ""

LLM_RUN="$KB_DIR/brain-cli/llm-run.js"

node "$LLM_RUN" synthesize --stdin --tools "Read,Write,Glob,Grep" <<PROMPT 2>&1
You are a research agent with access to a personal knowledge base.

## Question
$QUERY

## Your workspace
- Wiki: $WIKI_DIR/ (concepts/, summaries/, queries/, index.md)
- Raw sources: $KB_DIR/raw/

## Instructions

1. Read $WIKI_DIR/index.md first to understand what's available
2. Read relevant concept articles and summaries
3. If needed, read raw sources for deeper detail
4. Synthesize a thorough answer

## Output format

Write your answer to: $OUTFILE

Use this format:
\`\`\`markdown
---
title: [Descriptive title for this query]
query: "$QUERY"
date: $(date '+%Y-%m-%d')
sources_used: [list of wiki articles referenced]
tags: [relevant tags]
---

# [Title]

[Your thorough answer here, with [[wikilinks]] to relevant concept articles]

## Sources Referenced
[List the specific wiki articles and raw sources you used]
\`\`\`

Also print the answer to stdout so the user sees it immediately.

Be thorough. Cite specific facts from the wiki. If the wiki doesn't have enough to answer fully, say what's missing and suggest sources to ingest.
PROMPT

echo ""
echo "Answer filed to: $OUTFILE"
