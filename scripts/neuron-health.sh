#!/bin/bash
# neuron-health.sh — Sense stage for the nightly loop.
#
# Records the outcome of each nightly run to logs/health.json and escalates
# when the loop fails repeatedly. Exists because the loop failed silently for
# ~2 weeks in July 2026: compile.sh, lint.sh and auto-commit.sh each exited 1
# every night, wrote byte-identical logs, and nothing surfaced it. Logs are
# not a health signal — nobody reads a file that looks the same when broken
# as when idle.
#
# Usage: neuron-health.sh <exit_code> [detail]
#   exit_code : 0 = healthy run, non-zero = failed run
#   detail    : short free-text reason recorded with a failure
#
# Escalates (macOS notification + banner in Command-Center.md) once
# consecutive failures reach ESCALATE_AFTER. Escalating on the 1st failure
# would cry wolf on transient spend-limit/network blips; waiting past the 2nd
# is how a fortnight of silence happened.

set -uo pipefail

# Note: an explicitly-empty KB_DIR falls back to the default vault rather than
# operating on "/" — tests must pass a real directory, never an unset variable.
KB_DIR="${KB_DIR:-$HOME/knowledge-base}"
HEALTH_FILE="$KB_DIR/logs/health.json"
COMMAND_CENTER="$KB_DIR/Command-Center.md"
ESCALATE_AFTER="${NEURON_ESCALATE_AFTER:-2}"
BANNER_START="<!-- neuron-health-banner -->"
BANNER_END="<!-- /neuron-health-banner -->"

EXIT_CODE="${1:-1}"
DETAIL="${2:-}"
NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

mkdir -p "$KB_DIR/logs"

# Read prior state. Missing/corrupt health.json is treated as a clean slate
# rather than a hard failure — the sensor must never be the thing that breaks
# the run it is monitoring.
PREV_FAILURES=0
PREV_SUCCESS="never"
if [[ -f "$HEALTH_FILE" ]]; then
  PREV_FAILURES=$(node -e '
    try {
      const h = require(process.argv[1]);
      process.stdout.write(String(Number(h.consecutiveFailures) || 0));
    } catch { process.stdout.write("0"); }
  ' "$HEALTH_FILE" 2>/dev/null || echo 0)
  PREV_SUCCESS=$(node -e '
    try {
      const h = require(process.argv[1]);
      process.stdout.write(h.lastSuccess || "never");
    } catch { process.stdout.write("never"); }
  ' "$HEALTH_FILE" 2>/dev/null || echo "never")
fi

if [[ "$EXIT_CODE" -eq 0 ]]; then
  CONSECUTIVE=0
  LAST_SUCCESS="$NOW"
  OK=true
else
  CONSECUTIVE=$((PREV_FAILURES + 1))
  LAST_SUCCESS="$PREV_SUCCESS"
  OK=false
fi

# Lint grade from the last lint report (informational only).
#
# NOT the vault's composite grade. getGrade() in metrics.js scores the vault out
# of 100 across content volume, link density, weekly activity, compile lag and
# lint — lint contributes only 15 of those points. The two routinely disagree
# (lint C / composite A is normal and not a fault), so this field is named for
# what it actually is: reading a bare "grade: C" here as vault health is a
# mistake this comment exists to stop.
GRADE="unknown"
if [[ -f "$KB_DIR/wiki/lint-report.json" ]]; then
  GRADE=$(node -e '
    try {
      const r = require(process.argv[1]);
      process.stdout.write(r.grade || "unknown");
    } catch { process.stdout.write("unknown"); }
  ' "$KB_DIR/wiki/lint-report.json" 2>/dev/null || echo "unknown")
fi

if ! node -e '
  const [file, ok, lastRun, lastSuccess, consecutive, exitCode, grade, detail] = process.argv.slice(1);
  require("fs").writeFileSync(file, JSON.stringify({
    ok: ok === "true",
    lastRun,
    lastSuccess,
    consecutiveFailures: Number(consecutive),
    lastExitCode: Number(exitCode),
    lintGrade: grade,
    detail: detail || null,
  }, null, 2) + "\n");
' "$HEALTH_FILE" "$OK" "$NOW" "$LAST_SUCCESS" "$CONSECUTIVE" "$EXIT_CODE" "$GRADE" "$DETAIL" 2>/dev/null; then
  # One clear line, not a node stack trace: the sensor degrades quietly but
  # visibly, and never takes down the run it is only observing.
  echo "[neuron-health] WARNING: could not write $HEALTH_FILE — health state not recorded"
fi

# --- Escalation ---------------------------------------------------------
# Banner is delimited by HTML comments so it can be replaced or removed
# idempotently — repeated failures must not stack N banners in the file.
strip_banner() {
  [[ -f "$COMMAND_CENTER" ]] || return 0
  node -e '
    const fs = require("fs");
    const [file, start, end] = process.argv.slice(1);
    let s = fs.readFileSync(file, "utf8");
    const re = new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n*", "g");
    fs.writeFileSync(file, s.replace(re, ""));
  ' "$COMMAND_CENTER" "$BANNER_START" "$BANNER_END" 2>/dev/null || true
}

if [[ "$EXIT_CODE" -eq 0 ]]; then
  strip_banner
  echo "[neuron-health] OK — loop healthy at $NOW (lint grade $GRADE; not the composite vault grade)"
  exit 0
fi

echo "[neuron-health] FAIL #$CONSECUTIVE (exit $EXIT_CODE) — $DETAIL"

if [[ "$CONSECUTIVE" -ge "$ESCALATE_AFTER" ]]; then
  RUN_WORD="runs"; [[ "$CONSECUTIVE" -eq 1 ]] && RUN_WORD="run"
  MSG="Neuron nightly loop has failed $CONSECUTIVE $RUN_WORD in a row (last success: $LAST_SUCCESS). ${DETAIL:-See logs/}"

  strip_banner
  if [[ -f "$COMMAND_CENTER" ]]; then
    # Banner goes after frontmatter (if any) so Obsidian still parses it.
    node -e '
      const fs = require("fs");
      const [file, start, end, msg, ts] = process.argv.slice(1);
      const s = fs.readFileSync(file, "utf8");
      const banner = `${start}\n> [!warning] Neuron loop unhealthy (${ts})\n> ${msg}\n${end}\n\n`;
      const m = s.match(/^---\n[\s\S]*?\n---\n/);
      fs.writeFileSync(file, m ? s.slice(0, m[0].length) + "\n" + banner + s.slice(m[0].length) : banner + s);
    ' "$COMMAND_CENTER" "$BANNER_START" "$BANNER_END" "$MSG" "$NOW" 2>/dev/null || true
  fi

  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$MSG\" with title \"Neuron loop unhealthy\"" >/dev/null 2>&1 || true
  fi
fi

exit 0
