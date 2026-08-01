#!/usr/bin/env bash
# neuron-sync.sh — the AUTHORITATIVE write chokepoint (spec Component 4).
# Every vault commit/push flows through here. This script OWNS the leak
# guarantee: a pre-push TREE-STATE scan (git ls-files — not just the diff) for
# CONFIDENTIAL frontmatter + credential patterns. Also: per-machine lock
# (mkdir-based — macOS has no flock), rebase-abort recovery, allowlist staging
# (never `git add -A`), bounded push retry, REVIEW.md checkbox application.
# Exits 0 on conflicts (flagged in REVIEW.md) — never leaves a half-rebase.
set -uo pipefail

KB_DIR="${KB_DIR:-$HOME/knowledge-base}"
cd "$KB_DIR"
mkdir -p .neuron
FLAGS="$KB_DIR/.neuron/flags.jsonl"
LOCKDIR="$KB_DIR/.neuron/sync.lock"
AUTHOR="${NEURON_AUTHOR:-giani}"
NEURON_BIN="${NEURON_BIN:-neuron}"

log()  { echo "[neuron-sync] $*"; }

# flag <file> <reason> — surfaces in REVIEW.md via flags.jsonl.
# Sanitize: strip double-quotes from the file arg to keep JSON valid.
# Dedup: if an identical (file, reason) pair already exists in flags.jsonl,
# skip the append — prevents repeated scans from accumulating duplicate
# mechanical items that would churn REVIEW.md on every run (vector 13).
flag() {
  local f="${1//\"/}"
  local reason="$2"
  if [ -f "$FLAGS" ] && grep -qF "\"file\":\"$f\",\"reason\":\"$reason\"" "$FLAGS" 2>/dev/null; then
    return 0  # already flagged — idempotent
  fi
  printf '{"file":"%s","reason":"%s","ts":"%s"}\n' \
    "$f" "$reason" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$FLAGS"
}

have_neuron() { command -v "${NEURON_BIN%% *}" >/dev/null 2>&1; }

# NEURON_BIN may be "node /path/brain.js" — intentional word splitting (no spaces in path).
# shellcheck disable=SC2086
run_neuron() { KB_DIR="$KB_DIR" NEURON_AUTHOR="$AUTHOR" $NEURON_BIN "$@"; }

# ---------------------------------------------------------------------------
# Lock (portable: macOS has no flock). Stale if owner PID is dead.
# ---------------------------------------------------------------------------
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OWNER=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
  if [ -n "$OWNER" ] && kill -0 "$OWNER" 2>/dev/null; then
    log "another sync is running (pid $OWNER) — exiting."
    exit 0
  fi
  log "clearing stale lock (pid ${OWNER:-unknown})."
  rm -rf "$LOCKDIR"; mkdir "$LOCKDIR"
fi
# Trap registered the instant we own the lock dir — a kill before the pid write
# leaves an empty pid file, which the stale-lock path above self-heals.
trap 'rm -rf "$LOCKDIR"' EXIT
echo $$ > "$LOCKDIR/pid"

# ---------------------------------------------------------------------------
# Defensive: never start on a half-rebase
# ---------------------------------------------------------------------------
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  log "stale rebase state found — aborting it."
  git rebase --abort 2>/dev/null || rm -rf .git/rebase-merge .git/rebase-apply
fi

# ---------------------------------------------------------------------------
# 1. Working-tree sweep (stamps unswept writes; reconciles trust/hashes)
# ---------------------------------------------------------------------------
if have_neuron; then
  run_neuron validate --sweep --apply || log "WARN: sweep failed (continuing)"
else
  log "WARN: neuron CLI not found — sweep skipped (hook/next sweep backstops)."
fi

# ---------------------------------------------------------------------------
# 2. Apply REVIEW.md checkbox decisions + age out idle items
# ---------------------------------------------------------------------------
if have_neuron; then
  run_neuron review apply --age || log "WARN: review apply failed (continuing)"
fi

# ---------------------------------------------------------------------------
# 3. Pull (only when a remote exists; conflicts become REVIEW items)
# ---------------------------------------------------------------------------
if [ -n "$(git remote)" ]; then
  if ! git pull --rebase --no-edit 2>/dev/null; then
    git rebase --abort 2>/dev/null || true
    flag "(repo)" "pull --rebase conflict — resolve manually, then re-run neuron-sync"
    have_neuron && run_neuron review >/dev/null 2>&1
    log "rebase conflict — flagged in REVIEW.md, exiting cleanly."
    exit 0
  fi
else
  log "no remote configured — local-only sync (remote arrives in Plan 4)."
fi

# ---------------------------------------------------------------------------
# 4. Allowlist staging (never git add -A)
# Content dirs: .md only (git pathspec '*' crosses subdirectory boundaries on
# macOS — confirmed: 'wiki/*.md' stages wiki/concepts/x.md). Skills/ is code —
# all file types (it is secret-scanned in step 5).
# The auto-commit.log lives under scripts/ which is intentionally NOT staged
# here, so log churn never pollutes commits.
# ---------------------------------------------------------------------------
for d in wiki memory raw questions digests templates Research Notes Daily "UGC-Dual-Path" docs; do
  [ -d "$d" ] && git add -- "$d"'/*.md' 2>/dev/null || true
