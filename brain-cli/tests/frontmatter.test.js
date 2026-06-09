import { describe, it, expect } from 'vitest';
import { parseFrontmatter, hasField, setField } from '../lib/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses keys lowercased and unquoted', () => {
    const md = `---\nclassification: PRIVATE\nTrust: verified\nauthor: "grok"\n---\n\n# Body\ntext`;
    const { data, body, hasFm } = parseFrontmatter(md);
    expect(hasFm).toBe(true);
    expect(data.classification).toBe('PRIVATE');
    expect(data.trust).toBe('verified');
    expect(data.author).toBe('grok');
    expect(body).toBe('# Body\ntext');
  });

  it('returns empty data when no frontmatter', () => {
    const { data, hasFm } = parseFrontmatter('# Just a heading');
    expect(hasFm).toBe(false);
    expect(data).toEqual({});
  });
});

describe('setField', () => {
  it('adds frontmatter when absent', () => {
    const out = setField('# Body', 'classification', 'PRIVATE');
    expect(out).toBe('---\nclassification: PRIVATE\n---\n\n# Body');
    expect(hasField(out, 'classification')).toBe(true);
  });

  it('appends a new field, preserving body', () => {
    const md = `---\nclassification: PRIVATE\n---\n\n# Body`;
    const out = setField(md, 'trust', 'verified');
    expect(parseFrontmatter(out).data.trust).toBe('verified');
    expect(parseFrontmatter(out).body).toBe('# Body');
    expect(parseFrontmatter(out).data.classification).toBe('PRIVATE');
  });

  it('replaces an existing field in place', () => {
    const md = `---\ntrust: unverified\n---\n\n# Body`;
    const out = setField(md, 'trust', 'verified');
    expect(parseFrontmatter(out).data.trust).toBe('verified');
    expect(out.match(/trust:/g)).toHaveLength(1);
  });

  it('keeps a blank line between frontmatter and body when modifying', () => {
    const md = `---\nclassification: PRIVATE\n---\n\n# Body`;
    const out = setField(md, 'trust', 'verified');
    expect(out).toMatch(/\n---\n\n# Body$/);
    expect(out.startsWith('---\n')).toBe(true);
  });

  it('parses a value containing a colon (e.g. a URL)', () => {
    const md = `---\nsource: https://example.com/path\n---\n\n# B`;
    expect(parseFrontmatter(md).data.source).toBe('https://example.com/path');
  });

  it('handles CRLF line endings', () => {
    const md = `---\r\nclassification: PRIVATE\r\n---\r\n\r\n# Body`;
    expect(parseFrontmatter(md).data.classification).toBe('PRIVATE');
    expect(hasField(md, 'classification')).toBe(true);
  });
});
