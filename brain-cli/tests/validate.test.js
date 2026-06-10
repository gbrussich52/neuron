import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateFile, runSweep } from '../validate.js';
import { parseFrontmatter, setField } from '../lib/frontmatter.js';
import { computeContentHash } from '../lib/contentHash.js';
import { appendEntry } from '../lib/approvals.js';

let vault;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-val-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('validateFile', () => {
  it('vector 11/14: an unstamped agent write is born unverified with full stamps', () => {
    const { content, changes } = validateFile('# Raw note\nbody', { author: 'claude' });
    const { data } = parseFrontmatter(content);
    expect(data.trust).toBe('unverified');
    expect(data.author).toBe('claude');
    expect(data.classification).toBe('PRIVATE');
    expect(data.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.content_hash).toHaveLength(64);
    expect(changes.length).toBeGreaterThan(0);
  });
  it('author giani is born verified (user manual write)', () => {
    const { content } = validateFile('# Mine\nbody', { author: 'giani' });
    const { data } = parseFrontmatter(content);
    expect(data.trust).toBe('verified');
    expect(data.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('grandfathered verified note gets a hash stamp WITHOUT demotion', () => {
    const note = '---\nclassification: PRIVATE\ntrust: verified\nauthor: legacy\nsource: pre-neuron\nverified_at: 2026-06-09\ncaptured_at: 2026-06-09\n---\n\n# Legacy\nbody';
    const { content } = validateFile(note, { relPath: 'wiki/concepts/l.md', kbDir: vault });
    const { data } = parseFrontmatter(content);
    expect(data.trust).toBe('verified');
    expect(data.content_hash).toHaveLength(64);
  });
  it('vector 7: body edit after verification demotes to unverified', () => {
    let note = '---\nclassification: PRIVATE\ntrust: verified\nauthor: giani\nsource: manual\nverified_at: 2026-06-09\ncaptured_at: 2026-06-09\n---\n\n# Note\noriginal body';
    note = setField(note, 'content_hash', computeContentHash(note));
    const edited = note.replace('original body', 'tampered body');
    const { content, changes } = validateFile(edited, { relPath: 'wiki/concepts/n.md', kbDir: vault });
    const { data } = parseFrontmatter(content);
    expect(data.trust).toBe('unverified');
    expect(data.content_hash).toBe(computeContentHash(edited));
    expect(changes.join(' ')).toMatch(/demoted/);
  });
  it('an approval matching the NEW hash promotes instead of demoting', () => {
    let note = '---\nclassification: PRIVATE\ntrust: unverified\nauthor: claude\nsource: session\ncaptured_at: 2026-06-09\n---\n\n# Note\napproved body';
    note = setField(note, 'content_hash', 'stale-old-hash');
    appendEntry(vault, { action: 'approve', slug: 'wiki/concepts/n.md', content_hash: computeContentHash(note), approver: 'giani' });
    const { content } = validateFile(note, { relPath: 'wiki/concepts/n.md', kbDir: vault });
    expect(parseFrontmatter(content).data.trust).toBe('verified');
  });
  it('rejected is terminal: hash restamps but trust never resurrects', () => {
    let note = '---\nclassification: PRIVATE\ntrust: rejected\nauthor: claude\nsource: session\ncaptured_at: 2026-06-09\nrejected_at: 2026-06-09\n---\n\n# Note\nbody';
    note = setField(note, 'content_hash', 'stale');
    const { content } = validateFile(note, { relPath: 'wiki/concepts/r.md', kbDir: vault });
    expect(parseFrontmatter(content).data.trust).toBe('rejected');
  });
});

describe('runSweep', () => {
  it('dry-run reports but does not write; --apply writes; second sweep is a no-op', () => {
    const f = join(vault, 'wiki/concepts/new.md');
    writeFileSync(f, '# New\nbody');
    const dry = runSweep(vault, { apply: false, author: 'claude' });
    expect(dry).toHaveLength(1);
    expect(readFileSync(f, 'utf-8')).toBe('# New\nbody');
    const applied = runSweep(vault, { apply: true, author: 'claude' });
    expect(applied).toHaveLength(1);
    expect(parseFrontmatter(readFileSync(f, 'utf-8')).data.trust).toBe('unverified');
    expect(runSweep(vault, { apply: true, author: 'claude' })).toHaveLength(0);
  });
});
