import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { backfillClassification } from '../migrate.js';
import { parseFrontmatter } from '../lib/frontmatter.js';

let vault;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-mig-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('backfillClassification', () => {
  it('adds classification: PRIVATE to a note that lacks it', () => {
    const f = join(vault, 'wiki/concepts/a.md');
    writeFileSync(f, '# A\nbody');
    const changed = backfillClassification(vault);
    expect(changed).toContain('wiki/concepts/a.md');
    expect(parseFrontmatter(readFileSync(f, 'utf-8')).data.classification).toBe('PRIVATE');
  });
  it('leaves an already-classified note untouched', () => {
    const f = join(vault, 'wiki/concepts/b.md');
    writeFileSync(f, '---\nclassification: PUBLIC\n---\n\n# B');
    const changed = backfillClassification(vault);
    expect(changed).not.toContain('wiki/concepts/b.md');
    expect(parseFrontmatter(readFileSync(f, 'utf-8')).data.classification).toBe('PUBLIC');
  });
});
