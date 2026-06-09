import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { backfillClassification, grandfatherTrust, retireReviewQueue } from '../migrate.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { existsSync as fexists } from 'fs';

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

describe('grandfatherTrust', () => {
  it('stamps existing notes verified with honest author + pre-neuron source', () => {
    const f = join(vault, 'wiki/concepts/legacy.md');
    writeFileSync(f, '---\nclassification: PRIVATE\n---\n\n# Legacy');
    grandfatherTrust(vault, '2026-06-09');
    const { data } = parseFrontmatter(readFileSync(f, 'utf-8'));
    expect(data.trust).toBe('verified');
    expect(data.source).toBe('pre-neuron');
    expect(data.verified_at).toBe('2026-06-09');
    expect(data.author).toBe('legacy');
  });
  it('credits Grok-built content honestly, not as giani', () => {
    const f = join(vault, 'wiki/concepts/ugc.md');
    writeFileSync(f, '---\nclassification: PRIVATE\nbuilt_by: Grok (xAI)\n---\n\n# UGC');
    grandfatherTrust(vault, '2026-06-09');
    expect(parseFrontmatter(readFileSync(f, 'utf-8')).data.author).toBe('grok');
  });
  it('does not touch a note that already has trust', () => {
    const f = join(vault, 'wiki/concepts/new.md');
    writeFileSync(f, '---\nclassification: PRIVATE\ntrust: unverified\n---\n\n# New');
    grandfatherTrust(vault, '2026-06-09');
    expect(parseFrontmatter(readFileSync(f, 'utf-8')).data.trust).toBe('unverified');
  });
});

describe('retireReviewQueue', () => {
  it('moves a draft to its target_path as unverified and removes the field', () => {
    mkdirSync(join(vault, 'wiki', '_review'), { recursive: true });
    const draft = join(vault, 'wiki/_review/pfas.md');
    writeFileSync(draft, '---\nclassification: PRIVATE\nstatus: pending-review\ntarget_path: wiki/concepts/pfas.md\n---\n\n# PFAS');
    const moved = retireReviewQueue(vault);
    const dest = join(vault, 'wiki/concepts/pfas.md');
    expect(fexists(dest)).toBe(true);
    expect(fexists(draft)).toBe(false);
    const { data } = parseFrontmatter(readFileSync(dest, 'utf-8'));
    expect(data.trust).toBe('unverified');
    expect(data.author).toBe('nightly');
    expect(data.source).toBe('neuron-research');
    expect('status' in data).toBe(false);
    expect(moved).toContain('wiki/concepts/pfas.md');
  });
});
