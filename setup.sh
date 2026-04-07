#!/bin/bash
# setup.sh — Install Neuron
# Creates the directory structure, installs scripts, and configures automation.
#
# Usage:
#   ./setup.sh                    # Install to ~/knowledge-base/
#   ./setup.sh /path/to/vault     # Install to custom location
#   ./setup.sh --uninstall        # Remove automation (keeps data)

set -euo pipefail

# Configuration
KB_DIR="${1:-$HOME/knowledge-base}"
SCRIPTS_SRC="$(cd "$(dirname "$0")" && pwd)/scripts"
TEMPLATES_SRC="$(cd "$(dirname "$0")" && pwd)/templates"
PLIST_DIR="$HOME/Library/LaunchAgents"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; }

# Uninstall mode
if [[ "${1:-}" == "--uninstall" ]]; then
  echo "Removing automation (your data in ~/knowledge-base/ is untouched)..."
  if [[ "$(uname)" == "Darwin" ]]; then
    launchctl unload "$PLIST_DIR/com.llm-kb.consolidation.plist" 2>/dev/null || true
    launchctl unload "$PLIST_DIR/com.llm-kb.compile-lint.plist" 2>/dev/null || true
    rm -f "$PLIST_DIR/com.llm-kb.consolidation.plist"
    rm -f "$PLIST_DIR/com.llm-kb.compile-lint.plist"
  elif [[ "$(uname)" == "Linux" ]]; then
    (crontab -l 2>/dev/null | grep -v "llm-kb" || true) | crontab -
  fi
  info "Automation removed. Data preserved at ~/knowledge-base/"
  exit 0
fi

echo ""
echo "=== Neuron Installer ==="
echo "LLM-powered second brain — based on the Karpathy pattern"
echo ""
echo "Install location: $KB_DIR"
echo ""

# Check for at least one LLM provider
HAS_PROVIDER=false
if command -v claude &>/dev/null; then
  info "Found: Claude Code CLI"
  HAS_PROVIDER=true
fi
if command -v ollama &>/dev/null; then
  info "Found: Ollama (local models)"
  HAS_PROVIDER=true
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  info "Found: Anthropic API key"
  HAS_PROVIDER=true
fi
if [[ "$HAS_PROVIDER" == "false" ]]; then
  error "No LLM provider found. Install one of:"
  error "  - Claude Code CLI: https://claude.ai/code"
  error "  - Ollama (local): brew install ollama"
  error "  - Set ANTHROPIC_API_KEY for direct API access"
  exit 1
fi

# Create directory structure
info "Creating directory structure..."
mkdir -p "$KB_DIR"/{Inbox,Archive,Daily,Dashboards,Brain-Index,raw,wiki/{concepts,summaries,queries,sessions},memory,brain-cli,scripts,.obsidian/snippets,templates}

# Copy scripts
info "Installing scripts..."
for script in capture.sh compile.sh lint.sh query.sh ingest.sh session-extract.sh session-hook.sh classify-check.sh consolidate.sh auto-commit.sh sync.sh notes-sweep.sh; do
  if [[ -f "$SCRIPTS_SRC/$script" ]]; then
    sed "s|\$HOME/knowledge-base|$KB_DIR|g" "$SCRIPTS_SRC/$script" > "$KB_DIR/scripts/$script"
    chmod +x "$KB_DIR/scripts/$script"
  fi
done

# Copy brain-cli
BRAIN_SRC="$(cd "$(dirname "$0")" && pwd)/brain-cli"
info "Installing brain CLI..."
for brainfile in brain.js providers.js llm-run.js semantic.js connections.js metrics.js research.js improve.js neuron.config.json package.json; do
  if [[ -f "$BRAIN_SRC/$brainfile" ]]; then
    cp "$BRAIN_SRC/$brainfile" "$KB_DIR/brain-cli/$brainfile"
  fi
done
chmod +x "$KB_DIR/brain-cli/llm-run.js"

