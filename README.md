# Neuron

Your LLM-powered second brain. Drop anything in — the LLM compiles, cross-links, and maintains a living knowledge wiki. Every question compounds it. Every coding session feeds it. It proactively challenges your assumptions and surfaces what you don't know.

Built on the [Karpathy pattern](https://x.com/karpathy/status/2039805659525644595), extended with ideas from [Allie Miller](https://x.com/alliekmiller/status/2040884878229565816), [Nick Spisak](https://x.com/NickSpisak_/status/2041012360668750229), [CyrilXBT](https://x.com/cyrilXBT/status/2040988306154901742), and [Michael Chomsky](https://x.com/michael_chomsky/status/2040946855148929499).

## What It Does

```
You → Inbox/         Drop anything: URLs, files, YouTube links, brain dumps
        ↓
      Neuron CLI       Auto-detects type, processes, routes to raw/
        ↓
      compile.sh      LLM compiles raw → wiki (concepts, summaries, wikilinks)
        ↓
      wiki/           Living knowledge base with typed relationships
        ↓
      insights        Proactive: challenge assumptions, find gaps, suggest connections
        ↓
      Obsidian        Browse everything with Dataview dashboards + classification badges
```

## Features

**Capture**
- **Frictionless Inbox** — drop anything into `Inbox/`, Neuron CLI auto-processes (URLs, YouTube, text, PDFs, images, brain dumps)
- **YouTube ingestion** — yt-dlp extracts transcripts automatically
- **Brain dump mode** — `neuron braindump` accepts any unstructured text, auto-classifies and files it
- **Single entry point** — `capture.sh` routes everything with one command

**Knowledge**
- **Living wiki** — LLM compiles raw sources into concept articles with `[[wikilinks]]` and backlinks
- **Typed relationships** — articles linked with `supports`, `contradicts`, `supersedes` for knowledge graph clarity
- **Incremental compilation** — only processes new/uncompiled sources (saves tokens)
- **Full-text search** — `neuron search` via ripgrep across the entire KB

**Intelligence**
- **Proactive insights** — `neuron insights` challenges assumptions, identifies knowledge gaps, finds hidden connections
- **Daily briefing** — `neuron daily` generates a morning note with what's active, open questions, and connections to explore
- **Session extraction** — Claude Code hook auto-captures learnings from every coding conversation
- **Dataview dashboards** — Knowledge Evolution, Thinking Changes, Brain Dump Tracker

**Security**
- **Classification system** — every file labeled PUBLIC/PRIVATE/CONFIDENTIAL
- **Credential scanning** — detects API keys, JWTs, tokens, passwords
- **`.gitignore` enforcement** — private/confidential files never committed
- **Obsidian CSS badges** — green/orange/red visual indicators

**Automation**
- **File watcher** — `neuron watch` monitors Inbox/ and auto-processes new files
- **Weekly crons** — consolidation (Mon), compile+lint (Wed) via LaunchAgents/cron
- **GitHub Actions CI** — classification audit on every PR

## Quick Start

```bash
git clone https://github.com/gbrussich52/neuron.git
cd neuron
chmod +x setup.sh
./setup.sh                    # Install to ~/knowledge-base/
./setup.sh /custom/path       # Or install to custom location
```

## Usage

```bash
# Capture anything
capture.sh url https://example.com ai,research       # Web article
capture.sh youtube https://youtube.com/watch?v=abc    # YouTube transcript
capture.sh file ~/Downloads/paper.pdf ml              # Local file
capture.sh thought "Rate limiting needs quotas" pap   # Quick thought
capture.sh decision "Haiku for free, Sonnet for pro"  # Decision
capture.sh gotcha "PostgREST drops schemas" pap       # Gotcha
capture.sh braindump                                  # Interactive brain dump

# Or just drop files into ~/knowledge-base/Inbox/ — Neuron CLI handles the rest

# Brain CLI
neuron watch              # Watch Inbox/ and auto-process
neuron process            # Process all pending Inbox/ files
neuron braindump          # Interactive brain dump
neuron search "query"     # Full-text search
neuron status             # KB stats and health
neuron daily              # Generate today's daily note
neuron insights           # Proactive insight generation

# Pipeline
capture.sh compile       # Compile raw → wiki
capture.sh lint          # Health checks
capture.sh audit         # Security scan
```

## Classification System

Every `.md` file must have `classification:` in its YAML frontmatter:

| Level | Meaning | Rules |
|-------|---------|-------|
| `PUBLIC` | General knowledge | Safe to share, blog, open-source |
| `PRIVATE` | Personal/project context | Local only, never publish |
| `CONFIDENTIAL` | Credentials, PII, client data | Never share, never commit |

The `.gitignore` blocks PRIVATE and CONFIDENTIAL files. `classify-check.sh` audits for missing labels and scans for leaked credentials (API keys, JWTs, Stripe keys, GitHub tokens, etc.).

## Architecture

```
~/knowledge-base/
├── Inbox/                     # Drop anything here — auto-processed
├── Daily/                     # Daily notes (Templater template)
├── Dashboards/                # Dataview dashboards
│   ├── Knowledge-Evolution    # Track KB growth over time
│   ├── Thinking-Changes       # How your thinking evolved
│   └── Brain-Dump-Tracker     # Capture history and processing stats
├── memory/                    # Working memory
│   ├── context.md             # Current focus + roadmap          [PRIVATE]
│   ├── preferences.md         # Workflow prefs                   [PUBLIC]
│   ├── projects.md            # Project facts                    [PRIVATE]
│   └── people.md              # Stakeholders                     [CONFIDENTIAL]
├── raw/                       # Processed source material
├── wiki/
│   ├── index.md               # Auto-maintained master index
│   ├── concepts/              # Compiled articles with [[wikilinks]]
│   ├── summaries/             # Per-source summaries
│   ├── queries/               # Filed Q&A + proactive insights
│   └── sessions/              # Auto-extracted session learnings  [PRIVATE]
├── Archive/                   # Processed inbox items, retired content
├── brain-cli/                 # Node.js Neuron CLI
├── scripts/                   # Shell automation
├── templates/                 # Obsidian Templater templates
└── CLAUDE.md                  # Vault rules for LLM agents
```

## Automation

| Trigger | What happens |
|---------|-------------|
| Every session end | Learnings extracted → `wiki/sessions/` |
| Monday 9am | Memory consolidation + session promotion |
| Wednesday 9am | KB compile + lint + classification audit |

### Claude Code Session Hook (optional)

Auto-extract learnings from every Claude Code conversation:

```bash
claude settings set hooks.Stop '[{"command": "~/knowledge-base/scripts/session-hook.sh"}]'
```

### Uninstall automation

```bash
./setup.sh --uninstall    # Removes LaunchAgents, keeps your data
```

## Requirements

- **Claude Code CLI** (`claude`) — the LLM engine for compilation, linting, Q&A
- **macOS** — LaunchAgents for automation
- **Linux** — cron for automation (auto-detected by installer)
- **Obsidian** (optional) — for browsing the wiki with visual classification badges
- **firecrawl-cli** (optional) — better web-to-markdown conversion for URL ingestion

## Design Principles

1. **The LLM maintains the wiki, not you** — you drop sources, it compiles
2. **Every query compounds** — Q&A results file back into the wiki
3. **No RAG needed at this scale** — Claude's context window + auto-maintained indexes handle it
4. **Security by default** — classification on every file, credential scanning, .gitignore enforcement
5. **Memory is a hint, not truth** — always verify against current state before acting on memory

## Inspiration & Credits

This project is a concrete implementation of ideas from several sources:

### Primary Inspiration

- **[Andrej Karpathy — LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595)** (Apr 2, 2026) — The core pattern: raw data → LLM-compiled wiki → Q&A + linting loop. "A large fraction of my recent token throughput is going less into manipulating code, and more into manipulating knowledge." This tweet is the blueprint this project implements.

### Architecture Influences

- **[Claude Code Memory System](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic's file-based memory architecture (MEMORY.md index + topic files) inspired the memory layer. This project extends it with classification, session extraction, and the compilation pipeline.

- **[Obsidian](https://obsidian.md/)** — The "IDE for thought" concept. Local-first, markdown-native, plugin-extensible. The knowledge base is designed as a native Obsidian vault with `[[wikilinks]]` and frontmatter-driven metadata.

### Security Pattern

- **Data Classification (NIST SP 800-60)** — The PUBLIC/PRIVATE/CONFIDENTIAL tier system is a simplified version of federal information classification. Applied here to personal knowledge management — because your notes contain API keys, project secrets, and stakeholder info whether you realize it or not.

### Related Projects & Reading

- [Simon Willison — "Building and using a personal knowledge base"](https://simonwillison.net/) — Pioneering work on LLM-augmented personal data management
- [Tiago Forte — Building a Second Brain](https://www.buildingasecondbrain.com/) — The PARA method (Projects, Areas, Resources, Archive) influenced the directory structure
- [Karpathy — follow-up on ephemeral wikis](https://x.com/karpathy/status/2039805659525644595) — "Every question to a frontier-grade LLM could spawn a team of LLMs to automate the whole thing: iteratively construct an entire ephemeral wiki, lint it, loop a few times, then write a full report."

## Quick Start Guide

See **[QUICKSTART.md](QUICKSTART.md)** for a visual reference card, command cheatsheet, and a full walkthrough example.

## Contributing

Issues and PRs welcome. Some ideas:

- **Adapters for other LLM CLIs** — Copilot, Cursor, Aider, etc.
- **Better web-to-markdown conversion** — pandoc, readability, etc.
- **Obsidian plugin** — classification badges in the file explorer, compile/lint from the command palette
- **Watch mode** — auto-compile when new files appear in `raw/`

## License

MIT
