import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listPending, approveItem, rejectItem } from '../review.js';

let tmpKb;
let reviewDir;

function writePending(name, frontmatter) {
  const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  writeFileSync(join(reviewDir, name), `---\n${fm}\n---\n\n# ${name}\n\nbody.\n`);
}

beforeEach(() => {
  tmpKb = mkdtempSync(join(tmpdir(), 'neuron-review-'));
  reviewDir = join(tmpKb, 'wiki', '_review');
  mkdirSync(reviewDir, { recursive: true });
  mkdirSync(join(tmpKb, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(tmpKb, 'Archive'), { recursive: true });
});

afterEach(() => rmSync(tmpKb, { recursive: true, force: true }));

describe('listPending', () => {
  it('returns pending items sorted oldest first, ignoring README/.gitkeep', () => {
    writePending('a.md', { status: 'pending-review', created: '2026-05-23T00:00:00Z' });
    writePending('b.md', { status: 'pending-review', created: '2026-05-22T00:00:00Z' });
    writeFileSync(join(reviewDir, 'README.md'), '# meta');
    writeFileSync(join(reviewDir, '.gitkeep'), '');
    const items = listPending(tmpKb);
    expect(items.map(i => i.name)).toEqual(['b.md', 'a.md']);
  });
  it('returns [] when the queue is empty', () => {
    expect(listPending(tmpKb)).toEqual([]);
  });
});

describe('approveItem', () => {
  it('moves the item to target_path and removes it from _review/', () => {
    writePending('pfas.md', {
      status: 'pending-review',
      created: '2026-05-23T00:00:00Z',
      target_path: 'wiki/concepts/pfas-health-limits.md',
    });
    const result = approveItem(tmpKb, 'pfas.md');
    expect(result.moved).toBe(true);
    expect(result.target).toContain('wiki/concepts/pfas-health-limits.md');
    expect(existsSync(join(tmpKb, 'wiki', 'concepts', 'pfas-health-limits.md'))).toBe(true);
    expect(existsSync(join(reviewDir, 'pfas.md'))).toBe(false);
  });
  it('throws when target_path is missing from frontmatter', () => {
    writePending('bad.md', { status: 'pending-review', created: '2026-05-23T00:00:00Z' });
    expect(() => approveItem(tmpKb, 'bad.md')).toThrow(/target_path/);
  });
  it('throws when the file does not exist', () => {
    expect(() => approveItem(tmpKb, 'ghost.md')).toThrow(/not found/);
  });
});

describe('rejectItem', () => {
  it('moves the item to Archive/ with a rejected-<timestamp> prefix', () => {
    writePending('weak.md', { status: 'pending-review', created: '2026-05-23T00:00:00Z' });
    const result = rejectItem(tmpKb, 'weak.md');
    expect(result.archived).toBe(true);
    expect(result.target).toMatch(/Archive\/rejected-.*weak\.md$/);
    expect(existsSync(join(reviewDir, 'weak.md'))).toBe(false);
  });
});
