// migrate.js — one-time vault migration helpers for the trust ladder.
// Pure functions take an explicit kbDir (and date) so they are deterministic + testable.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { hasField, setField } from './lib/frontmatter.js';

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

// CLI entry: `node migrate.js classify [--apply]` (dry-run by default).
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
  } else {
    console.log('Usage: node migrate.js classify [--apply]');
  }
}
