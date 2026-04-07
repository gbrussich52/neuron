---
classification: PRIVATE
type: dashboard
updated: 2026-04-06
---

# Brain Score Dashboard

> Run `neuron metrics` in terminal for current score. This dashboard shows trend data from weekly snapshots.

## Current Score

```dataviewjs
const metricsPath = "Brain-Index/metrics.json";
try {
  const raw = await app.vault.adapter.read(metricsPath);
  const snapshots = JSON.parse(raw);
  if (snapshots.length > 0) {
    const latest = snapshots[snapshots.length - 1];
    dv.header(3, `Grade: ${latest.grade} (${latest.score}/100)`);
    dv.table(["Metric", "Value"], [
      ["Concepts", latest.counts.concepts],
      ["Summaries", latest.counts.summaries],
      ["Queries", latest.counts.queries],
      ["Sessions", latest.counts.sessions],
      ["Wikilinks", latest.connections.totalWikilinks],
      ["Links/Article", latest.connections.linkDensity],
      ["Uncompiled", latest.counts.uncompiled],
      ["Lint Grade", latest.health.lintGrade],
    ]);
  } else {
    dv.paragraph("No snapshots yet. Run `neuron metrics` to generate.");
  }
} catch(e) {
  dv.paragraph("No metrics data found. Run `neuron reindex` and `neuron metrics` to start tracking.");
}
```

## Trend

```dataviewjs
const metricsPath = "Brain-Index/metrics.json";
try {
  const raw = await app.vault.adapter.read(metricsPath);
  const snapshots = JSON.parse(raw);
  if (snapshots.length > 1) {
    dv.table(["Date", "Grade", "Score", "Concepts", "Links", "Uncompiled"], 
      snapshots.slice(-12).map(s => [
        s.timestamp.slice(0, 10),
        s.grade,
        s.score,
        s.counts.concepts,
        s.connections.totalWikilinks,
        s.counts.uncompiled,
      ])
    );
  } else {
    dv.paragraph("Need 2+ snapshots for trend data. Snapshots are taken weekly during consolidation.");
  }
} catch(e) {
  dv.paragraph("No metrics data found.");
}
```

## How Scoring Works

| Component | Weight | Max Score |
|-----------|--------|-----------|
| Content volume (concepts + summaries) | 20% | 10+ articles = full marks |
| Link density (wikilinks per article) | 25% | 2+ links/article = full marks |
| Weekly activity (new items this week) | 20% | 3+ items = full marks |
| Compilation lag (uncompiled sources) | 20% | 0 uncompiled = full marks |
| Lint health grade | 15% | A = full marks |

**Grade scale:** A (90+) | B (75-89) | C (60-74) | D (40-59) | F (<40)
