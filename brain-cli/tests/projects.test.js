import { it, expect, beforeEach, afterEach } from 'vitest';
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

it('round-trips links: as an array of slugs (not empty string)', () => {
  writeProjectNode(kb, { slug: 'a', title: 'A', status: 'active', next_action: 'x', last_touched: '2026-06-28', links: ['b-node', 'c-node'] });
  const [node] = readProjectNodes(kb).filter(n => n.slug === 'a');
  expect(Array.isArray(node.data.links)).toBe(true);
  expect(node.data.links).toEqual(['b-node', 'c-node']);
});

it('returns empty array for a node with no links', () => {
  writeProjectNode(kb, { slug: 'd', title: 'D', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  const [node] = readProjectNodes(kb).filter(n => n.slug === 'd');
  expect(node.data.links).toEqual([]);
});