# Copy dashboards
DASH_SRC="$(cd "$(dirname "$0")" && pwd)/Dashboards"
info "Installing dashboards..."
for dash in "$DASH_SRC"/*.md; do
  [[ -f "$dash" ]] && cp "$dash" "$KB_DIR/Dashboards/"
done

# Create tracking files
touch "$KB_DIR/scripts/.processed-sessions"
touch "$KB_DIR/scripts/compile.log"
touch "$KB_DIR/scripts/lint.log"
touch "$KB_DIR/scripts/session-extract.log"
touch "$KB_DIR/scripts/consolidate.log"

# Create Notes/ readme
if [[ ! -f "$KB_DIR/Notes/.about.md" ]]; then
  cat > "$KB_DIR/Notes/.about.md" <<'NOTESREADME'
---
classification: PUBLIC
type: readme
---

# Notes

Unstructured brain dump zone. Write anything here — no frontmatter needed, no format required.

A nightly sweep moves everything from Notes/ to Inbox/ where neuron processes, classifies, and compiles it into the wiki.

Just create a new note and start typing.
NOTESREADME
fi

# Install templates
info "Creating template files..."

if [[ ! -f "$KB_DIR/memory/context.md" ]]; then
  cp "$TEMPLATES_SRC/memory/"*.md "$KB_DIR/memory/" 2>/dev/null || true
fi

if [[ ! -f "$KB_DIR/wiki/index.md" ]]; then
  cat > "$KB_DIR/wiki/index.md" <<'WIKI_INDEX'
---
classification: PUBLIC
updated: $(date '+%Y-%m-%d')
---

# Knowledge Base Index

> Auto-maintained by LLM compilation pipeline. Do not edit manually.
> Last compiled: (not yet run)

## Concepts
(Run `capture.sh compile` after ingesting sources.)

## Sources
(Run `capture.sh url <url> [tags]` to add sources.)

## Stats
- Total sources: 0
- Total concepts: 0
- Last lint: never
WIKI_INDEX
fi

# Install Obsidian config
info "Configuring Obsidian vault..."
cat > "$KB_DIR/.obsidian/app.json" <<'OBSIDIAN'
{
  "showLineNumber": true,
  "strictLineBreaks": false,
  "readableLineLength": true,
  "defaultViewMode": "preview"
}
OBSIDIAN

cat > "$KB_DIR/.obsidian/snippets/classification-badges.css" <<'CSS'
/* Classification badges — visual indicators for security labels */
/* Enable: Settings → Appearance → CSS Snippets → toggle on */
.metadata-container .metadata-property[data-property-key="classification"][data-property-value="CONFIDENTIAL"] .metadata-property-value {
  color: #ff4444; font-weight: bold;
}
.metadata-container .metadata-property[data-property-key="classification"][data-property-value="PRIVATE"] .metadata-property-value {
  color: #ff9800; font-weight: bold;
}
.metadata-container .metadata-property[data-property-key="classification"][data-property-value="PUBLIC"] .metadata-property-value {
  color: #4caf50; font-weight: bold;
}
CSS

# Install .gitignore
info "Installing security .gitignore..."
cat > "$KB_DIR/.gitignore" <<'GITIGNORE'
# CONFIDENTIAL — never leaves this machine
memory/people.md

# PRIVATE — block by default
memory/context.md
memory/projects.md
wiki/sessions/

