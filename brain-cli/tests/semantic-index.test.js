import { describe, it, expect } from 'vitest';
import { readNoteMeta, chunksForFile } from '../semantic.js';

const CONF = `---\nclassification: CONFIDENTIAL\ntrust: verified\n---\n\n# Secret\nssn 123-45-6789 and more than fifty characters of body text here.`;
const PRIV = `---\nclassification: PRIVATE\ntrust: verified\nauthor: giani\n---\n\n# Topic\nThis is a private note body with well over fifty characters of content.`;

describe('readNoteMeta', () => {
  it('reads classification and trust', () => {
    expect(readNoteMeta(PRIV)).toMatchObject({ classification: 'PRIVATE', trust: 'verified', author: 'giani' });
  });
  it('returns nulls when fields absent', () => {
    expect(readNoteMeta('# no frontmatter at all here')).toMatchObject({ classification: null, trust: null });
  });
});

describe('chunksForFile', () => {
  it('returns NO chunks for CONFIDENTIAL files (never index secrets)', () => {
    expect(chunksForFile(CONF, 'memory/people.md')).toEqual([]);
  });
  it('tags chunks with classification and trust', () => {
    const chunks = chunksForFile(PRIV, 'wiki/concepts/topic.md');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({ classification: 'PRIVATE', trust: 'verified', file: 'wiki/concepts/topic.md' });
  });
  it('defaults missing trust to unverified (fail-closed)', () => {
    const md = `---\nclassification: PRIVATE\n---\n\n# T\nbody text that is definitely longer than fifty characters for chunking.`;
    expect(chunksForFile(md, 'raw/x.md')[0].trust).toBe('unverified');
  });
});
