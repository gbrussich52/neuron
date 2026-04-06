# LLM Knowledge Base

A personal knowledge management system built on the [Karpathy pattern](https://x.com/karpathy/status/2039805659525644595): raw sources → LLM-compiled wiki → Q&A + linting loop. Designed for Claude Code but adaptable to any LLM CLI.

**Zero manual editing.** You drop sources in, the LLM compiles, cross-links, and maintains everything. Every question you ask compounds the knowledge base.

## What It Does

```
You → capture.sh → raw/           Sources ingested (URLs, files, thoughts)
                  → wiki/          LLM compiles into concept articles, summaries
                  → memory/        Working memory (decisions, gotchas, context)
                  → wiki/queries/  Q&A results filed back (compounds over time)
                  → wiki/sessions/ Auto-extracted learnings from coding sessions
```

## Features

- **Single entry point** — `capture.sh` routes everything: URLs, thoughts, decisions, gotchas, queries
- **Incremental compilation** — only processes new/uncompiled sources (saves tokens)
- **Auto-session extraction** — Claude Code hook captures learnings from every conversation
- **Security classification** — every file labeled PUBLIC/PRIVATE/CONFIDENTIAL with audit tooling
- **Weekly automation** — memory consolidation (Mon), compile+lint (Wed) via macOS LaunchAgents
- **Obsidian-native** — open as a vault, visual classification badges via CSS snippet
- **Credential scanning** — detects API keys, JWTs, and tokens in your knowledge base

## Quick Start

```bash
git clone https://github.com/gbrussich52/llm-knowledge-base.git
cd llm-knowledge-base
chmod +x setup.sh
./setup.sh                    # Install to ~/knowledge-base/
./setup.sh /custom/path       # Or install to custom location
```

## Usage

```bash
# Ingest sources
capture.sh url https://example.com/article ai,research
capture.sh file ~/Downloads/paper.pdf ml

# Capture thoughts and decisions
capture.sh thought "Rate limiting needs per-user quotas" backend
capture.sh decision "Using Haiku for free tier, Sonnet for pro" pap
capture.sh gotcha "PostgREST drops schemas on dashboard edit" pap

# Ask questions (results filed back into wiki)
capture.sh query "What are the tradeoffs of SSR vs ISR for this use case?"

# Pipeline
capture.sh compile              # Compile raw → wiki
capture.sh lint                 # Health checks + security audit
capture.sh audit                # Classification + credential scan
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
├── memory/                    # Claude's working memory
│   ├── context.md             # Current focus + roadmap          [PRIVATE]
│   ├── preferences.md         # Workflow prefs                    [PUBLIC]
│   ├── projects.md            # Project facts not in code        [PRIVATE]
│   └── people.md              # Stakeholders                     [CONFIDENTIAL]
├── raw/                       # Source documents
├── wiki/
│   ├── index.md               # Auto-maintained master index
│   ├── concepts/              # LLM-compiled concept articles
│   ├── summaries/             # Per-source summaries + backlinks
│   ├── queries/               # Filed Q&A results
│   └── sessions/              # Auto-extracted session learnings  [PRIVATE]
├── scripts/                   # All automation
└── .obsidian/                 # Vault config + classification CSS
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
