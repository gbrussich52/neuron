#!/bin/bash
# notes-sweep.sh — Move unstructured notes from Notes/ to Inbox/ for processing
# Runs nightly via LaunchAgent/cron. Skips hidden files and .about.md.
#
# Notes/ is the "write anything" zone. No frontmatter needed.
# Inbox/ is where neuron picks them up for classification and compilation.

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
NOTES_DIR="$KB_DIR/Notes"
INBOX_DIR="$KB_DIR/Inbox"
LOG_FILE="$KB_DIR/scripts/notes-sweep.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Count pending notes (skip hidden files and .about.md)
PENDING=$(find "$NOTES_DIR" -maxdepth 1 -type f -not -name '.*' 2>/dev/null | wc -l | tr -d ' ')

if [[ "$PENDING" == "0" ]]; then
  exit 0
fi

echo "$TIMESTAMP — Sweeping $PENDING note(s) from Notes/ → Inbox/" >> "$LOG_FILE"

for note in "$NOTES_DIR"/*; do
  [[ ! -f "$note" ]] && continue
  BASENAME=$(basename "$note")
  [[ "$BASENAME" == .* ]] && continue

  # Move to Inbox — neuron process will add frontmatter and classify
  mv "$note" "$INBOX_DIR/$BASENAME"
  echo "  Moved: $BASENAME" >> "$LOG_FILE"
done

echo "$TIMESTAMP — Sweep complete" >> "$LOG_FILE"
