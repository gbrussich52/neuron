# Neuron — Vault Rules

This is the knowledge base vault. All LLM agents (compile, lint, consolidate, insights, daily) must follow these rules.

## Vault Structure

```
Inbox/           — Drop anything here. Auto-processed by brain CLI.
Daily/           — Daily notes (Templater template, one per day)
Dashboards/      — Dataview dashboards (read-only, auto-rendered)
memory/          — Working memory (context, preferences, projects, people)
raw/             — Processed source material (from Inbox or ingest)
wiki/
  concepts/      — Compiled knowledge articles
  summaries/     — Per-source summaries
  queries/       — Filed Q&A and proactive insights
  sessions/      — Auto-extracted session learnings
Archive/         — Processed Inbox items and retired content
brain-cli/       — Node.js brain CLI (do not modify via LLM)
scripts/         — Shell automation scripts
templates/       — Obsidian Templater templates
```

## Classification (mandatory)

Every `.md` file MUST have `classification:` in its YAML frontmatter:
- **PUBLIC** — general knowledge, safe to share
- **PRIVATE** — personal context, never publish
- **CONFIDENTIAL** — credentials, PII, never share

Default: PRIVATE. When creating new files, always add classification.

## Content Processing Rules

### When compiling raw → wiki:
1. Read all sources with `compiled: false`
2. For each source, create a summary in `wiki/summaries/`
3. Extract concepts → create or UPDATE articles in `wiki/concepts/`
4. Use `[[wikilinks]]` for cross-references (Obsidian-compatible)
5. Mark processed sources as `compiled: true`
6. Update `wiki/index.md` with new entries

### Dynamic Topic Handling
- If a concept is mentioned 3+ times across sources, it deserves its own article
- If an article grows past 1500 words, split into sub-articles
- If two concepts merge, create a redirect note and consolidate

### Typed Relationships (use in article frontmatter)
```yaml
relationships:
  - type: supports
    target: "[[Other Article]]"
    note: "Provides evidence for X claim"
  - type: contradicts
    target: "[[Another Article]]"
    note: "Disagrees on Y — sources conflict"
  - type: supersedes
    target: "[[Old Article]]"
    note: "More recent data replaces this"
```

When contradictions are found:
1. Do NOT silently resolve — flag them explicitly
2. Add `contradicts` relationship to both articles
3. Note which source is more recent/authoritative
4. Add to the lint report for human review

## Brain Dump Processing

When processing Inbox/ items:
1. Detect content type (URL, YouTube, text, image, PDF, data)
2. Route to appropriate processor
3. Always add frontmatter with classification, timestamp, tags
4. Move original to Archive/ after processing
5. Tag with `[inbox]` so dashboards can track origin

## Proactive Insight Rules

When generating insights (`brain insights`):
1. **Challenge Assumptions** — find 2-3 beliefs in the KB, present counter-arguments
2. **Knowledge Gaps** — identify underexplored topics with suggested sources
3. **Hidden Connections** — find non-obvious links between concepts
4. **Learning Path** — suggest what to learn based on active projects

Always be specific. Reference actual articles. Generic advice is useless.

## Memory Rules

- Memory is a hint, not truth — verify against code/files before asserting
- Never store code-derivable facts (git log, npm test, file reads)
- If memory contradicts reality → trust reality, update memory
- Keep MEMORY.md under 50 lines (pointers only)

## General Rules

- Never create files without frontmatter
- Never delete content without archiving first
- Use ISO 8601 dates everywhere (YYYY-MM-DD)
- Keep articles focused — one concept per file
- Summaries: 200-500 words. Concept articles: 300-1000 words.
- When in doubt about classification, default to PRIVATE
