import { describe, it, expect } from 'vitest';
import { filterTrusted } from '../semantic.js';

const chunks = [
  { file: 'a.md', trust: 'verified',   classification: 'PUBLIC' },
  { file: 'b.md', trust: 'unverified', classification: 'PRIVATE' },
  { file: 'c.md', trust: 'verified',   classification: 'CONFIDENTIAL' }, // must never pass
  { file: 'd.md' }, // legacy: no trust → excluded (fail-closed)
];

describe('filterTrusted', () => {
  it('returns only verified, never CONFIDENTIAL, by default', () => {
    expect(filterTrusted(chunks).map(c => c.file)).toEqual(['a.md']);
  });
  it('includes unverified when opted in, still never CONFIDENTIAL', () => {
    expect(filterTrusted(chunks, { includeUnverified: true }).map(c => c.file))
      .toEqual(['a.md', 'b.md']);
  });
});
