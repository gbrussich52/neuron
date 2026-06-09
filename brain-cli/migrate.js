// migrate.js — one-time vault migration helpers for the trust ladder.
// Pure functions take an explicit kbDir (and date) so they are deterministic + testable.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
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
    content = setField(content, 'author', inferAuthor(data));
    writeFileSync(path, content);
    changed.push(relative(kbDir, path));
  }
  return changed;
}

// CLI entry: `node migrate.js <classify|trust> [--apply]` (dry-run by default).
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
