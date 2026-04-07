# Neuron

Your LLM-powered second brain. Drop anything in — the LLM compiles, cross-links, and maintains a living knowledge wiki. Every question compounds it. Every coding session feeds it. It proactively challenges your assumptions and surfaces what you don't know. It can autonomously research topics, self-improve, and run fully local with no API costs.

Built on the [Karpathy pattern](https://x.com/karpathy/status/2039805659525644595), extended with ideas from [Allie Miller](https://x.com/alliekmiller/status/2040884878229565816), [Nick Spisak](https://x.com/NickSpisak_/status/2041012360668750229), [CyrilXBT](https://x.com/cyrilXBT/status/2040988306154901742), and [Michael Chomsky](https://x.com/michael_chomsky/status/2040946855148929499). Autonomous research loop inspired by [Geoffrey Huntley's Ralph technique](https://ghuntley.com/ralph/).

## What It Does

```
You → Inbox/              Drop anything: URLs, files, YouTube links, brain dumps
        ↓
      Neuron CLI           Auto-detects type, processes, routes to raw/
        ↓
      compile.sh           LLM compiles raw → wiki (concepts, summaries, wikilinks)
        ↓
      wiki/                Living knowledge base with typed relationships
        ↓
      connections.js       Semantic search finds related articles, suggests wikilinks
        ↓
      insights / research  Proactive insights, autonomous web research, gap detection
        ↓
      deep-research        Karpathy auto-research loop: research → compile → find gaps → repeat
        ↓
      improve              Self-improvement loop: compile → lint → research → recompile
        ↓
      metrics              Brain Score (A-F) tracks if the system is making you smarter
        ↓
      Obsidian             Browse everything with Dataview dashboards + classification badges
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
- **Semantic search** — `neuron semantic-search` finds conceptual matches via embeddings (Ollama + nomic-embed-text)
- **Connection finder** — `neuron connections` uses semantic search + LLM to suggest wikilinks and gap questions

**Intelligence**
- **Proactive insights** — `neuron insights` challenges assumptions, identifies knowledge gaps, finds hidden connections
- **Daily briefing** — `neuron daily` generates a morning note with what's active, open questions, and connections to explore
- **Session extraction** — Claude Code hook auto-captures learnings from every coding conversation
- **Autonomous research** — `neuron research "topic"` decomposes a topic, searches the web via Tavily, ingests results, compiles into wiki
- **Karpathy deep research** — `neuron deep-research "topic"` iteratively researches, compiles, finds gaps, researches gaps, recompiles until thorough
- **Self-improvement loop** — `neuron improve` runs compile→lint→research gaps→recompile until Brain Score reaches target grade
- **Brain Score** — `neuron metrics` computes a composite A-F grade: content volume, link density, weekly activity, compilation lag, lint health
- **Dataview dashboards** — Knowledge Evolution, Thinking Changes, Brain Dump Tracker, Brain Score

**Model Agnostic**
- **Provider abstraction** — `providers.js` routes LLM calls through Claude CLI, Anthropic API, or any OpenAI-compatible endpoint (Ollama, Grok, LM Studio)
- **Tier-based routing** — classify (cheapest), compile (mid), synthesize (best), embed (embedding model) — each tier maps to a different model
- **Run fully local** — switch to Ollama + Gemma 4 in `neuron.config.json` for zero API cost operation
- **Zero-change default** — defaults to `claude-cli`, existing behavior preserved byte-for-byte

**Security**
- **Classification system** — every file labeled PUBLIC/PRIVATE/CONFIDENTIAL
- **Credential scanning** — detects API keys, JWTs, tokens, passwords
- **`.gitignore` enforcement** — private/confidential files never committed
- **Obsidian CSS badges** — green/orange/red visual indicators

**Automation**
- **File watcher** — `neuron watch` monitors Inbox/ and auto-processes new files
- **Weekly crons** — consolidation (Mon), compile+lint (Wed) via LaunchAgents/cron
- **GitHub Actions CI** — classification audit on every PR
- **Smart git auto-commit** — `auto-commit.sh` generates LLM-powered commit messages
- **Cross-device sync** — `sync.sh` with git-crypt encryption for PRIVATE/CONFIDENTIAL files
- **Ralph Loop integration** — `neuron improve` and `neuron deep-research --ralph` integrate with the [Ralph Loop](https://ghuntley.com/ralph/) for iterative Claude Code sessions

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

# Core
neuron watch              # Watch Inbox/ and auto-process
neuron process            # Process all pending Inbox/ files
neuron braindump          # Interactive brain dump
neuron status             # KB stats and health
neuron daily              # Generate today's daily note

# Search
neuron search "query"             # Full-text search (ripgrep)
neuron smart-search "query"       # Combined semantic + keyword (best results)
neuron semantic-search "query"    # Pure semantic/vector search
neuron reindex                    # Build or update semantic search index

# Intelligence
neuron insights                   # Proactive insight generation
neuron connections <file>         # Find related articles, suggest wikilinks
neuron metrics                    # Show Brain Score (A-F grade)
neuron metrics --history          # Show score trends over time
neuron research "topic"           # Autonomous web research (single pass)
neuron deep-research "topic"      # Karpathy auto-research loop (iterative)
neuron improve --standalone       # Self-improvement loop (compile→lint→research→repeat)

# Config
neuron config                     # Show current provider, models, features
neuron config provider openai-compatible  # Switch to local Ollama
neuron config feature semantic_search on  # Toggle features
neuron config model compile gemma4:e4b    # Set tier model

# Pipeline
capture.sh compile       # Compile raw → wiki
capture.sh lint          # Health checks
capture.sh audit         # Security scan

# Sync
scripts/sync.sh init     # Initialize git + git-crypt
scripts/sync.sh push     # Commit and push to remote
scripts/sync.sh pull     # Pull latest from remote
```

### Research Hierarchy

| Command | Scope | Iterations | Exit Condition |
|---------|-------|------------|----------------|
| `neuron research "topic"` | Single topic, single pass | 1 | Done after one cycle |
| `neuron deep-research "topic"` | Single topic, iterative | 1-5 | No gaps remain in topic |
| `neuron improve` | Entire KB | 1-5 | Brain Score >= target grade |

### Switch to Local Models (Zero API Cost)

```bash
# Install Ollama + models
brew install ollama && brew services start ollama
ollama pull gemma4:e2b              # Classify tier (fast, tiny)
ollama pull gemma4:e4b              # Compile + synthesize tier
ollama pull nomic-embed-text        # Embedding model for semantic search

# Switch neuron to local — edit neuron.config.json:
#   "provider": "openai-compatible"
# That's it. All LLM calls now route through Ollama.
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
│   ├── Brain-Dump-Tracker     # Capture history and processing stats
│   └── Brain-Score            # Thinking quality score + trends
├── Brain-Index/               # Semantic search index (auto-generated)
│   ├── embeddings.json        # File-backed vector embeddings
│   └── metrics.json           # Weekly Brain Score snapshots
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
│   ├── queries/               # Filed Q&A, research reports, gap questions
│   └── sessions/              # Auto-extracted session learnings  [PRIVATE]
├── Notes/                     # Unstructured brain dumps (swept to Inbox nightly)
├── Archive/                   # Processed inbox items, retired content
├── brain-cli/                 # Node.js Neuron CLI
│   ├── brain.js               # Main CLI (16 commands)
│   ├── providers.js           # LLM provider abstraction (Claude/Anthropic/Ollama)
│   ├── llm-run.js             # Shell bridge for bash scripts → providers
│   ├── neuron.config.json     # Provider routing, feature flags, research config
│   ├── semantic.js            # File-backed vector search + incremental indexing
│   ├── connections.js         # Cross-linker + gap detector
│   ├── metrics.js             # Brain Score (A-F grade) + weekly snapshots
│   ├── research.js            # Autonomous web research + Karpathy deep research
│   └── improve.js             # Self-improvement loop (Ralph Loop + standalone)
├── scripts/                   # Shell automation
│   ├── capture.sh             # Universal entry point (18 subcommands)
│   ├── compile.sh             # raw → wiki compilation
│   ├── lint.sh                # Wiki health checks
│   ├── query.sh               # Q&A against wiki
│   ├── ingest.sh              # URL/file ingestion (firecrawl preferred)
│   ├── session-extract.sh     # Claude Code session → learnings
│   ├── consolidate.sh         # Memory pruning + session promotion
│   ├── classify-check.sh      # Classification + credential audit
│   ├── auto-commit.sh         # Smart git commits with LLM messages
│   ├── sync.sh                # Cross-device git + git-crypt sync
│   └── notes-sweep.sh         # Nightly sweep: Notes/ → Inbox/
├── templates/                 # Obsidian Templater templates
└── CLAUDE.md                  # Vault rules for LLM agents
```

## Automation

| Trigger | What happens |
|---------|-------------|
| Every session end | Learnings extracted → `wiki/sessions/` |
| Nightly 10pm | `Notes/` swept → `Inbox/` for processing |
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

**Required (one of):**
- **Claude Code CLI** (`claude`) — default LLM engine, zero config
- **Ollama** (`ollama`) — for local-only operation with Gemma 4, Llama, etc.
- **Anthropic API key** — for direct API access without Claude CLI

**Platform:**
- **macOS** — LaunchAgents for automation
- **Linux** — cron for automation (auto-detected by installer)

**Optional:**
- **Obsidian** — for browsing the wiki with visual classification badges and Dataview dashboards
- **firecrawl-cli** — better web-to-markdown conversion for URL ingestion
- **Tavily API key** — enables `neuron research` and `neuron deep-research` web research
- **git-crypt** — encrypts PRIVATE/CONFIDENTIAL files for safe remote sync
- **Ralph Loop plugin** — enables iterative Claude Code sessions for `neuron improve` and `neuron deep-research --ralph`

## Design Principles

1. **The LLM maintains the wiki, not you** — you drop sources, it compiles
2. **Every query compounds** — Q&A results file back into the wiki
3. **Model agnostic** — swap providers in one config line; run local or cloud
4. **Cost-optimized by design** — tier routing sends cheap tasks to cheap models, hard tasks to good models
5. **Self-improving** — the system autonomously researches its own gaps and recompiles
6. **No RAG needed at this scale** — LLM context window + auto-maintained indexes handle it; optional semantic search for conceptual queries
7. **Security by default** — classification on every file, credential scanning, .gitignore enforcement
8. **Memory is a hint, not truth** — always verify against current state before acting on memory

## Inspiration & Credits

Neuron is a concrete implementation that merges ideas from several sources. Each link below is worth reading on its own — Neuron brings them together into one system.

### The Original Blueprint

- **[Andrej Karpathy — LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595)** (Apr 2, 2026) — The core pattern: raw data → LLM-compiled wiki → Q&A + linting loop. *"A large fraction of my recent token throughput is going less into manipulating code, and more into manipulating knowledge."* Also see his [GitHub Gist](https://gist.github.com/karpathy) for implementation notes. This is the foundation everything else builds on.

### Direct Influences (the threads that shaped Neuron)

- **[Allie Miller — Claudeopedia](https://x.com/alliekmiller/status/2040884878229565816)** — Extended the Karpathy pattern with a `/wiki` skill that captures screenshots and downloads, Dataview visualization dashboards, and an assumption-questioning cron job that proactively challenges your beliefs. Neuron's `neuron insights` and Dataview dashboards come directly from this.

- **[Nick Spisak — LLM Knowledge Pipeline](https://x.com/NickSpisak_/status/2041012360668750229)** — Built a pipeline using yt-dlp for YouTube transcripts, [steipete's summarize CLI](https://github.com/steipete/summarize) for content compression, [tobi/qmd](https://github.com/tobi/qmd) for blazing-fast local markdown search, and a brain CLI that indexes YouTube archives, X exports, and AI agent JSONL logs. Neuron's YouTube ingestion, brain CLI architecture, and the file watcher concept come from this.

- **[CyrilXBT — Second Brain System](https://x.com/cyrilXBT/status/2040988306154901742)** — A complete Obsidian-based second brain with 4-folder PARA structure (Inbox/Notes/Projects/Archive), Dataview + Templater + Canvas integration, a daily note template, a CLAUDE.md vault config, and 4 Claude workflows: Morning Briefing, Idea Development, Connection Finder, and Writing Accelerator. Neuron's folder structure, daily note template, and the 4 workflow sections come directly from this.

- **[Michael Chomsky — Self-Updating KB Vision](https://x.com/michael_chomsky/status/2040946855148929499)** — A vision for auto-syncing knowledge from iMessage, email, X, and AI chats into plain observable markdown files with MCP-style access, rules-based auto-organization, and proactive life-improvement suggestions. Neuron's proactive insight generation and the philosophy of "the system should actively make you smarter" come from this.

### Architecture Influences

- **[Claude Code Memory System](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic's file-based memory architecture (MEMORY.md pointer index + topic files) inspired the memory layer. Neuron extends it with classification, session extraction, typed relationships, and the compilation pipeline.

- **[Obsidian](https://obsidian.md/)** — The "IDE for thought." Local-first, markdown-native, plugin-extensible. Neuron is designed as a native Obsidian vault with `[[wikilinks]]`, frontmatter metadata, and Dataview queries. Key plugins: [Dataview](https://github.com/blacksmithgu/obsidian-dataview), [Templater](https://github.com/SilentVoid13/Templater), and the built-in Canvas.

- **[Tiago Forte — Building a Second Brain](https://www.buildingasecondbrain.com/)** — The PARA method (Projects, Areas, Resources, Archive) influenced the directory structure. Neuron adapts it as: Inbox (capture) → raw (processed sources) → wiki (compiled knowledge) → Archive (completed material).

### Tools Referenced

| Tool | What it does | Used in Neuron |
|------|-------------|----------------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube video/audio/subtitle downloader | YouTube transcript extraction |
| [firecrawl](https://github.com/mendableai/firecrawl) | Web scraping → clean markdown | URL ingestion (preferred over curl) |
| [ripgrep (rg)](https://github.com/BurntSushi/ripgrep) | Blazing-fast regex search | `neuron search` full-text search |
| [tobi/qmd](https://github.com/tobi/qmd) | Fast local markdown search | Recommended for large KBs (not bundled) |
| [steipete/summarize](https://github.com/steipete/summarize) | CLI content summarizer | Recommended for long-form content (not bundled) |

### Security Pattern

- **Data Classification (NIST SP 800-60)** — The PUBLIC/PRIVATE/CONFIDENTIAL tier system is a simplified version of federal information classification. Applied here because your notes will inevitably contain API keys, project secrets, and stakeholder info — whether you realize it or not.

### Further Reading

- [Simon Willison — LLM-augmented personal data management](https://simonwillison.net/) — Pioneering work on using LLMs to manage personal knowledge
- [Karpathy — follow-up on ephemeral wikis](https://x.com/karpathy/status/2039805659525644595) — *"Every question to a frontier-grade LLM could spawn a team of LLMs: iteratively construct an entire ephemeral wiki, lint it, loop a few times, then write a full report."*

## Quick Start Guide

**New to Neuron?** Start here: **[QUICKSTART.md](QUICKSTART.md)**

Step-by-step guide covering install, Obsidian setup, your first content, search, research, and daily workflow. No prior experience needed.

## Contributing

Issues and PRs welcome. Some ideas:

- **Obsidian plugin** — classification badges in file explorer, "Compile Selected" from command palette, Brain Score widget
- **Additional search providers** — Brave Search, SearXNG, Perplexity as alternatives to Tavily
- **Better web-to-markdown** — pandoc, readability, Jina Reader
- **Mobile quick capture** — Shortcuts/Tasker integration for iOS/Android → Inbox/
- **MCP server** — expose neuron as an MCP tool for other AI agents
- **Fine-tuning pipeline** — Karpathy's vision: generate synthetic data from the wiki, fine-tune so the LLM "knows" the data in its weights

## License

MIT
