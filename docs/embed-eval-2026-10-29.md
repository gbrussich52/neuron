---
classification: PRIVATE
date: 2026-10-29
author: Claude Opus 5.5 (session 019mrDAve4J9ypBLGsXnbhEG)
---

# Embedding model eval: nomic-embed-text vs embeddinggemma-2

**Decision:** Neuron semantic search moved to `embeddinggemma-2` with its task prompts
(`title: {title} | text: {text}` for docs, `task: search result | query: ` for queries).
A plain model swap with no prompts would have been worse, so the prompts are required.

## Method

- Corpus: every file in the live index, re-chunked with the production chunker
  (518 files, 1768 chunks).
- Queries: 150 held-out search questions, one per sampled file, written by local
  `gemma3:12b` as paraphrases (told not to copy headings). Truth = the source file.
- Scoring: rank files by best chunk cosine; Recall@1/5/10 and MRR.
- Both models through the same Ollama `/v1/embeddings` path the app uses.
- Script: session scratchpad `embed-eval/eval.mjs` (not kept in repo).

## Results (full corpus, no trust filter)

| Variant | R@1 | R@5 | R@10 | MRR | index time |
|---|---|---|---|---|---|
| nomic, raw text (old prod) | 0.513 | 0.780 | 0.860 | 0.628 | 40s |
| nomic, search_ prefixes | 0.553 | 0.813 | 0.887 | 0.667 | 35s |
| gemma2, raw text (drop-in) | 0.453 | 0.727 | 0.860 | 0.585 | 53s |
| **gemma2, prompted (new prod)** | **0.573** | **0.813** | **0.907** | **0.678** | 52s |

Per query vs old prod: drop-in 40 better / 45 worse; prompted 44 better / 31 worse.

## Production-path check (after reindex)

Same 150 queries through `searchQuiet` (trust filter on, 730 searchable chunks).
Recall is lower for both because many truth files are filtered as untrusted.

| Index | R@1 | R@5 | R@10 | MRR |
|---|---|---|---|---|
| old nomic index | 0.273 | 0.367 | 0.413 | 0.329 |
| new gemma2 index | 0.293 | 0.400 | 0.433 | 0.340 |

16 better, 13 worse.

## Read

The gain over nomic with its own prefixes is within noise. The reasons to keep
gemma2 are 8K context (nomic caps at 2K) and multimodal input for later image search.
Cost: index build is about 30% slower (about 43s full rebuild), 1.3 GB on disk vs 274 MB.

## Rollback

`ollama pull nomic-embed-text`, set `embed.model` back in `brain-cli/neuron.config.json`
and drop `doc_template` / `query_prefix`, then `node brain.js reindex`. The index stores
`embedModel`, so `incrementalUpdate` rebuilds on its own when the model changes.
