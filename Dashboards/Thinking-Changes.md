---
classification: PRIVATE
type: dashboard
---

# How My Thinking Changed

Track decisions, assumption challenges, and evolving understanding.

## Recent Decisions

```dataview
TABLE date, file.folder AS "Scope"
FROM "memory" OR "wiki/sessions"
WHERE contains(file.name, "decision") OR type = "session-extract"
SORT file.mtime DESC
LIMIT 15
```

## Proactive Insights History

```dataview
TABLE generated, tags
FROM "wiki/queries"
WHERE type = "proactive-insights"
SORT generated DESC
```

## Session Learnings

```dataview
TABLE extracted, tags
FROM "wiki/sessions"
SORT extracted DESC
LIMIT 20
```

## Open Questions (from daily notes)

```dataview
LIST
FROM "Daily"
WHERE contains(file.content, "## Open Questions")
SORT file.name DESC
LIMIT 10
```

## Knowledge Gaps Identified

```dataview
LIST
FROM "wiki/queries"
WHERE contains(file.content, "Knowledge Gap") OR contains(file.content, "underexplored")
SORT file.mtime DESC
LIMIT 10
```
