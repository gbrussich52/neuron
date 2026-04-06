# Quick Reference Card

## Install (30 seconds)

```bash
git clone https://github.com/gbrussich52/llm-knowledge-base.git
cd llm-knowledge-base && chmod +x setup.sh && ./setup.sh
```

## Commands at a Glance

```
capture.sh url <url> [tags]         Ingest a web article
capture.sh file <path> [tags]       Ingest a local file
capture.sh thought "text" [tags]    Capture an idea
capture.sh decision "text" [proj]   Log a decision
capture.sh gotcha "text" [proj]     Log a gotcha
capture.sh query "question"         Ask the wiki
capture.sh compile                  Build wiki from sources
capture.sh lint                     Health check + audit
capture.sh audit                    Security scan
```

**Project shortcuts:** `pap`, `ft`, or omit for global.

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
  You work
    ↓
  Session ends → auto-extract learnings
    ↓
  Monday → consolidation promotes best bits to memory
    ↓
  Wednesday → compile new sources + lint the wiki
    ↓
  You query → answer filed back → wiki gets richer
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
├── memory/          ← What the LLM "remembers" about you
├── raw/             ← Drop sources here (or use capture.sh)
├── wiki/
│   ├── concepts/    ← Compiled knowledge articles
│   ├── summaries/   ← Per-source summaries
│   ├── queries/     ← Your Q&A history (compounds!)
│   └── sessions/    ← Auto-extracted session learnings
└── scripts/         ← All the automation
```

Open in **Obsidian** for the best experience: `File → Open Vault → ~/knowledge-base/`
