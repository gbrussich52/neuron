---
classification: PRIVATE
type: dashboard
---

# Brain Dump Tracker

Everything captured via braindump, Inbox drops, and quick thoughts.

## Pending Processing (Inbox)

```dataview
TABLE file.ctime AS "Dropped", file.size AS "Size"
FROM "Inbox"
SORT file.ctime DESC
```

## Recently Archived (processed)

```dataview
TABLE file.mtime AS "Processed"
FROM "Archive"
SORT file.mtime DESC
LIMIT 20
```

## All Thoughts & Brain Dumps

```dataview
TABLE tags, ingested, type
FROM "raw" OR "wiki/sessions"
WHERE type = "note" OR contains(file.name, "braindump") OR type = "thought"
SORT ingested DESC
LIMIT 30
```

## Processing Stats

- Total in Inbox: `$= dv.pages('"Inbox"').length`
- Total in Archive: `$= dv.pages('"Archive"').length`
- Total in Raw: `$= dv.pages('"raw"').length`
- Uncompiled: `$= dv.pages('"raw"').where(p => p.compiled === false).length`