# Logs
scripts/*.log
scripts/.last-*
scripts/.processed-sessions

# Obsidian internals
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/plugins/
.obsidian/hotkeys.json

# OS / temp
.DS_Store
Thumbs.db
*.tmp
*.bak
GITIGNORE

# Set up LaunchAgents (macOS only)
if [[ "$(uname)" == "Darwin" ]]; then
  info "Setting up weekly automation..."
  mkdir -p "$PLIST_DIR"

  # Monday 9am — memory consolidation
  cat > "$PLIST_DIR/com.llm-kb.consolidation.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.llm-kb.consolidation</string>
    <key>ProgramArguments</key>
    <array><string>/bin/bash</string><string>$KB_DIR/scripts/consolidate.sh</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$KB_DIR/scripts/consolidate-stdout.log</string>
    <key>StandardErrorPath</key><string>$KB_DIR/scripts/consolidate-stderr.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST

  # Wednesday 9am — compile + lint
  cat > "$PLIST_DIR/com.llm-kb.compile-lint.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.llm-kb.compile-lint</string>
    <key>ProgramArguments</key>
    <array><string>/bin/bash</string><string>-c</string><string>$KB_DIR/scripts/compile.sh 2>&amp;1; $KB_DIR/scripts/lint.sh 2>&amp;1</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$KB_DIR/scripts/cron-stdout.log</string>
    <key>StandardErrorPath</key><string>$KB_DIR/scripts/cron-stderr.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST

  # Nightly 10pm — sweep Notes/ → Inbox/
  cat > "$PLIST_DIR/com.llm-kb.notes-sweep.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.llm-kb.notes-sweep</string>
    <key>ProgramArguments</key>
    <array><string>/bin/bash</string><string>$KB_DIR/scripts/notes-sweep.sh</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$KB_DIR/scripts/notes-sweep-stdout.log</string>
    <key>StandardErrorPath</key><string>$KB_DIR/scripts/notes-sweep-stderr.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST

  launchctl load "$PLIST_DIR/com.llm-kb.consolidation.plist" 2>/dev/null || true
  launchctl load "$PLIST_DIR/com.llm-kb.compile-lint.plist" 2>/dev/null || true
  launchctl load "$PLIST_DIR/com.llm-kb.notes-sweep.plist" 2>/dev/null || true
  info "Automation scheduled: notes sweep (10pm), consolidation (Mon 9am), compile+lint (Wed 9am)"

elif [[ "$(uname)" == "Linux" ]]; then
  info "Setting up weekly automation via cron..."

  # Build cron entries
  CRON_CONSOLIDATE="0 9 * * 1 $KB_DIR/scripts/consolidate.sh >> $KB_DIR/scripts/consolidate-stdout.log 2>&1"
  CRON_COMPILE="0 9 * * 3 $KB_DIR/scripts/compile.sh >> $KB_DIR/scripts/cron-stdout.log 2>&1; $KB_DIR/scripts/lint.sh >> $KB_DIR/scripts/cron-stdout.log 2>&1"

  # Add to crontab without duplicating
  (crontab -l 2>/dev/null | grep -v "llm-kb" || true; echo "# llm-kb: consolidation (Mon 9am)"; echo "$CRON_CONSOLIDATE"; echo "# llm-kb: compile+lint (Wed 9am)"; echo "$CRON_COMPILE") | crontab -
  info "Cron jobs installed: consolidation (Mon 9am), compile+lint (Wed 9am)"

else
  warn "Unsupported OS for automatic scheduling. Run scripts manually or set up your own cron."
fi

echo ""
info "Installation complete!"
echo ""
echo "Quick start:"
echo "  cd $KB_DIR/brain-cli"
echo "  node brain.js braindump                  # Drop a brain dump"
echo "  node brain.js status                     # Check KB health"
echo "  $KB_DIR/scripts/capture.sh url https://example.com ai,research"
echo "  $KB_DIR/scripts/capture.sh compile       # Compile raw → wiki"
echo "  node brain.js metrics                    # Check your Brain Score"
echo ""
echo "Optional — local models (zero API cost):"
echo "  brew install ollama && brew services start ollama"
echo "  ollama pull gemma4:e2b && ollama pull nomic-embed-text"
echo "  node brain.js config provider openai-compatible"
echo ""
echo "Optional — semantic search:"
echo "  node brain.js reindex"
echo "  node brain.js smart-search \"your query\""
echo ""
echo "Optional — auto-extract session learnings (Claude Code hook):"
echo "  claude settings set hooks.Stop '[{\"command\": \"$KB_DIR/scripts/session-hook.sh\"}]'"
echo ""
echo "Open in Obsidian: File → Open Vault → $KB_DIR"
echo "Full guide: see QUICKSTART.md"
echo ""
