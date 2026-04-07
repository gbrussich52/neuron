# Getting Started with Neuron

A step-by-step guide to set up your second brain. No prior experience needed.

---

## Part 1: Install (5 minutes)

### 1. Clone and run setup

Open your terminal and paste:

```bash
git clone https://github.com/gbrussich52/neuron.git
cd neuron
chmod +x setup.sh
./setup.sh
```

This creates `~/knowledge-base/` with everything you need.

### 2. Choose your LLM engine (pick one)

| Option | Cost | Speed | Setup |
|--------|------|-------|-------|
| **Claude Code CLI** (recommended) | Pay per use | Fast | Already installed if you use Claude Code |
| **Ollama + Gemma 4** (local) | Free forever | Moderate | See below |
| **Anthropic API key** | Pay per use | Fast | Set `ANTHROPIC_API_KEY` env var |

**To set up local models (free, runs on your Mac):**

```bash
brew install ollama
brew services start ollama
ollama pull gemma4:e2b           # Small model for quick tasks
ollama pull gemma4:e4b           # Larger model for deep thinking
ollama pull nomic-embed-text     # For semantic search

# Tell Neuron to use local models:
cd ~/knowledge-base/brain-cli
node brain.js config provider openai-compatible
```

---

## Part 2: Set Up Obsidian (2 minutes)

Obsidian is how you browse and interact with your knowledge base visually. Neuron writes the files, Obsidian displays them.

### 1. Open the vault

1. Open **Obsidian**
2. Click the **vault icon** (bottom-left corner)
3. Click **"Open folder as vault"**
4. Navigate to your home folder and select **`knowledge-base`**

You should see folders like `wiki/`, `Dashboards/`, `Notes/`, `memory/` in the left sidebar.

### 2. Install required plugins

1. Click the **gear icon** (bottom-left) to open Settings
2. Go to **Community plugins**
3. Click **"Turn on community plugins"** (if prompted)
4. Click **Browse** and search for:
   - **Dataview** — install and enable (powers the dashboards)
   - **Templater** — install and enable (powers daily notes)
5. Close Settings

### 3. Enable the classification badges

These color-code your files: green = PUBLIC, orange = PRIVATE, red = CONFIDENTIAL.

1. Settings → **Appearance**
2. Scroll to the bottom → **CSS snippets**
3. Click the **refresh icon** (circular arrow) if you don't see anything
4. Toggle **classification-badges** ON

### 4. See your knowledge graph

Press **Cmd+G** (Mac) or **Ctrl+G** (Windows/Linux). This shows all your articles as connected nodes. The more you add, the richer this gets.

---

## Part 3: Add Your First Content (10 minutes)

You have **three ways** to add content. Use whichever feels natural:

### Way 1: Write in Obsidian (easiest)

1. In Obsidian, open the **`Notes/`** folder in the sidebar
2. Create a new note (Cmd+N)
3. **Just write.** No special format needed. Brain dumps, ideas, links, whatever.
4. Every night at 10pm, Neuron automatically sweeps `Notes/` into the processing pipeline

This is the "zero friction" path. Write like you're texting yourself.

### Way 2: Use the terminal

```bash
# Brain dump — type freely, press Ctrl+D when done
neuron braindump

# Quick thought
capture.sh thought "I think we should price the starter tier at $29/mo" business

# Save a web article
capture.sh url https://interesting-article.com/thing ai,research

# Save a YouTube video (auto-extracts transcript)
capture.sh youtube https://youtube.com/watch?v=abc123 learning
```

### Way 3: Tell Claude

In any Claude Code session, just say:

> "Add this to neuron: I realized that PFAS filtration has a 40% margin opportunity in Westchester because no local competitor offers whole-house RO systems."

Claude will file it with proper tags, classification, and wikilinks.

---

## Part 4: Compile Your Wiki (1 minute)

Once you've added a few things, compile them into structured wiki articles:

```bash
capture.sh compile
```

**What happens:** The LLM reads all your raw inputs, creates organized articles in `wiki/concepts/`, generates summaries, adds `[[wikilinks]]` between related topics, and updates the master index.

Open Obsidian and browse `wiki/concepts/` to see your new articles. Click any `[[wikilink]]` to jump between them.

---

## Part 5: Explore and Search (5 minutes)

### Search your knowledge

```bash
# Keyword search (fast, exact matches)
neuron search "water filtration"

# Smart search (finds conceptual matches, not just keywords)
neuron reindex                              # Build the search index (first time only)
neuron smart-search "business opportunities"  # Finds related articles even without exact words
```

### Ask questions

```bash
capture.sh query "What are the tradeoffs in my current business ideas?"
```

The answer gets saved to `wiki/queries/` — so it becomes part of your knowledge base. Every question makes the system smarter.

### Get insights

```bash
neuron insights     # Challenges your assumptions, finds knowledge gaps
neuron daily        # Morning briefing: what's active, open questions, connections
```

---

## Part 6: Let It Research for You (optional)

Neuron can autonomously research topics on the web and compile the results into your wiki.

