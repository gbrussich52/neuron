#!/bin/bash
# digest.sh — Weekly research digest, scoped to the last 7 days of wiki/ activity.
#
# Reads wiki/ (the processed, trust-laddered layer) — never raw/. The 7-day
# change set is computed from git here, in bash, rather than asked of the model:
# "which notes changed this week" is a question git answers exactly and for free,
# and handing the model the whole vault is how a digest silently becomes a
# summary of everything and stops being read.
#
# Writes digests/YYYY-MM-DD.md (week ending, ISO). Idempotent per week: an
# existing digest for the same week-ending date is overwritten, not duplicated.

set -euo pipefail

KB_DIR="$HOME/knowledge-base"
WIKI_DIR="$KB_DIR/wiki"
QUESTIONS_DIR="$KB_DIR/questions"
DIGEST_DIR="$KB_DIR/digests"
LOG_FILE="$KB_DIR/scripts/digest.log"
SINCE_DAYS="${NEURON_DIGEST_DAYS:-7}"
WEEK_ENDING="$(date '+%Y-%m-%d')"
OUT_FILE="$DIGEST_DIR/$WEEK_ENDING.md"

mkdir -p "$DIGEST_DIR"
echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting digest (last ${SINCE_DAYS}d)" >> "$LOG_FILE"

cd "$KB_DIR"

# Changed wiki notes in the window. git is the source of truth for "this week";
# mtime is not, because a sync or a checkout rewrites mtimes wholesale.
CHANGED=$({ git log --since="${SINCE_DAYS} days ago" --name-only --pretty=format: -- 'wiki/*.md' 2>/dev/null || true; } \
  | grep -v '^$' | sort -u || true)
NEW_QUESTIONS=$({ git log --since="${SINCE_DAYS} days ago" --name-only --pretty=format: --diff-filter=A -- 'questions/*.md' 2>/dev/null || true; } \
  | grep -v '^$' | grep -v 'questions/index.md' | sort -u || true)

CHANGED_COUNT=$([ -z "$CHANGED" ] && echo 0 || echo "$CHANGED" | wc -l | tr -d ' ')
QUESTION_COUNT=$([ -z "$NEW_QUESTIONS" ] && echo 0 || echo "$NEW_QUESTIONS" | wc -l | tr -d ' ')

echo "Digest window: last ${SINCE_DAYS} days — ${CHANGED_COUNT} wiki note(s), ${QUESTION_COUNT} new question(s)."

# A quiet week is a fact, not a prompt. Record it and skip the LLM call entirely
# rather than paying a model to write paragraphs about nothing having happened.
if [[ "$CHANGED_COUNT" == "0" && "$QUESTION_COUNT" == "0" ]]; then
  cat > "$OUT_FILE" <<EOF
---
classification: PRIVATE
trust: verified
author: nightly
type: digest
week_ending: $WEEK_ENDING
window_days: $SINCE_DAYS
activity: none
---

# Research Digest — week ending $WEEK_ENDING

No wiki notes changed and no questions were filed in the last ${SINCE_DAYS} days.

Nothing was ingested. If that is not what you expected, check \`raw/\` for
uncompiled sources and \`logs/health.json\` for the nightly loop's last run.
EOF
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Quiet week, wrote stub digest (no LLM call)" >> "$LOG_FILE"
  echo "Done. Quiet week — $OUT_FILE written without an LLM call."
  exit 0
fi

PROMPT_TEXT=$(cat <<PROMPT
Write ONE file: $OUT_FILE

You are generating a weekly research digest for a personal knowledge vault.

# Scope — this is the whole job
Cover ONLY these notes, which changed in the last ${SINCE_DAYS} days:
$CHANGED

New open questions filed this window:
${NEW_QUESTIONS:-(none)}

Read those files under $WIKI_DIR and $QUESTIONS_DIR. Do NOT read or summarise
anything else in the vault, and do NOT read $KB_DIR/raw — wiki/ is the processed
layer and the only trustworthy input here.

# Trust rule
Notes carry \`trust: unverified | verified | rejected\` in frontmatter. State a
claim as established ONLY if its note is \`verified\`. Anything \`unverified\` must
be worded as a lead ("draft note claims…"), never as fact. Ignore \`rejected\`.

# Required structure (keep the whole file under 500 words)
1. **Most significant findings** — 3-5 max, each linked with [[wikilinks]].
   Concrete claims, not topic labels. Skip this section if nothing qualifies.
2. **Contradictions flagged** — any \`contradicts\` relationship or conflicting
   claim seen this window, naming both sides. Say "none" if none.
3. **Open questions added** — one line each, linked. Say "none" if none.
4. **Heavy activity** — any topic that got unusually many edits, and a one-line
   read on why that matters. Omit if activity was evenly spread.

# Frontmatter (exactly this, first thing in the file)
---
classification: PRIVATE
trust: unverified
author: nightly
type: digest
week_ending: $WEEK_ENDING
window_days: $SINCE_DAYS
activity: normal
---

Be specific. "Research continued on X" is worthless — say what was actually
learned. If a section has nothing real in it, write "none" and move on rather
than padding. Use Write only. Do not print the digest. Exit after writing.
PROMPT
)

echo "$PROMPT_TEXT" | claude -p \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Glob,Grep,Write" \
  --model sonnet \
  >> "$LOG_FILE" 2>&1
DIGEST_LLM_EXIT=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') — Digest LLM exit: $DIGEST_LLM_EXIT" >> "$LOG_FILE"

# Same guard lint.sh uses: a zero exit from claude -p does not prove a file was
# written, and a digest that silently never appears is indistinguishable from a
# quiet week unless we check.
if [[ ! -f "$OUT_FILE" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: digest not written" >> "$LOG_FILE"
  echo "ERROR: $OUT_FILE was not produced. Check $LOG_FILE."
  exit 1
fi

if ! head -1 "$OUT_FILE" | grep -q '^---$'; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — ERROR: digest missing frontmatter" >> "$LOG_FILE"
  echo "ERROR: $OUT_FILE has no frontmatter — vault rules require it."
  exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') — Digest complete" >> "$LOG_FILE"
echo "Done. $OUT_FILE written."
