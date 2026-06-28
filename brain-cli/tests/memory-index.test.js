import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildMemoryIndex } from '../memory-index.js';

let kb, idx;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), 'kb-'));
  idx = join(mkdtempSync(join(tmpdir(), 'mem-')), 'MEMORY.md');
});
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('emits one pointer line per project, newest first', () => {
  writeProjectNode(kb, { slug: 'sb', title: 'Storied & Blessed', status: 'active', next_action: 'Grok art', last_touched: '2026-06-22' });
  writeProjectNode(kb, { slug: 'pap', title: 'Property Appraiser Pro', status: 'live', next_action: 'UAD export', last_touched: '2026-06-10' });
  buildMemoryIndex(kb, idx);
  const md = readFileSync(idx, 'utf8');
  expect(md).toContain('- [Storied & Blessed](Projects/sb.md) — active — Grok art');
  expect(md.indexOf('sb.md')).toBeLessThan(md.indexOf('pap.md'));
});

it('never lists a CONFIDENTIAL project', () => {
  const f = writeProjectNode(kb, { slug: 'secret', title: 'Secret', status: 'active', next_action: 'x', last_touched: '2026-06-22' });
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: CONFIDENTIAL'));
  buildMemoryIndex(kb, idx);
  expect(readFileSync(idx, 'utf8')).not.toContain('secret');
});

it('never lists a confidential project (lowercase)', () => {
  const f = writeProjectNode(kb, { slug: 'hidden', title: 'Hidden', status: 'active', next_action: 'x', last_touched: '2026-06-22' });
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: confidential'));
  buildMemoryIndex(kb, idx);
  const md = readFileSync(idx, 'utf8');
  expect(md).not.toContain('hidden');
  expect(md).not.toContain('Hidden');
});
