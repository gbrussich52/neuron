#!/bin/bash
# neuron-nightly.sh — runs the autonomous improvement loop,
# logs to VAULT/logs/, commits results to the vault git repo.
#
# Invoked by ~/Library/LaunchAgents/com.giani.neuron-improve.plist at 03:07.
# Manual run: bash ~/knowledge-base/scripts/neuron-nightly.sh
#
# Implementation note (2026-05-23): originally invoked `claude -p "/goal ..."`
# per the Phase-2 plan, but `/goal` is interactive-only and silently no-ops
# under `claude -p`. Replaced with the Phase-1-hardened `neuron improve`
# loop, which already does compile → lint → JSON gaps → research → snapshot
# → repeat with saturation detection, and routes researched articles to
# wiki/_review/ for human approval (Task 3).

set -uo pipefail

KB_DIR="$HOME/knowledge-base"
LOG_DIR="$KB_DIR/logs"
TS=$(date '+%Y-%m-%d_%H%M%S')
LOG_FILE="$LOG_DIR/neuron-nightly-$TS.log"

mkdir -p "$LOG_DIR"

# Keep only the last 30 nightly logs
ls -1t "$LOG_DIR"/neuron-nightly-*.log 2>/dev/null | tail -n +31 | xargs -I{} rm -f {} 2>/dev/null || true

cd "$KB_DIR"

echo "=== neuron-nightly start $(date '+%Y-%m-%d %H:%M:%S %Z') ===" >> "$LOG_FILE"

# Ingest any pending Inbox items into raw/ first (non-fatal if it fails)
neuron process >> "$LOG_FILE" 2>&1 || true

# Then run the autonomous improvement loop. Stops at target grade B or after 5 iterations.
neuron improve --target-grade B --max-iterations 5 >> "$LOG_FILE" 2>&1
IMPROVE_EXIT=$?

echo "" >> "$LOG_FILE"
echo "=== neuron improve exit code: $IMPROVE_EXIT ===" >> "$LOG_FILE"

# Auto-commit the results, regardless of improve exit code.
# auto-commit.sh is a no-op if the vault is not a git repo or there are no changes.
bash "$KB_DIR/scripts/auto-commit.sh" >> "$LOG_FILE" 2>&1
COMMIT_EXIT=$?
echo "=== auto-commit exit code: $COMMIT_EXIT ===" >> "$LOG_FILE"

# Sense stage: record the run outcome and escalate on repeated failure.
# Both the improve loop and the commit must succeed for the night to count as
# healthy — a green improve with a broken commit is exactly the half-working
# state that hid the July 2026 outage for two weeks.
HEALTH_DETAIL=""
RUN_EXIT=0
if [[ $IMPROVE_EXIT -ne 0 ]]; then
  RUN_EXIT=$IMPROVE_EXIT
  HEALTH_DETAIL="neuron improve exited $IMPROVE_EXIT"
elif [[ $COMMIT_EXIT -ne 0 ]]; then
  RUN_EXIT=$COMMIT_EXIT
  HEALTH_DETAIL="auto-commit exited $COMMIT_EXIT"
fi
bash "$KB_DIR/scripts/neuron-health.sh" "$RUN_EXIT" "$HEALTH_DETAIL" >> "$LOG_FILE" 2>&1 || true

echo "=== neuron-nightly end $(date '+%Y-%m-%d %H:%M:%S %Z') ===" >> "$LOG_FILE"

exit $IMPROVE_EXIT
