import { describe, it, expect } from 'vitest';
import { parseGaps, parseImproveArgs } from '../improve.js';

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
  it('throws on valid JSON that is not an object', () => {
    expect(() => parseGaps('null')).toThrow(/lint-report\.json/);
    expect(() => parseGaps('"hello"')).toThrow(/lint-report\.json/);
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

describe('parseImproveArgs — research call cost ceiling (regression for finding #7)', () => {
  it('defaults maxResearchCalls to maxIterations x research_gaps_per_iteration (5 x 2 = 10)', () => {
    const opts = parseImproveArgs([]);
    expect(opts.maxIterations).toBe(5);
    expect(opts.maxResearchCalls).toBe(10);
  });

  it('scales the default ceiling when --max-iterations is overridden', () => {
    const opts = parseImproveArgs(['--max-iterations', '3']);
    expect(opts.maxResearchCalls).toBe(6); // 3 iterations x 2 gaps/iteration
  });

  it('respects an explicit --max-research-calls override, even a tight one', () => {
    const opts = parseImproveArgs(['--max-iterations', '10', '--max-research-calls', '1']);
    expect(opts.maxResearchCalls).toBe(1);
  });

  it('treats --max-research-calls 0 as an explicit hard stop, not "unset"', () => {
    // 0 is falsy, so a naive `||` chain would silently fall back to the computed
    // default instead of honoring an explicit zero-budget request.
    const opts = parseImproveArgs(['--max-research-calls', '0']);
    expect(opts.maxResearchCalls).toBe(0);
  });

  it('never lets a garbage --max-research-calls value produce NaN', () => {
    const opts = parseImproveArgs(['--max-research-calls', 'not-a-number']);
    expect(Number.isNaN(opts.maxResearchCalls)).toBe(false);
  });
});
