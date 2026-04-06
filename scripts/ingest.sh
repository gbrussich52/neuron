#!/bin/bash
# ingest.sh — Add sources to the knowledge base
# Usage: ./scripts/ingest.sh <url-or-filepath> [tag1,tag2,...]
# Examples:
#   ./scripts/ingest.sh https://example.com/article ai,research
#   ./scripts/ingest.sh ~/Downloads/paper.pdf real-estate
#   ./scripts/ingest.sh ~/notes/idea.md personal

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
RAW_DIR="$KB_DIR/raw"
SOURCE="$1"
TAGS="${2:-untagged}"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')

if [[ -z "$SOURCE" ]]; then
  echo "Usage: ingest.sh <url-or-filepath> [tag1,tag2,...]"
  exit 1
fi

# Check for duplicate sources
if grep -rl "source_url: $SOURCE\|source_file: $SOURCE" "$RAW_DIR"/ 2>/dev/null | head -1 | grep -q .; then
  EXISTING=$(grep -rl "source_url: $SOURCE\|source_file: $SOURCE" "$RAW_DIR"/ 2>/dev/null | head -1)
  echo "Already ingested: $(basename "$EXISTING")"
  echo "Use a different URL or remove the existing file to re-ingest."
  exit 0
fi

# Determine source type and generate filename
if [[ "$SOURCE" =~ ^https?:// ]]; then
  # URL source — download with curl, convert with firecrawl if available
  SLUG=$(echo "$SOURCE" | sed 's|https\?://||;s|[^a-zA-Z0-9]|_|g' | cut -c1-80)
  OUTFILE="$RAW_DIR/${TIMESTAMP}_${SLUG}.md"

  echo "Downloading: $SOURCE"

  # Try firecrawl first (better markdown conversion), fall back to curl
  if command -v firecrawl &>/dev/null; then
    firecrawl scrape "$SOURCE" --format markdown > "$OUTFILE.tmp" 2>/dev/null && {
      # Wrap with frontmatter
      cat > "$OUTFILE" <<FRONTMATTER
---
source_url: $SOURCE
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: web
compiled: false
---

FRONTMATTER
      cat "$OUTFILE.tmp" >> "$OUTFILE"
      rm "$OUTFILE.tmp"
    } || {
      # firecrawl failed, fall back to curl
      rm -f "$OUTFILE.tmp"
      CONTENT=$(curl -sL "$SOURCE" | sed 's/<[^>]*>//g' | head -500)
      cat > "$OUTFILE" <<FRONTMATTER
---
source_url: $SOURCE
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: web-raw
compiled: false
---

$CONTENT
FRONTMATTER
    }
  else
    CONTENT=$(curl -sL "$SOURCE" | sed 's/<[^>]*>//g' | head -500)
    cat > "$OUTFILE" <<FRONTMATTER
---
source_url: $SOURCE
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: web-raw
compiled: false
---

$CONTENT
FRONTMATTER
  fi

elif [[ -f "$SOURCE" ]]; then
  # Local file — copy with frontmatter wrapper
  BASENAME=$(basename "$SOURCE")
  EXT="${BASENAME##*.}"
  OUTFILE="$RAW_DIR/${TIMESTAMP}_${BASENAME}"

  if [[ "$EXT" == "md" || "$EXT" == "txt" ]]; then
    # Text files: wrap with frontmatter
    cat > "$OUTFILE" <<FRONTMATTER
---
source_file: $SOURCE
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: local
compiled: false
---

FRONTMATTER
    cat "$SOURCE" >> "$OUTFILE"
  else
    # Binary files (PDF, images): copy as-is
    cp "$SOURCE" "$OUTFILE"
    # Create a sidecar metadata file
    cat > "${OUTFILE}.meta.md" <<FRONTMATTER
---
source_file: $SOURCE
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: binary
format: $EXT
compiled: false
---

Binary file: $BASENAME
Requires LLM processing during compilation.
FRONTMATTER
  fi
else
  echo "Error: '$SOURCE' is not a valid URL or file path"
  exit 1
fi

echo "Ingested: $(basename "$OUTFILE")"
echo "Tags: $TAGS"
echo ""
echo "Run ./scripts/compile.sh to compile into wiki."
