# Neuron as the Connected Nucleus — Design Spec

> Date: 2026-06-27 · Status: approved (shape) — pending written-spec review
> Owner: Giani · Author: Claude
> Repo: `~/project-claude/llm-knowledge-base` (neuron CLI) · Vault: `~/knowledge-base` (Obsidian)

## Context — why this exists

Giani wants Neuron to be the **single nucleus** for everything: every raw idea, every project's status, all of it captured in one place, automatically connected, and visible in Obsidian as a glowing graph of linked ideas. Today it doesn't feel that way — ideas feel scattered and disconnected.

Investigation (2026-06-27) showed the *feeling* is real but the *cause* is not "missing capability":

- **The engine already exists.** The `neuron` CLI already has `braindump` (capture), `connections --auto` (semantic cross-linker that writes `[[wikilinks]]` + reasons into a `## Related` section unattended), `semantic-search`/`smart-search` (embeddings), media ingest (`youtube`/`url`/`image`/`pdf`), and an armed trust gate (`validate`/`review`/`approve`, Plan 2, 116/116 tests, 21/21 adversarial vectors).
- **The loop never closed.** Capture went dormant ~2026-06-03. Nothing invokes the auto-linker on capture or on a schedule. Result: **92 notes, only 29 with any `[[link]]` — ~68% orphans.** That is precisely why the Obsidian graph shows scattered dots instead of a connected web (Obsidian renders links; it cannot invent them).
- **Split-brain.** Claude writes project state/decisions to `~/.claude/.../memory/` (the harness memory), which **never enters the vault**. The richest, most current idea-stream is routed *around* the nucleus. Global `CLAUDE.md` already declares the vault the intended home ("All memory and knowledge lives in `~/knowledge-base/`") — practice diverged from intent.
- **No project layer.** Projects aren't nodes, so there's no "where everything stands" view and nothing links ideas → the project they feed.

**Intended outcome:** one vault, capture from anywhere auto-links on the way in, project status lives in the graph as bright hubs, and Claude writes into the vault — so the graph genuinely glows and "where everything stands" is one view.

## Goals

1. **One source of truth.** The Obsidian vault (`~/knowledge-base`) is canonical. Claude writes ideas and project status there. The harness `MEMORY.md` is *generated from* the vault, not maintained separately.
2. **Capture auto-links.** Every captured idea runs through the existing `connections --auto` engine immediately, so it joins the web with zero extra human step.
3. **Project layer = command center.** Each active project is a node note (status · next action · blocker · last touched) linked to the ideas/research/handoffs feeding it; a single dashboard rolls them up.
4. **Stays connected automatically.** A scheduled pass links orphans and refreshes the dashboard, reusing existing cron/launchd infra.

## Non-goals (YAGNI)

- No new note-taking app or UI — Obsidian *is* the UI.
- No rebuild of capture/linking/trust — reuse the existing CLI (rejected Approach C).
- No photo/voice pipeline in v1 — voice capture is Phase 3, deferred.
- No multi-machine sync hardening — out of scope (Neuron Plan 3/4 backlog owns that).

## Architecture — four thin components over the existing engine

```
  ┌─────────── capture surfaces ───────────┐
  │ Discord(phone)  Terminal  Inbox-watch  │   (Phase 1 / 1 / 2)
  └───────────────────┬─────────────────────┘
                      ▼
            [1] capture path  ──►  write note to Inbox/  ──►  neuron connections --auto
                      │                                         (existing engine: links + reasons)
                      ▼
            [2] vault = source of truth  ◄── [3] project layer (nodes + Command-Center.md)
                      │
                      ▼
            generate harness MEMORY.md  (so Claude still loads context each session)
                      ▲
            [4] scheduled connect+rollup pass (cron/launchd): link orphans, refresh dashboard
```

The only genuinely new code is **glue**: the unified capture entry, the memory-migration + MEMORY.md generator, the project-node template + rollup, and the schedule wiring. Everything that does real work (semantic match, link-writing, trust gating) already exists.

## Detailed design

### Component 1 — Unified capture path
A single function `capture(text, {source})` that all surfaces call:
1. Write the raw text to `~/knowledge-base/Inbox/<timestamp>-<slug>.md` with frontmatter (`captured`, `source`, `classification: PRIVATE` default, `status: raw`).
2. Immediately run the existing `connections --auto` on that file → appends `## Related` with `[[links]]` + reasons.
3. Return a short confirmation: the title + what it linked to.

Surfaces (sequenced):
- **Phase 1 — Discord:** inbound Discord message → `capture(text, {source:'discord'})` → reply with "✓ captured → [[a]] [[b]] [[c]]". Reuses the existing Discord gateway. *(Note: per the Discord MCP, Claude can only reply to a chat that has messaged the session — so this runs inside a session where Giani has texted in, or via the agent-gateway daemon, not as an unprompted push.)*
- **Phase 1 — Terminal:** in any Claude Code session, `capture: <idea>` triggers the same path. Zero new infra.
- **Phase 2 — Obsidian Inbox watcher:** a watch (launchd/`fswatch` or `neuron watch`) on `Inbox/` runs `connections --auto` on new/changed files, so notes typed directly in Obsidian also auto-link.
- **Phase 3 — Voice:** phone memo → transcription → `capture`. Deferred.

