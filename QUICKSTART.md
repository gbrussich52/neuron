# Quick Reference Card

## Install (30 seconds)

```bash
git clone https://github.com/gbrussich52/neuron.git
cd neuron && chmod +x setup.sh && ./setup.sh
```

## Commands at a Glance

```
# Capture
capture.sh url <url> [tags]         Ingest a web article
capture.sh file <path> [tags]       Ingest a local file
capture.sh thought "text" [tags]    Capture an idea
capture.sh decision "text" [proj]   Log a decision
capture.sh gotcha "text" [proj]     Log a gotcha
capture.sh braindump                Interactive brain dump

# Knowledge
capture.sh query "question"         Ask the wiki
neuron smart-search "query"         Combined semantic + keyword search
neuron search "query"               Full-text keyword search

# Intelligence
neuron insights                     Challenge assumptions, find gaps
neuron research "topic"             Autonomous web research (single pass)
neuron deep-research "topic"        Karpathy auto-research loop (iterative)
neuron connections <file>           Find related articles, suggest wikilinks
neuron improve --standalone         Self-improvement loop

# Pipeline
capture.sh compile                  Build wiki from sources
capture.sh lint                     Health check + audit
capture.sh audit                    Security scan
neuron reindex                      Build semantic search index
neuron metrics                      Brain Score (A-F grade)
neuron config                       Show/change provider, models, features
```

**Project shortcuts:** `pap`, `ft`, or omit for global.

---

## Your First 24 Hours

New to Neuron? Follow this path to go from zero to a working second brain.

### Hour 0: Setup (5 minutes)

```bash
git clone https://github.com/gbrussich52/neuron.git
cd neuron && chmod +x setup.sh && ./setup.sh

# Optional: local models for zero API cost
brew install ollama && brew services start ollama
ollama pull gemma4:e2b && ollama pull nomic-embed-text
neuron config provider openai-compatible   # switch to local
```

### Hour 1: Feed it (15 minutes)

Drop 5 things into the system — mix of types:

```bash
# Brain dump something you've been thinking about
neuron braindump

# Ingest a few articles or videos you've read recently
capture.sh url https://some-article-you-liked.com research
capture.sh youtube https://youtube.com/watch?v=something learning

# Capture a thought and a decision
capture.sh thought "I think X because Y" business
capture.sh decision "Going with approach A over B because..." pap
```

### Hour 2: Compile + Explore (5 minutes)

```bash
capture.sh compile     # LLM compiles everything into wiki articles
neuron status          # See what was created
```

Open `~/knowledge-base/` in Obsidian and browse your new wiki.

### Hour 3: Search + Question (5 minutes)

```bash
# Build the semantic index
neuron reindex

# Search conceptually (not just keywords)
neuron smart-search "business opportunities"

# Ask a question — the answer gets filed back into the wiki
capture.sh query "What are the key tradeoffs in my current projects?"
```

### Hour 6: Let it think for you (5 minutes)

```bash
neuron insights        # Challenge your assumptions, find knowledge gaps
neuron daily           # Morning briefing based on your current context
neuron metrics         # See your Brain Score
```

### Hour 12: Autonomous research (set and forget)

```bash
# Single-pass research on a topic
export TAVILY_API_KEY=tvly-...   # get a key at tavily.com (free tier available)
neuron research "your topic here"

# Or go deep — iterative loop that researches its own gaps
neuron deep-research "your topic" --max-iterations 3
```

### Hour 24: Self-improvement

```bash
# Let Neuron improve itself — compile, lint, research gaps, repeat
neuron improve --standalone --max-iterations 2
neuron metrics --history   # See the score trend
```

### From then on

Just keep dropping things in. The system handles the rest:
- **Monday 9am:** Memory consolidation
- **Wednesday 9am:** Auto-compile + lint
- **Every session end:** Auto-extract learnings (if hook is configured)
- **You:** Drop sources, ask questions, run research. Everything compounds.

---

