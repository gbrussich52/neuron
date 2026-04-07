#!/bin/bash
# sync.sh — Cross-device knowledge base sync via git
# Uses git-crypt for encrypting PRIVATE/CONFIDENTIAL files.
#
# Usage:
#   sync.sh push       — Commit and push to remote
#   sync.sh pull       — Pull latest from remote
#   sync.sh status     — Show sync status
#   sync.sh init       — Initialize git + git-crypt in KB

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
cd "$KB_DIR"

ACTION="${1:-status}"

case "$ACTION" in

  init)
    # Initialize git repo if needed
    if [[ ! -d ".git" ]]; then
      git init
      echo "Git initialized in $KB_DIR"
    fi

    # Create .gitignore if needed
    if [[ ! -f ".gitignore" ]]; then
      cat > .gitignore <<'GITIGNORE'
# Node
node_modules/
.brain-state.json

# Obsidian
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/graph.json

# OS
.DS_Store
Thumbs.db

# Logs
scripts/*.log

# Temporary
*.tmp
*.bak
GITIGNORE
      echo ".gitignore created"
    fi

    # Initialize git-crypt if available
    if command -v git-crypt &>/dev/null; then
      if [[ ! -f ".git-crypt/.gitattributes" ]]; then
        git-crypt init

        # Create .gitattributes for encrypted files
        cat > .gitattributes <<'GITATTR'
# Encrypt CONFIDENTIAL files
memory/people.md filter=git-crypt diff=git-crypt

# Encrypt any file explicitly marked
*.confidential.md filter=git-crypt diff=git-crypt
GITATTR
        echo ".gitattributes created (git-crypt)"
        echo ""
        echo "IMPORTANT: Export a key for other devices:"
        echo "  git-crypt export-key ~/knowledge-base-key"
        echo "  # Copy this key securely to other devices"
        echo "  # On other device: git-crypt unlock ~/knowledge-base-key"
      else
        echo "git-crypt already initialized"
      fi
    else
      echo "WARNING: git-crypt not installed. CONFIDENTIAL files will NOT be encrypted."
      echo "  Install: brew install git-crypt"
    fi

    echo ""
    echo "Next steps:"
    echo "  1. Create a private remote: gh repo create knowledge-base --private"
    echo "  2. Add remote: git remote add origin <url>"
    echo "  3. First push: sync.sh push"
    ;;

  push)
    if [[ ! -d ".git" ]]; then
      echo "Not a git repo. Run: sync.sh init"
      exit 1
    fi

    # Auto-commit if there are changes
    bash "$KB_DIR/scripts/auto-commit.sh" 2>/dev/null || true

    # Push
    REMOTE=$(git remote 2>/dev/null | head -1)
    if [[ -z "$REMOTE" ]]; then
      echo "No remote configured. Add one:"
      echo "  git remote add origin <url>"
      exit 1
    fi

    BRANCH=$(git branch --show-current)
    git push "$REMOTE" "$BRANCH"
    echo "Pushed to $REMOTE/$BRANCH"
    ;;

  pull)
    if [[ ! -d ".git" ]]; then
      echo "Not a git repo. Run: sync.sh init"
      exit 1
    fi

    REMOTE=$(git remote 2>/dev/null | head -1)
    if [[ -z "$REMOTE" ]]; then
      echo "No remote configured."
      exit 1
    fi

    BRANCH=$(git branch --show-current)
    git pull "$REMOTE" "$BRANCH" --rebase
    echo "Pulled from $REMOTE/$BRANCH"
    ;;

  status)
    if [[ ! -d ".git" ]]; then
      echo "Not a git repo. Run: sync.sh init"
      exit 0
    fi

    echo "=== Knowledge Base Sync Status ==="
    echo ""

    REMOTE=$(git remote -v 2>/dev/null | head -1 || echo "none")
    echo "  Remote: $REMOTE"

    BRANCH=$(git branch --show-current 2>/dev/null || echo "none")
    echo "  Branch: $BRANCH"

    # Check for uncommitted changes
    CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    echo "  Uncommitted changes: $CHANGES"

    # Check if ahead/behind remote
    if git remote 2>/dev/null | head -1 | grep -q .; then
      git fetch --quiet 2>/dev/null || true
      AHEAD=$(git rev-list --count HEAD..."@{u}" --left-only 2>/dev/null || echo "?")
      BEHIND=$(git rev-list --count HEAD..."@{u}" --right-only 2>/dev/null || echo "?")
      echo "  Ahead: $AHEAD / Behind: $BEHIND"
    fi

    # git-crypt status
    if command -v git-crypt &>/dev/null && [[ -d ".git-crypt" ]]; then
      echo "  Encryption: git-crypt active"
    else
      echo "  Encryption: not configured"
    fi

    echo ""
    ;;

  *)
    echo "Usage: sync.sh <push|pull|status|init>"
    ;;
esac
