import { describe, it, expect } from 'vitest';
import { computeContentHash, hashMatches } from '../lib/contentHash.js';
import { setField } from '../lib/frontmatter.js';

const NOTE = `---\nclassification: PRIVATE\n---\n\n# Title\nBody text.`;

describe('computeContentHash', () => {
  it('is stable when only frontmatter changes', () => {
    expect(computeContentHash(setField(NOTE, 'trust', 'verified'))).toBe(computeContentHash(NOTE));
  });
  it('is stable across CRLF line endings', () => {
    expect(computeContentHash(NOTE.replace(/\n/g, '\r\n'))).toBe(computeContentHash(NOTE));
  });
  it('changes when the body changes', () => {
    expect(computeContentHash(NOTE + '\nmore')).not.toBe(computeContentHash(NOTE));
  });
  it('trims so trailing-newline-only edits do not change the hash', () => {
    expect(computeContentHash('# Bare')).toBe(computeContentHash('# Bare\n'));
  });
});

describe('hashMatches', () => {
  it('returns null when no content_hash stored', () => {
    expect(hashMatches(NOTE)).toBe(null);
  });
  it('returns true when stored hash matches body', () => {
    expect(hashMatches(setField(NOTE, 'content_hash', computeContentHash(NOTE)))).toBe(true);
  });
  it('returns false after a body edit', () => {
    const stamped = setField(NOTE, 'content_hash', computeContentHash(NOTE));
    expect(hashMatches(stamped + '\nedited')).toBe(false);
  });
});
