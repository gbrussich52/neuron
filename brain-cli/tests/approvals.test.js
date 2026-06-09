import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendEntry, readEntries, latestFor } from '../lib/approvals.js';

let vault;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), 'neuron-appr-')); });
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('approvals log', () => {
  it('appends JSONL entries and reads them back', () => {
    appendEntry(vault, { action: 'approve', slug: 'wiki/concepts/a.md', content_hash: 'h1', approver: 'giani' });
    appendEntry(vault, { action: 'reject', slug: 'wiki/concepts/b.md', content_hash: 'h2', approver: 'giani' });
    const entries = readEntries(vault);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ action: 'approve', slug: 'wiki/concepts/a.md', content_hash: 'h1' });
    expect(entries[0].ts).toBeTruthy();
    expect(readFileSync(join(vault, 'approvals.log'), 'utf-8').trim().split('\n')).toHaveLength(2);
  });
  it('tolerates malformed lines (skips them)', () => {
    appendEntry(vault, { action: 'approve', slug: 'a.md', content_hash: 'h1', approver: 'giani' });
    appendFileSync(join(vault, 'approvals.log'), 'NOT JSON\n');
    appendEntry(vault, { action: 'approve', slug: 'a.md', content_hash: 'h2', approver: 'giani' });
    expect(readEntries(vault)).toHaveLength(2);
  });
  it('latestFor returns the most recent matching entry (append-only, later wins)', () => {
    appendEntry(vault, { action: 'approve', slug: 'a.md', content_hash: 'old', approver: 'giani' });
    appendEntry(vault, { action: 'approve', slug: 'a.md', content_hash: 'new', approver: 'giani' });
    expect(latestFor(vault, 'a.md', 'approve').content_hash).toBe('new');
    expect(latestFor(vault, 'missing.md', 'approve')).toBe(null);
  });
  it('returns [] when the log does not exist', () => {
    expect(readEntries(vault)).toEqual([]);
  });
});
