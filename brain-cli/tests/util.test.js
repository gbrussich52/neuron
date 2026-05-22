import { describe, it, expect } from 'vitest';
import { timestamp, slugify } from '../lib/util.js';

describe('timestamp', () => {
  it('produces a filesystem-safe ISO-derived stamp with no colons or T', () => {
    const ts = timestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(slugify('Hello, World! 2026')).toBe('hello__world__2026');
  });
  it('truncates to the requested length', () => {
    expect(slugify('a'.repeat(100), 10)).toHaveLength(10);
  });
});