done
[ -d skills ] && git add -- skills 2>/dev/null || true
# Per-file adds: a single combined `git add` aborts ALL its pathspecs when one
# file (e.g. approvals.log before the first approval) doesn't exist yet.
for f in REVIEW.md approvals.log .gitignore CLAUDE.md README.md; do
  [ -f "$f" ] && git add -- "$f" 2>/dev/null
done || true

# ---------------------------------------------------------------------------
# 5. PRE-PUSH TREE-STATE LEAK SCAN (authoritative; spec design-spine #1)
# Scans the entire tracked tree — NOT just the diff — so files that sneak in
# over multiple commits are caught before ever reaching the remote.
# ---------------------------------------------------------------------------
scan_tree() {
  local hit=0

  # 5a. CONFIDENTIAL frontmatter anywhere in the tracked tree (current content).
  # Checks the actual file content (not the index), so a staged-then-modified file
  # is caught too. After git rm --cached the file is untracked and gitignored so
  # the next add in step 4 will skip it automatically.
  while IFS= read -r f; do
    case "$f" in *.md) ;; *) continue ;; esac
    [ -f "$f" ] || continue
    if head -30 "$f" | grep -qi '^classification:[[:space:]]*confidential'; then
      log "LEAK: $f is CONFIDENTIAL but tracked — untracking + gitignoring."
      git rm --cached --quiet -- "$f" 2>/dev/null || true
      grep -qxF "$f" .gitignore 2>/dev/null || echo "$f" >> .gitignore
      git add -- .gitignore
      flag "$f" "CONFIDENTIAL was tracked — quarantined; rotate if ever pushed"
      hit=1
    fi
  done < <(git ls-files)

  # 5b. Credential patterns over tracked skills/ (user code — all types) AND
  # any currently staged files, plus ALL tracked scripts/ (spec Component 6: a
  # helper script with a hardcoded key must not sync). The ONLY exclusion is
  # classify-check.sh itself — it defines the PATTERNS as string literals, so
  # scanning it is self-referential and a guaranteed false positive.
  # The --secrets-stdin mode uses ERE so patterns like 'sk-[a-zA-Z0-9]{20,}'
  # work correctly on macOS BSD grep.
  if [ -x scripts/classify-check.sh ]; then
    # `grep -v` exits 1 when it has no output (all lines filtered or empty input)
    # which would corrupt the pipeline exit under pipefail. Use a temp variable
    # to collect the list so we control the exit codes explicitly.
    local scan_files
    scan_files=$(
      { git ls-files -- 'skills/*' 'scripts/*' 2>/dev/null || true
        git diff --cached --name-only 2>/dev/null || true
      } | { grep -vxF 'scripts/classify-check.sh' || true; } | sort -u
    )
    if [ -n "$scan_files" ]; then
      if ! printf '%s\n' "$scan_files" \
           | KB_DIR="$KB_DIR" scripts/classify-check.sh --secrets-stdin; then
        flag "(secrets)" "credential pattern in tracked/staged files — push blocked until fixed"
        hit=1
      fi
    fi
  fi

  return $hit
}

PUSH_OK=1
if ! scan_tree; then
  # CONFIDENTIAL hits were auto-remediated (untracked) — rescan once.
  # Secret-pattern hits are NOT auto-remediated (could be prose false-positive):
  # they hold the push until a human resolves them.
  if ! scan_tree; then
    log "tree still dirty after remediation — PUSH BLOCKED (safe commit proceeds)."
    PUSH_OK=0
  fi
fi

# Regenerate REVIEW.md so any new flags are visible in this very commit.
have_neuron && run_neuron review >/dev/null 2>&1
git add -- REVIEW.md 2>/dev/null || true

# ---------------------------------------------------------------------------
# 6. Commit (LLM message via the demoted auto-commit helper)
# ---------------------------------------------------------------------------
# Refresh first: REVIEW.md is rewritten+re-added within the same second, which
# leaves a "racy" index entry; `git diff --quiet` short-circuits on the stat
# mismatch without content-checking and would gate-pass an EMPTY commit.
git update-index -q --refresh 2>/dev/null || true
if git diff --cached --quiet; then
  log "nothing to commit."
else
  if ! NEURON_NO_LLM="${NEURON_NO_LLM:-0}" GIT_AUTHOR_NAME="neuron-$AUTHOR" \
       bash scripts/auto-commit.sh --staged; then
    log "auto-commit helper failed — committing with fallback message."
    GIT_AUTHOR_NAME="neuron-$AUTHOR" git commit -m "chore: neuron sync ($(date '+%Y-%m-%d %H:%M'))"
  fi
fi

# ---------------------------------------------------------------------------
# 7. Push (bounded retry with backoff; NEVER --force)
# ---------------------------------------------------------------------------
if [ -n "$(git remote)" ]; then
  if [ "$PUSH_OK" -eq 1 ]; then
    pushed=0
    for i in 1 2 3 4 5; do
      if git push 2>/dev/null; then pushed=1; break; fi
      log "push attempt $i failed — retrying in $((i * 5))s"
      sleep $((i * 5))
      if ! git pull --rebase --no-edit 2>/dev/null; then
        git rebase --abort 2>/dev/null || true
        flag "(repo)" "push-retry rebase conflict"
        break
      fi
    done
    if [ "$pushed" -ne 1 ]; then
      flag "(repo)" "push failed after bounded retries"
      log "PUSH FAILED — flagged in REVIEW.md."
    fi
  else
    log "push withheld by leak guard (commit kept local)."
  fi
fi

log "done."
