/**
 * metrics.js — Thinking quality score for neuron
 *
 * Computes knowledge base health metrics from the filesystem:
 *   - Knowledge growth rate (new articles/week)
 *   - Connection density (wikilinks per article)
 *   - Compilation lag (uncompiled sources)
 *   - Contradictions resolved (typed relationships)
 *   - Session extraction rate
 *   - Gap questions generated
 *
 * Stores weekly snapshots in Brain-Index/metrics.json.
 * Composite letter grade A-F used by the improve loop.
 *
 * Exports:
 *   computeMetrics()            — Calculate current metrics
 *   displayMetrics(showHistory) — Print metrics to console
 *   takeSnapshot()              — Save current metrics as weekly snapshot
 *   getGrade()                  — Get current composite letter grade
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const INDEX_DIR = join(KB_DIR, 'Brain-Index');
const METRICS_FILE = join(INDEX_DIR, 'metrics.json');

// ── Helpers ───────────────────────────────────────────────────

function countFiles(dir, ext = '.md') {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter(f => f.endsWith(ext) && !f.startsWith('.')).length;
  } catch { return 0; }
}

function readAllMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => ({
      name: f,
      content: readFileSync(join(dir, f), 'utf-8'),
      mtime: statSync(join(dir, f)).mtimeMs,
    }));
}

function countWikilinks(content) {
  const matches = content.match(/\[\[[^\]]+\]\]/g);
  return matches ? matches.length : 0;
}

function countRelationships(content, type) {
  const regex = new RegExp(`${type}:`, 'gi');
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

function filesModifiedThisWeek(files) {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return files.filter(f => f.mtime > oneWeekAgo).length;
}

// ── Metric Computation ────────────────────────────────────────

export function computeMetrics() {
  const concepts = readAllMd(join(KB_DIR, 'wiki', 'concepts'));
  const summaries = readAllMd(join(KB_DIR, 'wiki', 'summaries'));
  const queries = readAllMd(join(KB_DIR, 'wiki', 'queries'));
  const sessions = readAllMd(join(KB_DIR, 'wiki', 'sessions'));
  const allArticles = [...concepts, ...summaries, ...queries];

  // Count uncompiled raw sources
  let uncompiledCount = 0;
  const rawDir = join(KB_DIR, 'raw');
  if (existsSync(rawDir)) {
    const rawFiles = readAllMd(rawDir);
    uncompiledCount = rawFiles.filter(f => f.content.includes('compiled: false')).length;
  }

  // Wikilink density
  const totalLinks = allArticles.reduce((sum, a) => sum + countWikilinks(a.content), 0);
  const linkDensity = allArticles.length > 0 ? totalLinks / allArticles.length : 0;

  // Contradiction tracking
  const contradictions = allArticles.reduce(
    (sum, a) => sum + countRelationships(a.content, 'contradicts'), 0
  );
  const supports = allArticles.reduce(
    (sum, a) => sum + countRelationships(a.content, 'supports'), 0
  );

  // Weekly activity
  const newConceptsThisWeek = filesModifiedThisWeek(concepts);
  const newQueriesThisWeek = filesModifiedThisWeek(queries);
  const newSessionsThisWeek = filesModifiedThisWeek(sessions);

  // Gap questions generated
  const gapQuestions = queries.filter(q => q.content.includes('type: gap-questions')).length;

  // Lint health (check for lint-report.md)
  let lintGrade = 'N/A';
  const lintReport = join(KB_DIR, 'wiki', 'lint-report.md');
  if (existsSync(lintReport)) {
    const lintContent = readFileSync(lintReport, 'utf-8');
    const gradeMatch = lintContent.match(/(?:grade|score|health)[:\s]*([A-F])/i);
    if (gradeMatch) lintGrade = gradeMatch[1].toUpperCase();
  }

  return {
    timestamp: new Date().toISOString(),
    counts: {
      concepts: concepts.length,
      summaries: summaries.length,
      queries: queries.length,
      sessions: sessions.length,
      uncompiled: uncompiledCount,
    },
    connections: {
      totalWikilinks: totalLinks,
      linkDensity: Math.round(linkDensity * 10) / 10,
      contradictions,
      supports,
    },
    weekly: {
      newConcepts: newConceptsThisWeek,
      newQueries: newQueriesThisWeek,
      newSessions: newSessionsThisWeek,
      gapQuestions,
    },
    health: {
      lintGrade,
      compilationLag: uncompiledCount,
    },
  };
}

// ── Composite Grade ───────────────────────────────────────────

/**
 * Calculate composite grade A-F based on metrics.
 *
 * Scoring (0-100):
 *   - Content volume:     up to 20 points (10+ concepts = 20)
 *   - Link density:       up to 25 points (2+ links/article = 25)
 *   - Weekly activity:    up to 20 points (3+ new items = 20)
 *   - Compilation lag:    up to 20 points (0 uncompiled = 20)
 *   - Lint health:        up to 15 points (A = 15)
 */