## Example: Building a Knowledge Base from Scratch

Here's a real-world walkthrough — say you're researching **AI agent architectures** for a new project.

### Step 1: Ingest sources (2 minutes)

```bash
# Grab key articles
capture.sh url https://lilianweng.github.io/posts/2023-06-23-agent/ ai,agents
capture.sh url https://www.anthropic.com/research/building-effective-agents ai,agents,anthropic
capture.sh url https://arxiv.org/abs/2308.08155 ai,agents,survey

# Add a local paper you downloaded
capture.sh file ~/Downloads/react-agent-paper.pdf ai,agents

# Capture your own thinking
capture.sh thought "ReAct pattern seems best for tool-use agents, but plan-and-execute might be better for long-horizon tasks" ai,agents
```

### Step 2: Compile (1 command)

```bash
capture.sh compile
```

The LLM reads all 5 sources, creates:
- `wiki/summaries/` — one summary per source with key takeaways
- `wiki/concepts/` — cross-linked articles like `agent-architectures.md`, `react-pattern.md`, `tool-use.md`
- `wiki/index.md` — updated master index with everything linked

### Step 3: Ask questions (compounds over time)

```bash
capture.sh query "What are the tradeoffs between ReAct and Plan-and-Execute agent patterns?"
```

The answer gets **filed back** into `wiki/queries/`. Next time you query about agents, this prior answer is part of the knowledge base.

### Step 4: Let it maintain itself

```bash
capture.sh lint
```

The linter finds:
- Broken `[[wikilinks]]` between articles
- Concepts mentioned but not yet article-ized
- Contradictions between sources
- Suggests 3 new articles to explore

### Step 5: Check security

```bash
capture.sh audit

# Output:
# === Classification Audit ===
# Checking for missing classifications...
# Scanning for potential secrets...
# Checking CONFIDENTIAL files are git-ignored...
# === Results ===
# ALL CLEAR: Every file is classified, no credentials detected.
```

---

## The Compounding Loop

```
  You work / browse / think
    ↓
  Drop anything into Inbox/ or use capture.sh
    ↓
  Neuron CLI processes → routes to raw/
    ↓
  compile.sh → wiki articles with [[wikilinks]]
    ↓
  connections.js → auto cross-links related articles
    ↓
  Session ends → auto-extract learnings
    ↓
  Monday → consolidation promotes best bits to memory
    ↓
  Wednesday → compile + lint + reindex
    ↓
  You query → answer filed back → wiki gets richer
    ↓
  neuron improve → researches its own gaps → recompiles
    ↓
  metrics → Brain Score tracks if you're getting smarter
    ↓
  Repeat. Every cycle makes the next one better.
```

---

## Classification Quick Reference

| Label | Color | Meaning | Can I share it? |
|-------|-------|---------|----------------|
| `PUBLIC` | Green | General knowledge | Yes — blog, tweet, open-source |
| `PRIVATE` | Orange | Personal context | No — local only |
| `CONFIDENTIAL` | Red | Credentials, PII | Never — not even screenshots |

Every `.md` file needs this in its frontmatter:
```yaml
---
classification: PUBLIC
---
```

---

## Directory Map

```
~/knowledge-base/
├── Inbox/           ← Drop anything here — auto-processed
├── Brain-Index/     ← Semantic search embeddings (auto-generated)
├── Dashboards/      ← Brain Score + Knowledge Evolution (Obsidian)
├── memory/          ← What the LLM "remembers" about you
├── raw/             ← Processed source material
├── wiki/
│   ├── concepts/    ← Compiled knowledge articles
│   ├── summaries/   ← Per-source summaries
│   ├── queries/     ← Your Q&A + research reports (compounds!)
│   └── sessions/    ← Auto-extracted session learnings
├── brain-cli/       ← Neuron CLI + provider abstraction
└── scripts/         ← Shell automation
```

Open in **Obsidian** for the best experience: `File → Open Vault → ~/knowledge-base/`
