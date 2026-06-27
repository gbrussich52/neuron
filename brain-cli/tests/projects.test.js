import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode, readProjectNodes } from '../projects.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('writes a project node with status frontmatter and links', () => {
  const file = writeProjectNode(kb, {
    slug: 'storied-and-blessed', title: 'Storied & Blessed',
    status: 'active', next_action: 'Grok art handoff', blocker: 'awaiting endpapers',
    last_touched: '2026-06-22', links: ['the-day-you-were-baptized', 'lulu-integration'],
    body: 'Faith childrens books.',
  });
  const md = readFileSync(file, 'utf8');
  expect(md).toMatch(/classification: PRIVATE/);
  expect(md).toMatch(/type: project/);
  expect(md).toMatch(/status: active/);
  expect(md).toMatch(/next_action: Grok art handoff/);
  expect(md).toContain('[[the-day-you-were-baptized]]');
});

it('reads project nodes sorted by last_touched desc', () => {
  writeProjectNode(kb, { slug: 'old', title: 'Old', status: 'active', next_action: 'x', last_touched: '2026-01-01' });
  writeProjectNode(kb, { slug: 'new', title: 'New', status: 'active', next_action: 'y', last_touched: '2026-06-22' });
  const nodes = readProjectNodes(kb);
  expect(nodes.map(n => n.slug)).toEqual(['new', 'old']);
  expect(nodes[0].data.status).toBe('active');
});
