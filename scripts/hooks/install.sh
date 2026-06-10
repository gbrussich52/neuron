#!/usr/bin/env bash
# Idempotent installer: copies the Neuron pre-commit hook into .git/hooks.
# Re-run any time; part of the future `neuron bootstrap` (Plan 4).
set -euo pipefail
KB_DIR="${KB_DIR:-$HOME/knowledge-base}"
SRC="$KB_DIR/scripts/hooks/pre-commit"
DST="$KB_DIR/.git/hooks/pre-commit"
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
cp "$SRC" "$DST"
chmod +x "$DST"
echo "Installed pre-commit hook → $DST"
