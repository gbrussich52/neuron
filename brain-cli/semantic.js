/**
 * semantic.js — File-backed vector search for neuron
 *
 * Chunks all wiki .md files by heading, generates embeddings via the
 * configured embed provider, stores in Brain-Index/embeddings.json.
 * Supports incremental updates (only re-embeds modified files).
 *
 * Exports:
 *   buildIndex()           — Full rebuild of the embedding index
 *   incrementalUpdate()    — Only re-embed files with newer mtime
 *   search(query, topK)    — Semantic search, returns ranked results
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const INDEX_DIR = join(KB_DIR, 'Brain-Index');
const EMBEDDINGS_FILE = join(INDEX_DIR, 'embeddings.json');
const META_FILE = join(INDEX_DIR, '.index-meta.json');

// ── Provider Import ───────────────────────────────────────────

const { embed, loadConfig } = await import(join(__dirname, 'providers.js'));

// ── Chunking ──────────────────────────────────────────────────

/**
 * Split a markdown file into chunks by heading.
 * Each chunk includes the heading + content until the next heading.
 * Strips frontmatter before chunking.
 */
function chunkByHeading(content, filePath) {
  // Strip frontmatter
  let body = content;
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('---', 3);
    if (endIdx !== -1) {
      body = body.slice(endIdx + 3).trim();
    }
  }

  const lines = body.split('\n');
  const chunks = [];
  let currentHeading = basename(filePath, '.md');
  let currentLines = [];

  for (const line of lines) {
    if (line.match(/^#{1,3}\s+/)) {
      // Save previous chunk if it has content
      if (currentLines.length > 0) {
        const text = currentLines.join('\n').trim();
        if (text.length > 50) { // Skip tiny chunks
          chunks.push({
            heading: currentHeading,
            text,
            file: filePath,
          });
        }
      }
      currentHeading = line.replace(/^#+\s+/, '').trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Save last chunk
  if (currentLines.length > 0) {
    const text = currentLines.join('\n').trim();
    if (text.length > 50) {
      chunks.push({
        heading: currentHeading,
        text,
        file: filePath,
      });
    }
  }

  // If no headings found, treat whole file as one chunk
  if (chunks.length === 0 && body.trim().length > 50) {
    chunks.push({
      heading: basename(filePath, '.md'),
      text: body.trim(),
      file: filePath,
    });
  }

  return chunks;
}

// ── File Discovery ────────────────────────────────────────────

/**
 * Walk directories and find all .md files suitable for indexing.
 */
function findMarkdownFiles() {
  const dirs = [
    join(KB_DIR, 'wiki', 'concepts'),
    join(KB_DIR, 'wiki', 'summaries'),
    join(KB_DIR, 'wiki', 'queries'),
    join(KB_DIR, 'wiki', 'sessions'),
    join(KB_DIR, 'memory'),
  ];

  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md') && !f.startsWith('.')) {
        const fullPath = join(dir, f);
        const stat = statSync(fullPath);
        files.push({
          path: fullPath,
          relativePath: relative(KB_DIR, fullPath),
          mtime: stat.mtimeMs,
        });
      }
    }
  }
  return files;
}

// ── Index Storage ─────────────────────────────────────────────

function loadIndex() {
  if (!existsSync(EMBEDDINGS_FILE)) return { chunks: [], version: 1 };
  return JSON.parse(readFileSync(EMBEDDINGS_FILE, 'utf-8'));
}

function saveIndex(index) {
  if (!existsSync(INDEX_DIR)) mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(EMBEDDINGS_FILE, JSON.stringify(index));
}

function loadMeta() {
  if (!existsSync(META_FILE)) return { fileMtimes: {}, lastBuild: null };
  return JSON.parse(readFileSync(META_FILE, 'utf-8'));
}

