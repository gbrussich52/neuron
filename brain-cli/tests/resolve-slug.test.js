import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveSlug } from '../lib/resolveSlug.js';

let vault;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-slug-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(vault, 'memory'), { recursive: true });
  writeFileSync(join(vault, 'wiki/concepts/pfas.md'), '# A');
  writeFileSync(join(vault, 'wiki/concepts/unique.md'), '# B');
  writeFileSync(join(vault, 'memory/pfas.md'), '# C');
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('resolveSlug', () => {
  it('passes a vault-relative path through verbatim', () => {
    expect(resolveSlug(vault, 'wiki/concepts/pfas.md')).toBe('wiki/concepts/pfas.md');
    expect(resolveSlug(vault, 'wiki/concepts/pfas')).toBe('wiki/concepts/pfas.md');
  });
  it('resolves a unique basename', () => {
    expect(resolveSlug(vault, 'unique')).toBe('wiki/concepts/unique.md');
  });
  it('throws listing candidates on an ambiguous basename', () => {
    expect(() => resolveSlug(vault, 'pfas')).toThrow(/Ambiguous[\s\S]*wiki\/concepts\/pfas\.md[\s\S]*memory\/pfas\.md/);
  });
  it('throws on a missing slug', () => {
    expect(() => resolveSlug(vault, 'nope')).toThrow(/No note found/);
  });
  it('throws on a slug that traverses outside the vault', () => {
    writeFileSync(join(vault, '..', 'escape-target.md'), '# X');
    expect(() => resolveSlug(vault, '../escape-target')).toThrow(/outside the vault/);
    rmSync(join(vault, '..', 'escape-target.md'), { force: true });
  });
});