### Component 2 — Split-brain unification
- **Migrate** the project files in `~/.claude/.../memory/` (e.g. `project_ecom_brand.md`, `project_neuron_plan2_complete.md`, etc.) into the vault as first-class linked notes under a new `Projects/` tree (project nodes), preserving frontmatter + `[[links]]`. Raw ideas continue to land in `Inbox/`→`raw/` and are *promoted* (via the trust gate) into linked notes; project status lives in `Projects/`.
- **Invert the index:** generate the harness-facing `MEMORY.md` *from* the vault (a build step: scan project/idea notes → emit the one-line index the harness loads). The vault is canonical; `MEMORY.md` becomes a derived artifact.
- **Write policy going forward:** Claude writes ideas/status into the vault; the trust gate (`validate`/`approve`) governs promotion of raw → permanent so the nucleus doesn't fill with noise.
- **Safety:** migration is additive and reversible; keep a pre-migration snapshot (vault is git; `~/.claude/memory` copied, not deleted, until verified). Respect classification frontmatter (PUBLIC/PRIVATE/CONFIDENTIAL) — CONFIDENTIAL never leaves local, never committed.

### Component 3 — Project layer (the command center)
- **Project node template:** one note per active project with frontmatter `status`, `next_action`, `blocker`, `last_touched`, `links: [[...]]` to feeding ideas/research/handoffs. Body = brief narrative + recent decisions.
- **`Command-Center.md` dashboard:** auto-generated rollup of every project node (table: project · status · next action · blocker · last touched), sorted by staleness. This is the "where everything stands" view, and because nodes are linked, projects become the **bright hubs** the idea-orbs cluster around in the graph.
- Seed from current reality (PAP, Storied & Blessed, Shankdit, LegalAIMCP, NYClaw, Water Filtration, NDR, etc.).

### Component 4 — Stay-connected schedule
- Reuse existing cron/launchd. A nightly job: run `connections --auto` over any remaining orphan notes, regenerate `Command-Center.md` and `MEMORY.md`, and surface "new idea clusters" (groups of ideas that link to each other but to no project — candidate new projects).
- Honor the existing trust chokepoint and `max_unverified_backlog` backpressure (Plan 3 config exists).

## Reuse map (don't rebuild these)
| Need | Existing command/file |
|------|----------------------|
| Capture | `brain-cli/brain.js` → `cmdBraindump` (`braindump`/`dump`) |
| Auto-link | `brain-cli/connections.js` → `findConnections(file, {auto:true})` |
| Semantic match | `brain-cli/semantic.js` (`semantic-search`/`smart-search`/`reindex`) |
| Trust gate | `validate.js` / `review.js` / `trust-cli.js` (`validate`/`review`/`approve`) |
| Media ingest | `brain.js` `youtube`/`url`/`image`/`pdf` |
| Sync/commit hook | `scripts/neuron-sync.sh` (pre-commit, armed) |

## Risks / open questions
- **MEMORY.md inversion:** the harness auto-loads `~/.claude/.../memory/MEMORY.md`. The generator must keep that path populated (index ≤ ~50 lines per existing rule) while the vault holds the real content. Verify the harness still recalls correctly after inversion.
- **Auto-link noise:** `connections --auto` appends a `## Related` block; over-linking is acceptable (cheap to prune) but the nightly pass should not re-append duplicates — needs idempotency (skip if `## Related` current).
- **Classification leakage:** migration must not move CONFIDENTIAL content anywhere committable. Reuse the existing CONFIDENTIAL tree scan in `neuron-sync.sh`.
- **Discord push limitation:** capture-reply works on inbound messages; an unprompted "I captured this" push is constrained by the reply-only transport. Daemon/agent-gateway path TBD in plan.

## Verification (how we'll know it works)
1. **Capture round-trip:** from terminal and Discord, `capture: <idea>` creates an Inbox note and the note gains a `## Related` with ≥1 valid `[[link]]`; reply confirms targets.
2. **Graph glows:** after migration + a connect pass, orphan ratio drops sharply (target: <25% from 68%); Obsidian graph shows project hubs with idea clusters.
3. **One brain:** a new project decision written by Claude lands in the vault and appears in `Command-Center.md`; regenerated `MEMORY.md` reflects it and the harness recalls it next session.
4. **Stays connected:** the nightly job runs, links new orphans, refreshes the dashboard, and is idempotent (no duplicate `## Related`).
5. **Trust intact:** raw captures stay quarantined until approved; `validate`/adversarial vectors still green.

## Phasing
- **Phase 1 (immediate value):** unified capture for Terminal + Discord (auto-link on capture) + split-brain migration + project nodes + `Command-Center.md`. This alone makes the graph glow and gives the "where everything stands" view.
- **Phase 2:** Obsidian Inbox watcher; nightly connect+rollup schedule.
- **Phase 3:** Voice capture.