export function getGrade(metrics) {
  let score = 0;

  // Content volume (0-20)
  const contentCount = metrics.counts.concepts + metrics.counts.summaries;
  score += Math.min(20, contentCount * 2);

  // Link density (0-25)
  score += Math.min(25, metrics.connections.linkDensity * 12.5);

  // Weekly activity (0-20)
  const weeklyTotal = metrics.weekly.newConcepts + metrics.weekly.newQueries + metrics.weekly.newSessions;
  score += Math.min(20, weeklyTotal * 5);

  // Compilation lag (0-20): full points for 0 uncompiled, decreases
  const lagPenalty = Math.min(20, metrics.health.compilationLag * 4);
  score += 20 - lagPenalty;

  // Lint health (0-15)
  const lintScores = { A: 15, B: 12, C: 8, D: 4, F: 0, 'N/A': 7 };
  score += lintScores[metrics.health.lintGrade] || 7;

  // Convert to letter
  if (score >= 90) return { grade: 'A', score };
  if (score >= 75) return { grade: 'B', score };
  if (score >= 60) return { grade: 'C', score };
  if (score >= 40) return { grade: 'D', score };
  return { grade: 'F', score };
}

// ── Snapshots ─────────────────────────────────────────────────

function loadSnapshots() {
  if (!existsSync(METRICS_FILE)) return [];
  return JSON.parse(readFileSync(METRICS_FILE, 'utf-8'));
}

function saveSnapshots(snapshots) {
  if (!existsSync(INDEX_DIR)) mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(METRICS_FILE, JSON.stringify(snapshots, null, 2));
}

export function takeSnapshot() {
  const metrics = computeMetrics();
  const { grade, score } = getGrade(metrics);
  const snapshot = { ...metrics, grade, score };

  const snapshots = loadSnapshots();
  snapshots.push(snapshot);

  // Keep last 52 weeks of snapshots
  if (snapshots.length > 52) {
    snapshots.splice(0, snapshots.length - 52);
  }

  saveSnapshots(snapshots);
  console.log(`[neuron] Metrics snapshot saved. Grade: ${grade} (${score}/100)`);
  return snapshot;
}

// ── Display ───────────────────────────────────────────────────

export async function displayMetrics(showHistory = false) {
  const metrics = computeMetrics();
  const { grade, score } = getGrade(metrics);

  const gradeBar = '='.repeat(Math.round(score / 5)) + '-'.repeat(20 - Math.round(score / 5));

  console.log(`
=== Neuron Brain Score ===

  Grade: ${grade} [${gradeBar}] ${score}/100

  Content:
    Concepts:      ${metrics.counts.concepts}
    Summaries:     ${metrics.counts.summaries}
    Queries:       ${metrics.counts.queries}
    Sessions:      ${metrics.counts.sessions}
    Uncompiled:    ${metrics.counts.uncompiled}

  Connections:
    Total links:   ${metrics.connections.totalWikilinks}
    Per article:   ${metrics.connections.linkDensity}
    Contradicts:   ${metrics.connections.contradictions}
    Supports:      ${metrics.connections.supports}

  This Week:
    New concepts:  ${metrics.weekly.newConcepts}
    New queries:   ${metrics.weekly.newQueries}
    New sessions:  ${metrics.weekly.newSessions}
    Gap questions: ${metrics.weekly.gapQuestions}

  Health:
    Lint grade:    ${metrics.health.lintGrade}
    Compile lag:   ${metrics.health.compilationLag} source(s)
`);

  if (showHistory) {
    const snapshots = loadSnapshots();
    if (snapshots.length > 0) {
      console.log('  History (last 10 snapshots):');
      const recent = snapshots.slice(-10);
      for (const s of recent) {
        const date = s.timestamp.slice(0, 10);
        const bar = '='.repeat(Math.round(s.score / 5));
        console.log(`    ${date}  ${s.grade} [${bar}] ${s.score}/100  (${s.counts.concepts}c ${s.connections.totalWikilinks}l)`);
      }
      console.log('');
    } else {
      console.log('  No history yet. Snapshots are taken during compile and consolidation.\n');
    }
  }
}
