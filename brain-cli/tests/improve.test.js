import { describe, it, expect } from 'vitest';
import { parseGaps } from '../improve.js';

describe('parseGaps', () => {
  it('extracts gap topics from a valid lint-report.json string', () => {
    const json = JSON.stringify({
      grade: 'C', score: 66, generated: '2026-05-22T00:00:00Z',
      gaps: [
        { topic: 'PFAS health limits', reason: 'referenced, no article', priority: 5 },
        { topic: 'well water testing', reason: 'stub only', priority: 3 },
      ],
      issues: [],
    });
    expect(parseGaps(json)).toEqual(['PFAS health limits', 'well water testing']);
  });
  it('returns an empty array when gaps is empty', () => {
    expect(parseGaps(JSON.stringify({ grade: 'A', score: 95, gaps: [], issues: [] }))).toEqual([]);
  });
  it('throws on malformed JSON rather than silently returning []', () => {
    expect(() => parseGaps('{not valid json')).toThrow(/lint-report\.json/);
  });
  it('sorts gaps by descending priority', () => {
    const json = JSON.stringify({
      gaps: [
        { topic: 'low', reason: 'x', priority: 1 },
        { topic: 'high', reason: 'y', priority: 5 },
      ],
    });
    expect(parseGaps(json)).toEqual(['high', 'low']);
  });
});
