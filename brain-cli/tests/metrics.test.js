import { describe, it, expect } from 'vitest';
import { getGrade } from '../metrics.js';

function metricsFixture(overrides = {}) {
  return {
    counts: { concepts: 5, summaries: 5, queries: 0, sessions: 0, uncompiled: 0 },
    connections: { linkDensity: 2, totalWikilinks: 20, contradictions: 0, supports: 0, articlesWithRelated: 0 },
    weekly: { newConcepts: 1, newQueries: 1, newSessions: 1, gapQuestions: 0, researchReports: 0 },
    health: { lintGrade: 'B', compilationLag: 0 },
    ...overrides,
  };
}

describe('getGrade', () => {
  it('never exceeds 100 even with an enormous vault', () => {
    const huge = metricsFixture({
      counts: { concepts: 5000, summaries: 5000, queries: 0, sessions: 0, uncompiled: 0 },
      connections: { linkDensity: 999, totalWikilinks: 1e6, contradictions: 0, supports: 0, articlesWithRelated: 0 },
      weekly: { newConcepts: 999, newQueries: 999, newSessions: 999, gapQuestions: 0, researchReports: 0 },
      health: { lintGrade: 'A', compilationLag: 0 },
    });
    expect(getGrade(huge).score).toBeLessThanOrEqual(100);
  });
  it('never returns a negative score', () => {
    const empty = metricsFixture({
      counts: { concepts: 0, summaries: 0, queries: 0, sessions: 0, uncompiled: 999 },
      connections: { linkDensity: 0, totalWikilinks: 0, contradictions: 0, supports: 0, articlesWithRelated: 0 },
      weekly: { newConcepts: 0, newQueries: 0, newSessions: 0, gapQuestions: 0, researchReports: 0 },
      health: { lintGrade: 'F', compilationLag: 999 },
    });
    expect(getGrade(empty).score).toBeGreaterThanOrEqual(0);
  });
  it('returns an integer score', () => {
    const m = metricsFixture({
      connections: { linkDensity: 1.3, totalWikilinks: 13, contradictions: 0, supports: 0, articlesWithRelated: 0 },
    });
    expect(Number.isInteger(getGrade(m).score)).toBe(true);
  });
});
