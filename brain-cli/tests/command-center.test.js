import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
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

it('excludes CONFIDENTIAL nodes (case-insensitive) from the dashboard', () => {
  const f = writeProjectNode(kb, { slug: 'secret', title: 'Secret', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  // flip to lowercase confidential to prove case-insensitivity
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: confidential'));
  writeProjectNode(kb, { slug: 'shown', title: 'Shown', status: 'active', next_action: 'y', last_touched: '2026-06-28' });
  const md = readFileSync(buildCommandCenter(kb), 'utf8');
  expect(md).not.toContain('[[secret]]');
  expect(md).toContain('[[shown]]');
});
