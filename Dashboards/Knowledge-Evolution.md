---
classification: PUBLIC
type: dashboard
---

# Knowledge Evolution

Track how your knowledge base grows and evolves over time.

## Recent Captures (last 7 days)

```dataview
TABLE classification, tags, type
FROM "raw" OR "wiki/sessions"
WHERE ingested >= date(today) - dur(7 days) OR captured >= date(today) - dur(7 days) OR extracted >= date(today) - dur(7 days)
SORT file.ctime DESC
LIMIT 20
```

## Uncompiled Sources

```dataview
TABLE tags, type, ingested
FROM "raw"
WHERE compiled = false
SORT ingested DESC
```

## Knowledge by Tag

```dataview
TABLE length(rows) AS "Count"
FROM "wiki/concepts" OR "wiki/summaries"
FLATTEN tags AS tag
GROUP BY tag
SORT length(rows) DESC
```

## Compilation Timeline

```dataview
TABLE type, length(file.outlinks) AS "Links Out"
FROM "wiki/concepts"
SORT file.mtime DESC
LIMIT 15
```
