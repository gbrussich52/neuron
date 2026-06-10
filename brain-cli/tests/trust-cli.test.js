import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { approve, reject, reverify } from '../trust-cli.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash } from '../lib/contentHash.js';
import { readEntries } from '../lib/approvals.js';

let vault;
const DRAFT = '---\nclassification: PRIVATE\ntrust: unverified\nauthor: nightly\nsource: neuron-research\ncaptured_at: 2026-06-09\n---\n\n# Draft\nDraft body.';

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-trust-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  writeFileSync(join(vault, 'wiki/concepts/draft.md'), DRAFT);
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('approve (vector 6)', () => {
  it('promotes to verified, binds the hash in approvals.log, regenerates REVIEW.md', () => {
    const result = approve(vault, 'draft', 'giani');
    const content = readFileSync(join(vault, 'wiki/concepts/draft.md'), 'utf-8');
    const { data } = parseFrontmatter(content);
    expect(data.trust).toBe('verified');
    expect(data.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.content_hash).toBe(computeContentHash(content));
    expect(readEntries(vault)[0]).toMatchObject({ action: 'approve', slug: 'wiki/concepts/draft.md', approver: 'giani' });
    expect(result.slug).toBe('wiki/concepts/draft.md');
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).not.toContain('- [ ] `wiki/concepts/draft.md`');
  });
  it('stamps source: manual when source is missing (resolves the mechanical fail)', () => {
    writeFileSync(join(vault, 'wiki/concepts/nosrc.md'),
      '---\nclassification: PRIVATE\ntrust: unverified\nauthor: claude\ncaptured_at: 2026-06-09\n---\n\n# N\nbody');
    approve(vault, 'nosrc', 'giani');
    expect(parseFrontmatter(readFileSync(join(vault, 'wiki/concepts/nosrc.md'), 'utf-8')).data.source).toBe('manual');
  });
});

describe('reject', () => {
  it('is terminal: stamps rejected, archives with prefix, logs the action', () => {
    reject(vault, 'draft', 'giani');
    expect(existsSync(join(vault, 'wiki/concepts/draft.md'))).toBe(false);
    const archived = readdirSync(join(vault, 'Archive')).find(f => f.startsWith('rejected-') && f.endsWith('draft.md'));
    expect(archived).toBeTruthy();
    const { data } = parseFrontmatter(readFileSync(join(vault, 'Archive', archived), 'utf-8'));
    expect(data.trust).toBe('rejected');
    expect(data.rejected_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readEntries(vault)[0].action).toBe('reject');
  });
});

describe('reverify', () => {
  it('restamps verified_at and clears needs_reverify on a verified note', () => {
    writeFileSync(join(vault, 'wiki/concepts/old.md'),
      '---\nclassification: PRIVATE\ntrust: verified\nauthor: legacy\nsource: pre-neuron\nverified_at: 2020-01-01\nneeds_reverify: true\n---\n\n# Old\nbody');
    reverify(vault, 'old', 'giani');
    const { data } = parseFrontmatter(readFileSync(join(vault, 'wiki/concepts/old.md'), 'utf-8'));
    expect(data.verified_at).not.toBe('2020-01-01');
    expect(data.needs_reverify).toBe('false');
  });
  it('refuses to reverify a non-verified note', () => {
    expect(() => reverify(vault, 'draft', 'giani')).toThrow(/expected verified/);
  });
});
