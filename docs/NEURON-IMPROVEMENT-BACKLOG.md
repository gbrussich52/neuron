# Neuron Improvement Backlog — 2026-07-29 Audit

Audit trigger: the nightly improvement loop had been failing silently for roughly two weeks.
Three independent root causes, all fixed the same day. Retrieval-quality items below are informed by
[how Cerebras built their knowledge base](https://www.cerebras.ai/blog/how-we-built-our-knowledge-base).

## What broke (fixed 2026-07-29)

| # | Failure | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | `compile.sh` exited 1 every night | `set -euo pipefail` + `grep \| wc -l`: `grep` exits 1 on zero matches, which is the **steady state** once `raw/` is fully compiled | Wrapped as `{ grep … \|\| true; }` inside the command substitution |
| 2 | `lint.sh`: `claude: command not found` | The Claude Code npm→native migration moved the binary to `~/.local/bin`; the LaunchAgent's hardcoded `PATH` never included it | Added `~/.local/bin` and `/opt/homebrew/bin` to the plist `PATH`, reloaded the job |
| 3 | `auto-commit.sh` exited 1 every night; no vault commit for ~2 weeks | The "are there changes?" check counted **untracked** files, so it saw work to do while allowlist staging had staged nothing — `git commit` then failed on an empty index | Gate on the staged index only; added `wiki/lint-report.json`, `Projects/`, `Archive/` to the allowlist |
| 4 | 9 files failing `classify-check.sh` | Legacy files pre-dating the mandatory `classification:` frontmatter rule | Backfilled `classification: PRIVATE`; audit now ALL CLEAR |
| 5 | Three copies of `brain-cli/` on disk | A stale copy plus an old dated backup had accumulated inside the live vault; the executing code is this repo via `npm link` | Stale copies archived; vault keeps only its runtime state + config |

## The real lesson: no Sense stage

Every one of these failed **loudly in an exit code and silently everywhere else**. Six-plus consecutive
nights produced byte-identical logs, and a log file that looks the same when broken as when idle is
not a health signal. A loop that cannot report its own health is not autonomous — it is unattended.

Fixed by `scripts/neuron-health.sh` (new), called at the end of `scripts/neuron-nightly.sh`:

- Writes `logs/health.json` — `{ok, lastRun, lastSuccess, consecutiveFailures, lastExitCode, grade, detail}`.
- Counts the night as healthy only if **both** the improve loop and the commit succeeded. A green
  improve with a broken commit is precisely the half-working state that hid this outage.
- On `consecutiveFailures >= 2` (configurable via `NEURON_ESCALATE_AFTER`): a macOS notification plus
  a delimited warning banner in `Command-Center.md`. Escalating on the first failure would cry wolf on
  transient network/quota blips; waiting longer than the second is how a fortnight of silence happens.
- Banners are HTML-comment-delimited so repeat failures replace rather than stack, and recovery removes
  the banner cleanly. The sensor degrades quietly on write failure and never breaks the run it observes.

### Derived standards

1. **Never hardcode a tool path in a LaunchAgent without a canary.** Resolve binaries at run time, or
   fail loudly with a distinct exit code when one is missing.
2. **Guards must test the real condition** — the staged index, not "any untracked file". A guard that
   checks a proxy manufactures confidence.
3. **Assert the downstream artifact.** "Did the script run?" is not "did the commit land?"

## Prioritized backlog

**P1 — Nightly heartbeat.** ✅ Done 2026-07-29 (`neuron-health.sh`).

**P2 — Distillation on ingest.** The compile prompt writes summaries + concepts. Upgrade it to also emit
Cerebras-style structured fields per source: `searchable_question`, `resolution`, `entities`,
`key_decisions`. Same LLM call, better prompt — materially better retrieval for no extra cost.

**P3 — Hybrid retrieval, file-native.** Cerebras fuses Postgres full-text + embeddings + IDF + recency
via Reciprocal Rank Fusion. The cost-correct equivalent here: `neuron search` fusing ripgrep lexical
hits, the existing semantic index, and file-mtime recency, RRF-combined in plain JS. Lexical + recency
wins at current corpus size; defer embeddings-at-scale.

**P4 — Project scoping.** Cerebras "projects" are named bundles of sources that scope search by default.
Add `neuron search --project <name>` filtering by path/tag.

**P5 — MCP exposure.** Expose `search` / `recent` / `what-changed` as MCP tools so any agent session can
query the vault without loading the whole memory index. Do this after P3, so the tool is worth calling.

**P6 — Fix 4 failing `sync-integration` tests.** Pre-existing (they fail identically against the
pre-audit scripts, so this audit did not introduce them). All four assert that `wiki/concepts/*.md`
lands in the commit inside the test's temp-vault fixture, and it does not. **Not a live data-loss bug** —
the real vault tracks its nested wiki and raw markdown correctly, and the `git add -- 'wiki/*.md'`
pathspec was verified to cross subdirectory boundaries in isolation. Most likely a fixture/environment
gap in how the temp vault is seeded. Worth fixing because a red suite trains everyone to ignore it.

**P7 — Repo hygiene.** Track or deliberately ignore `skills/`; keep the memory index under its line
guideline; document that config resolves from the CLI's `__dirname`, not the vault.

## Explicitly rejected (for now)

- **Postgres/pgvector migration** — violates cost-first at this corpus size. Files + ripgrep + the
  existing semantic index are sufficient. Revisit past ~5k documents.
- **Slack Socket-Mode ingestion** — no Slack in this stack; a Discord capture path already exists.