**Requires a free Tavily API key** — get one at [tavily.com](https://tavily.com).

```bash
export TAVILY_API_KEY=tvly-your-key-here

# Quick research (single pass, ~30 seconds)
neuron research "PFAS water filtration regulations 2026"

# Deep research (iterative — researches, finds gaps, researches gaps, repeats)
neuron deep-research "PFAS remediation technologies" --max-iterations 3
```

---

## Part 7: Track Your Progress

### Brain Score

```bash
neuron metrics              # Current score (A through F)
neuron metrics --history    # Score trend over time
```

In Obsidian, open **`Dashboards/Brain-Score.md`** for a visual dashboard.

### Self-improvement

```bash
# Let Neuron improve itself: compile → lint → research gaps → repeat
neuron improve --standalone --max-iterations 2
```

---

## Daily Workflow (Once Set Up)

Here's what a typical day looks like:

| When | What | How |
|------|------|-----|
| **Morning** | Check daily briefing | `neuron daily` or open `Daily/` in Obsidian |
| **Throughout the day** | Capture ideas | Write in `Notes/` in Obsidian, or `capture.sh thought "..."` |
| **When you find something interesting** | Save it | `capture.sh url <link>` or paste into `Notes/` |
| **When curious** | Ask or research | `capture.sh query "..."` or `neuron research "..."` |
| **10:00 PM (automatic)** | Notes swept | `Notes/` → `Inbox/` for processing |
| **Monday 9am (automatic)** | Memory consolidation | Prunes, merges, promotes session learnings |
| **Wednesday 9am (automatic)** | Wiki compile + lint | New sources compiled, health check run |

You don't have to do anything for the automated parts. They just run.

---

## Command Cheatsheet

### Capture (put things in)

```
capture.sh url <url> [tags]         Save a web article
capture.sh youtube <url> [tags]     Save a YouTube video (auto-transcript)
capture.sh file <path> [tags]       Save a local file
capture.sh thought "text" [tags]    Quick thought capture
capture.sh decision "text" [proj]   Log a decision (with project tag)
capture.sh gotcha "text" [proj]     Log a gotcha/trap
neuron braindump                    Interactive brain dump (type freely)
```

Or just create a note in `Notes/` in Obsidian. No commands needed.

### Search and ask (get things out)

```
neuron search "query"               Keyword search
neuron smart-search "query"         Smart search (semantic + keyword)
capture.sh query "question"         Ask a question (answer saved to wiki)
```

### Intelligence (let it think)

```
neuron insights                     Challenge assumptions, find gaps
neuron daily                        Morning briefing
neuron research "topic"             Web research (single pass)
neuron deep-research "topic"        Deep research (iterative loop)
neuron connections <file>           Find related articles
neuron improve --standalone         Self-improvement loop
```

### System

```
neuron status                       KB health and stats
neuron metrics                      Brain Score (A-F grade)
neuron config                       Show provider, models, features
neuron config provider <name>       Switch LLM provider
neuron reindex                      Rebuild semantic search index
capture.sh compile                  Compile raw sources → wiki
capture.sh lint                     Wiki health check
capture.sh audit                    Security scan
```

---

## Folder Guide

When you open the vault in Obsidian, here's what each folder is for:

```
Notes/          Write anything here. No rules. Swept to Inbox nightly.
Inbox/          Drop files here for processing. Or use capture.sh.
Daily/          Daily briefing notes (generated by neuron daily).
Dashboards/     Visual dashboards — Brain Score, Knowledge Evolution.
wiki/
  concepts/     Your compiled knowledge articles. The core of your brain.
  summaries/    One summary per source you've ingested.
  queries/      Answers to your questions + research reports.
  sessions/     Learnings auto-extracted from Claude Code sessions.
memory/         Working context — what the LLM "remembers" about you.
raw/            Processed source material (before compilation).
Brain-Index/    Semantic search data (auto-generated, don't edit).
Archive/        Old processed items (historical record).
```

---

## Classification Quick Reference

Every file has a security label. This is enforced automatically.

| Label | Color in Obsidian | Meaning | Can I share it? |
|-------|-------------------|---------|-----------------|
| `PUBLIC` | Green | General knowledge | Yes — blog, tweet, open-source |
| `PRIVATE` | Orange | Personal context | No — stays on your machine |
| `CONFIDENTIAL` | Red | Passwords, PII, secrets | Never — not even screenshots |

When you write in `Notes/`, don't worry about this. Neuron adds classification automatically when it processes your notes (defaults to PRIVATE).

---

## Troubleshooting

**"No semantic index found"** — Run `neuron reindex` first. This builds the search index.

**Dashboards show code instead of tables** — Install the **Dataview** plugin in Obsidian (see Part 2 above).

**"Claude Code CLI not found"** — Either install Claude Code, or switch to local models with `neuron config provider openai-compatible`.

**Nothing in `wiki/concepts/`** — Run `capture.sh compile` to compile your raw sources into wiki articles.

**Brain Score is low** — Run `neuron improve --standalone --max-iterations 2` to compile, lint, and research gaps automatically.

---

*See [README.md](README.md) for the full feature list, architecture details, and contributing guide.*
