import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildCommandCenter } from '../command-center.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('builds a Command-Center.md table linking each project, sorted by last_touched', () => {
  writeProjectNode(kb, { slug: 'pap', title: 'Property Appraiser Pro', status: 'live', next_action: 'UAD export', last_touched: '2026-06-10' });
  writeProjectNode(kb, { slug: 'sb', title: 'Storied & Blessed', status: 'active', next_action: 'Grok art', blocker: 'endpapers', last_touched: '2026-06-22' });
  const file = buildCommandCenter(kb);
  const md = readFileSync(file, 'utf8');
  expect(file).toContain('Command-Center.md');
  expect(md).toMatch(/\| Project \| Status \| Next action \| Blocker \| Last touched \|/);
  // Most-recently-touched project appears first
  expect(md.indexOf('[[sb]]')).toBeLessThan(md.indexOf('[[pap]]'));
  expect(md).toContain('endpapers');
});
