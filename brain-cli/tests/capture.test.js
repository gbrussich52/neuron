import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { captureNote } from '../capture.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

describe('captureNote', () => {
  it('writes a PRIVATE idea note to Inbox/ with frontmatter and body', async () => {
    const noopLinker = async () => ({ links: [] });
    const res = await captureNote('coffee subscription idea, faith angle',
      { source: 'terminal', kbDir: kb, linker: noopLinker });

    expect(existsSync(res.file)).toBe(true);
    expect(res.file).toContain(join(kb, 'Inbox'));
    const md = readFileSync(res.file, 'utf8');
    expect(md).toMatch(/classification: PRIVATE/);
    expect(md).toMatch(/type: idea/);
    expect(md).toMatch(/source: terminal/);
    expect(md).toMatch(/status: raw/);
    expect(md).toContain('coffee subscription idea, faith angle');
    expect(res.links).toEqual([]);
  });

  it('returns link targets from the linker (findConnections shape)', async () => {
    const fakeLinker = async () => ({
      links: [
        { target: 'storied-and-blessed', reason: 'faith' },
        { target: 'coffee', reason: 'domain' },
      ],
      questions: [],
    });
    const res = await captureNote('coffee + faith subscription',
      { kbDir: kb, linker: fakeLinker });
    expect(res.links).toEqual(['storied-and-blessed', 'coffee']);
  });

  it('never throws if the linker fails (capture is durable)', async () => {
    const boomLinker = async () => { throw new Error('semantic index down'); };
    const res = await captureNote('idea while offline', { kbDir: kb, linker: boomLinker });
    expect(res.links).toEqual([]);
    expect(existsSync(res.file)).toBe(true);
  });
});
