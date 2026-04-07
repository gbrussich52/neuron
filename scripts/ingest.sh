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

# ── Source Type Detection ──────────────────────────────────────

detect_source_type() {
  local url="$1"
  case "$url" in
    *gist.github.com/*|*gist.githubusercontent.com/*)  echo "github-gist" ;;
    *github.com/*/blob/*|*raw.githubusercontent.com/*)  echo "github-file" ;;
    *youtube.com/watch*|*youtu.be/*)                    echo "youtube" ;;
    *linkedin.com/posts/*|*linkedin.com/pulse/*)        echo "linkedin" ;;
    *facebook.com/*/posts/*|*fb.com/*)                  echo "facebook" ;;
    *reddit.com/r/*/comments/*)                         echo "reddit" ;;
    *stackexchange.com/*|*stackoverflow.com/questions/*) echo "forum" ;;
    *news.ycombinator.com/item*)                        echo "forum" ;;
    *discourse.*)                                       echo "forum" ;;
    *medium.com/*|*substack.com/*|*.blogspot.com/*)     echo "blog" ;;
    *dev.to/*|*hashnode.dev/*)                           echo "blog" ;;
    *)                                                  echo "web" ;;
  esac
}

# ── Specialized Extractors ────────────────────────────────────

ingest_github_gist() {
  local url="$1" outfile="$2"
  echo "Extracting GitHub Gist: $url"

  # Extract gist ID from URL
  local gist_id=$(echo "$url" | grep -oE '[a-f0-9]{20,}' | head -1)

  if [[ -n "$gist_id" ]]; then
    # Use GitHub API for clean extraction
    local api_response=$(curl -sL "https://api.github.com/gists/$gist_id" 2>/dev/null)
    local description=$(echo "$api_response" | grep -o '"description":"[^"]*"' | head -1 | sed 's/"description":"//;s/"$//')
    local owner=$(echo "$api_response" | grep -o '"login":"[^"]*"' | head -1 | sed 's/"login":"//;s/"$//')

    # Extract all file contents
    local files_content=""
    for filename in $(echo "$api_response" | grep -o '"filename":"[^"]*"' | sed 's/"filename":"//;s/"$//'); do
      local raw_url=$(echo "$api_response" | grep -o "\"raw_url\":\"[^\"]*${filename}[^\"]*\"" | head -1 | sed 's/"raw_url":"//;s/"$//')
      if [[ -n "$raw_url" ]]; then
        files_content="${files_content}
### ${filename}
\`\`\`
$(curl -sL "$raw_url" 2>/dev/null | head -200)
\`\`\`
"
      fi
    done

    cat > "$outfile" <<FRONTMATTER
---
classification: PUBLIC
source_url: $url
gist_id: $gist_id
author: ${owner:-unknown}
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, github, gist]
type: github-gist
compiled: false
---

# Gist: ${description:-Untitled Gist}

**Author:** ${owner:-unknown}
**Source:** $url

## Files
${files_content}
FRONTMATTER
    return 0
  fi

  # Fallback to generic web extraction
  ingest_web "$url" "$outfile"
}

ingest_youtube_with_comments() {
  local url="$1" outfile="$2"
  echo "Extracting YouTube video + comments: $url"

  local title="Unknown Video"
  local transcript=""
  local comments=""

  # Get title
  if command -v yt-dlp &>/dev/null; then
    title=$(yt-dlp --get-title "$url" 2>/dev/null | head -1) || title="Unknown Video"

    # Get transcript
    local tmpbase="/tmp/neuron-yt-$(date +%s)"
    yt-dlp --write-auto-sub --sub-lang en --skip-download -o "$tmpbase" "$url" 2>/dev/null || true
    if [[ -f "${tmpbase}.en.vtt" ]]; then
      transcript=$(cat "${tmpbase}.en.vtt" | grep -v '^WEBVTT\|^Kind:\|^Language:\|^[0-9].*-->' | grep -v '^\s*$' | tr '\n' ' ' | sed 's/<[^>]*>//g' | head -c 10000)
      rm -f "${tmpbase}"*
    fi

    # Get top comments (yt-dlp can extract these)
    comments=$(yt-dlp --get-comments --no-download "$url" 2>/dev/null | head -100) || comments=""
  fi

  cat > "$outfile" <<FRONTMATTER
---
classification: PUBLIC
source_url: $url
title: "$(echo "$title" | sed 's/"/\\"/g')"
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, youtube, video]
type: youtube
compiled: false
---

# $title

Source: $url

## Transcript

${transcript:-No transcript available — video may need manual summarization.}

## Top Comments

${comments:-No comments extracted.}
FRONTMATTER
}

ingest_forum() {
  local url="$1" outfile="$2"
  echo "Extracting forum/discussion: $url"

  # Forums have threaded content — firecrawl handles them well
  # Fall back to curl with extra content extraction
  if command -v firecrawl &>/dev/null; then
    firecrawl scrape "$url" --format markdown > "$outfile.tmp" 2>/dev/null && {
      cat > "$outfile" <<FRONTMATTER
---
classification: PUBLIC
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, forum, discussion]
type: forum
compiled: false
---

FRONTMATTER
      cat "$outfile.tmp" >> "$outfile"
      rm "$outfile.tmp"
      return 0
    }
    rm -f "$outfile.tmp"
  fi

  # Fallback: curl with more generous content limit for forums
  CONTENT=$(curl -sL "$url" | sed 's/<[^>]*>//g' | head -1000)
  cat > "$outfile" <<FRONTMATTER
---
classification: PUBLIC
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, forum, discussion]
type: forum
compiled: false
---

$CONTENT
FRONTMATTER
}

ingest_social() {
  local url="$1" outfile="$2" platform="$3"
  echo "Extracting $platform post: $url"

  # Social platforms often block scrapers — firecrawl is best bet
  if command -v firecrawl &>/dev/null; then
    firecrawl scrape "$url" --format markdown > "$outfile.tmp" 2>/dev/null && {
      cat > "$outfile" <<FRONTMATTER
---
classification: PRIVATE
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, $platform, social]
type: $platform
compiled: false
---

FRONTMATTER
      cat "$outfile.tmp" >> "$outfile"
      rm "$outfile.tmp"
      return 0
    }
    rm -f "$outfile.tmp"
  fi

  # Fallback
  CONTENT=$(curl -sL "$url" | sed 's/<[^>]*>//g' | head -500)
  cat > "$outfile" <<FRONTMATTER
---
classification: PRIVATE
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS, $platform, social]
type: $platform
compiled: false
---

$CONTENT
FRONTMATTER
}

ingest_web() {
  local url="$1" outfile="$2"
  echo "Downloading: $url"

  if command -v firecrawl &>/dev/null; then
    firecrawl scrape "$url" --format markdown > "$outfile.tmp" 2>/dev/null && {
      cat > "$outfile" <<FRONTMATTER
---
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: web
compiled: false
---

FRONTMATTER
      cat "$outfile.tmp" >> "$outfile"
      rm "$outfile.tmp"
      return 0
    }
    rm -f "$outfile.tmp"
  fi

  CONTENT=$(curl -sL "$url" | sed 's/<[^>]*>//g' | head -500)
  cat > "$outfile" <<FRONTMATTER
---
source_url: $url
ingested: $(date '+%Y-%m-%d %H:%M:%S')
tags: [$TAGS]
type: web-raw
compiled: false
---

$CONTENT
FRONTMATTER
}

# ── Main Routing ──────────────────────────────────────────────

# Determine source type and generate filename
if [[ "$SOURCE" =~ ^https?:// ]]; then
  SLUG=$(echo "$SOURCE" | sed 's|https\?://||;s|[^a-zA-Z0-9]|_|g' | cut -c1-80)
  OUTFILE="$RAW_DIR/${TIMESTAMP}_${SLUG}.md"

  SOURCE_TYPE=$(detect_source_type "$SOURCE")
  echo "Detected source type: $SOURCE_TYPE"

  case "$SOURCE_TYPE" in
    github-gist)    ingest_github_gist "$SOURCE" "$OUTFILE" ;;
    github-file)    ingest_web "$SOURCE" "$OUTFILE" ;;
    youtube)        ingest_youtube_with_comments "$SOURCE" "$OUTFILE" ;;
    linkedin)       ingest_social "$SOURCE" "$OUTFILE" "linkedin" ;;
    facebook)       ingest_social "$SOURCE" "$OUTFILE" "facebook" ;;
    reddit)         ingest_forum "$SOURCE" "$OUTFILE" ;;
    forum)          ingest_forum "$SOURCE" "$OUTFILE" ;;
    blog)           ingest_web "$SOURCE" "$OUTFILE" ;;
    *)              ingest_web "$SOURCE" "$OUTFILE" ;;
  esac

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