function saveMeta(meta) {
  if (!existsSync(INDEX_DIR)) mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

// ── Cosine Similarity ─────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Batch Embedding ───────────────────────────────────────────

/**
 * Embed texts in batches to avoid overwhelming the API.
 * Returns array of embedding vectors in same order as input.
 */
async function batchEmbed(texts, batchSize = 20) {
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // Truncate to ~500 words per chunk to save tokens
    const truncated = batch.map(t => t.slice(0, 2000));
    const embeddings = await embed(truncated);
    allEmbeddings.push(...embeddings);

    if (i + batchSize < texts.length) {
      process.stdout.write(`  Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks\r`);
    }
  }

  return allEmbeddings;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Build the full embedding index from scratch.
 */
export async function buildIndex() {
  console.log('[neuron] Building semantic search index...\n');

  const config = loadConfig();
  if (!config.tiers.embed.models[config.tiers.embed.embed_provider]) {
    console.error('[neuron] No embedding model configured. Set tiers.embed in neuron.config.json.');
    console.error('  Recommended: Ollama with nomic-embed-text (free, local)');
    console.error('  Install: ollama pull nomic-embed-text');
    process.exit(1);
  }

  const files = findMarkdownFiles();
  console.log(`  Found ${files.length} markdown files to index`);

  // Chunk all files
  const allChunks = [];
  for (const file of files) {
    const content = readFileSync(file.path, 'utf-8');
    const chunks = chunkByHeading(content, file.relativePath);
    allChunks.push(...chunks);
  }
  console.log(`  Created ${allChunks.length} chunks`);

  if (allChunks.length === 0) {
    console.log('  No content to index. Add files to wiki/ first.');
    return;
  }

  // Generate embeddings
  console.log('  Generating embeddings...');
  const texts = allChunks.map(c => `${c.heading}: ${c.text}`);
  const embeddings = await batchEmbed(texts);
  console.log(`\n  Generated ${embeddings.length} embeddings`);

  // Build index
  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    chunkCount: allChunks.length,
    chunks: allChunks.map((chunk, i) => ({
      heading: chunk.heading,
      text: chunk.text.slice(0, 500), // Store truncated text for display
      file: chunk.file,
      embedding: embeddings[i],
    })),
  };

  saveIndex(index);

  // Save mtime metadata
  const meta = { fileMtimes: {}, lastBuild: new Date().toISOString() };
  for (const file of files) {
    meta.fileMtimes[file.relativePath] = file.mtime;
  }
  saveMeta(meta);

  const sizeKB = Math.round(JSON.stringify(index).length / 1024);
  console.log(`\n  Index saved: ${sizeKB}KB (${allChunks.length} chunks)`);
  console.log('  Ready for semantic search.');
}

/**
 * Incrementally update the index — only re-embed modified files.
 */
export async function incrementalUpdate() {
  const meta = loadMeta();
  const index = loadIndex();
  const files = findMarkdownFiles();

  // Find files that have changed
  const changed = files.filter(f => {
    const prevMtime = meta.fileMtimes[f.relativePath];
    return !prevMtime || f.mtime > prevMtime;
  });

  if (changed.length === 0) {
    console.log('[neuron] Semantic index is up to date.');
    return;
  }

  console.log(`[neuron] Updating ${changed.length} changed file(s)...`);

  // Remove old chunks for changed files
  const changedPaths = new Set(changed.map(f => f.relativePath));
  index.chunks = index.chunks.filter(c => !changedPaths.has(c.file));

  // Chunk and embed changed files
  const newChunks = [];
  for (const file of changed) {
    const content = readFileSync(file.path, 'utf-8');
    const chunks = chunkByHeading(content, file.relativePath);
    newChunks.push(...chunks);
  }

  if (newChunks.length > 0) {
    const texts = newChunks.map(c => `${c.heading}: ${c.text}`);
    const embeddings = await batchEmbed(texts);

    for (let i = 0; i < newChunks.length; i++) {
      index.chunks.push({
        heading: newChunks[i].heading,
        text: newChunks[i].text.slice(0, 500),
        file: newChunks[i].file,
        embedding: embeddings[i],
      });
    }
  }

  index.builtAt = new Date().toISOString();
  index.chunkCount = index.chunks.length;
  saveIndex(index);

  // Update mtimes
  for (const file of changed) {
    meta.fileMtimes[file.relativePath] = file.mtime;
  }
  meta.lastBuild = new Date().toISOString();
  saveMeta(meta);

  console.log(`  Updated: +${newChunks.length} chunks, ${index.chunks.length} total`);
}

/**
 * Search the index for semantically similar content.
 * @param {string} query - Search query
 * @param {number} [topK=5] - Number of results to return
 * @returns {Array<{score: number, heading: string, text: string, file: string}>}
 */
export async function search(query, topK = 5) {
  if (!query) {
    console.log('Usage: neuron semantic-search <query>');
    return [];
  }

  const index = loadIndex();
  if (index.chunks.length === 0) {
    console.log('[neuron] No semantic index found. Run `neuron reindex` first.');
    return [];
  }

  console.log(`[neuron] Searching ${index.chunks.length} chunks for: "${query}"\n`);

  // Embed the query
  const [queryEmbedding] = await embed(query);

  // Score all chunks
  const scored = index.chunks.map(chunk => ({
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
    heading: chunk.heading,
    text: chunk.text,
    file: chunk.file,
  }));

  // Sort by score, return top K
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topK);

  // Display results
  for (const [i, r] of results.entries()) {
    const score = (r.score * 100).toFixed(1);
    console.log(`  ${i + 1}. [${score}%] ${r.file}`);
    console.log(`     ${r.heading}`);
    console.log(`     ${r.text.slice(0, 120).replace(/\n/g, ' ')}...`);
    console.log('');
  }

  return results;
}

/**
 * Search and return results programmatically (no console output).
 * Used by connections.js and other modules.
 */
export async function searchQuiet(query, topK = 5) {
  const index = loadIndex();
  if (index.chunks.length === 0) return [];

  const [queryEmbedding] = await embed(query);

  const scored = index.chunks.map(chunk => ({
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
    heading: chunk.heading,
    text: chunk.text,
    file: chunk.file,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
