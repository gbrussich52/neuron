// migrate.js — one-time vault migration helpers for the trust ladder.
// Pure functions take an explicit kbDir (and date) so they are deterministic + testable.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, relative, dirname } from 'path';
import { homedir } from 'os';
import { hasField, setField, parseFrontmatter } from './lib/frontmatter.js';

// Content dirs the trust ladder governs (Inbox/, Archive/, Brain-Index/ are excluded by design).
const CONTENT_DIRS = ['wiki', 'memory', 'raw', 'Research', 'UGC-Dual-Path', 'Notes', 'Daily'];

export function walkMarkdown(kbDir) {
  const out = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) visit(full);
      else if (name.endsWith('.md')) out.push(full);
    }
  };
  for (const d of CONTENT_DIRS) visit(join(kbDir, d));
  return out;
}

/** Add `classification: PRIVATE` to any .md lacking it. Returns relative paths changed. */
export function backfillClassification(kbDir) {
  const changed = [];
  for (const path of walkMarkdown(kbDir)) {
    const content = readFileSync(path, 'utf-8');
    if (hasField(content, 'classification')) continue;
    writeFileSync(path, setField(content, 'classification', 'PRIVATE'));
    changed.push(relative(kbDir, path));
  }
  return changed;
}

/** Detect honest authorship from existing frontmatter hints. */
function inferAuthor(data) {
  const hint = `${data.built_by || ''} ${data.author || ''} ${data.created_by || ''}`.toLowerCase();
  if (hint.includes('grok')) return 'grok';
  if (hint.includes('claude')) return 'claude';
  return 'legacy';
}

/**
 * Grandfather every existing note (lacking `trust`) as verified — the user is the
 * trust authority for pre-existing content — while preserving honest authorship.
 * Notes committed AFTER the hook is armed (later plan) are the ones that start unverified.
 */
export function grandfatherTrust(kbDir, today) {
  const changed = [];
  for (const path of walkMarkdown(kbDir)) {
    let content = readFileSync(path, 'utf-8');
    if (hasField(content, 'trust')) continue;
    const { data } = parseFrontmatter(content);
    content = setField(content, 'trust', 'verified');
    content = setField(content, 'source', data.source || 'pre-neuron');
    content = setField(content, 'verified_at', today);
    // Preserve an explicit author if the note already declares one; only infer when absent.
    if (!hasField(content, 'author')) content = setField(content, 'author', inferAuthor(data));
    writeFileSync(path, content);
    changed.push(relative(kbDir, path));
  }
  return changed;
}

/** Strip a single frontmatter key from raw markdown content. */
function removeField(content, key) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return content;
  const raw = m[1].split('\n').filter(l => !l.match(new RegExp(`^${key}\\s*:`, 'i'))).join('\n');
  return `---\n${raw}\n---\n${content.slice(m[0].length)}`;
}

/**
 * Retire the old wiki/_review/ surface: move each draft to its target_path, born
 * trust:unverified (author: nightly, source: neuron-research), strip status/target_path.
 * The single REVIEW.md (later plan) becomes the only surface.
 */
export function retireReviewQueue(kbDir) {
  const reviewDir = join(kbDir, 'wiki', '_review');
  if (!existsSync(reviewDir)) return [];
  const moved = [];
  for (const name of readdirSync(reviewDir)) {
    if (!name.endsWith('.md')) continue;
    const src = join(reviewDir, name);
    let content = readFileSync(src, 'utf-8');
    const { data } = parseFrontmatter(content);
    const targetRel = data.target_path || `wiki/concepts/${name}`;
    content = setField(content, 'trust', 'unverified');
    content = setField(content, 'author', 'nightly');
    content = setField(content, 'source', 'neuron-research');
    content = removeField(removeField(content, 'status'), 'target_path');
    const dest = join(kbDir, targetRel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    rmSync(src);
    moved.push(targetRel);
  }
  rmSync(reviewDir, { recursive: true, force: true });
  return moved;
}

// CLI entry: `node migrate.js <classify|trust|retire-review> [--apply]` (dry-run by default).
if (import.meta.url === `file://${process.argv[1]}`) {
  const kbDir = process.env.KB_DIR || join(homedir(), 'knowledge-base');
  const cmd = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (cmd === 'classify') {
    if (!apply) {
      const missing = walkMarkdown(kbDir).filter(p => !hasField(readFileSync(p, 'utf-8'), 'classification'));
      console.log(`[dry-run] ${missing.length} files would get classification: PRIVATE`);
      missing.forEach(p => console.log('  ' + relative(kbDir, p)));
    } else {
      const changed = backfillClassification(kbDir);
      console.log(`Backfilled classification on ${changed.length} files.`);
    }
  } else if (cmd === 'trust') {
    if (!apply) {
      const missing = walkMarkdown(kbDir).filter(p => !hasField(readFileSync(p, 'utf-8'), 'trust'));
      console.log(`[dry-run] ${missing.length} files would be grandfathered as trust: verified`);
      missing.forEach(p => console.log('  ' + relative(kbDir, p)));
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const changed = grandfatherTrust(kbDir, today);
      console.log(`Grandfathered trust on ${changed.length} files.`);
    }
  } else {
    console.log('Usage: node migrate.js <classify|trust> [--apply]');
  }
}
