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

  // Research reports generated
  const researchReports = queries.filter(q =>
    q.content.includes('type: research-report') || q.content.includes('type: deep-research-report')
  ).length;

  // "Related" sections added by connection finder
  const articlesWithRelated = allArticles.filter(a => a.content.includes('## Related')).length;

  // Lint health — prefer the structured JSON report, fall back to .md
  // lintScore (0-100) is read alongside the letter: bucketing a 0-100 score into
  // five letters throws away the resolution the grade needs to move at all.
  let lintGrade = 'N/A';
  let lintScore = null;
  const lintJson = join(KB_DIR, 'wiki', 'lint-report.json');
  const lintMd = join(KB_DIR, 'wiki', 'lint-report.md');
  if (existsSync(lintJson)) {
    try {
      const parsed = JSON.parse(readFileSync(lintJson, 'utf-8'));
      if (parsed.grade) lintGrade = String(parsed.grade).toUpperCase();
      if (Number.isFinite(parsed.score)) lintScore = Math.max(0, Math.min(100, parsed.score));
    } catch { /* metrics is a display path — degrade to the .md grade rather than throw */ }
  }
  if (lintGrade === 'N/A' && existsSync(lintMd)) {
    const lintContent = readFileSync(lintMd, 'utf-8');
    const gradeMatch = lintContent.match(/(?:grade|score|health)[:\s]*([A-F])/i);
    if (gradeMatch) lintGrade = gradeMatch[1].toUpperCase();
  }

  // Delta tracking — compare against last snapshot
  const snapshots = loadSnapshots();
  const lastSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const deltas = lastSnapshot ? {
    conceptsDelta: concepts.length - (lastSnapshot.counts?.concepts || 0),
    linksDelta: totalLinks - (lastSnapshot.connections?.totalWikilinks || 0),
    contradictionsDelta: contradictions - (lastSnapshot.connections?.contradictions || 0),
    queriesDelta: queries.length - (lastSnapshot.counts?.queries || 0),
  } : null;

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
      articlesWithRelated,
    },
    weekly: {
      newConcepts: newConceptsThisWeek,
      newQueries: newQueriesThisWeek,
      newSessions: newSessionsThisWeek,
      gapQuestions,
      researchReports,
    },
    health: {
      lintGrade,
      lintScore,
      compilationLag: uncompiledCount,
    },
    deltas,
  };
}

// ── Composite Grade ───────────────────────────────────────────

/**
 * Calculate composite grade A-F based on metrics.
 *
 * Scoring (0-100) — CORRECTNESS-DOMINANT, rebalanced 2026-08-01:
 *   - Lint health:        up to 60 points (uses the 0-100 lint score directly)
 *   - Link density:       up to 15 points (2+ links/article = 15)
 *   - Compilation lag:    up to 15 points (0 uncompiled = 15)
 *   - Content volume:     up to 10 points (20+ articles = 10)
 *   - Weekly activity:    REMOVED
 *
 * WHY IT CHANGED
 *   The previous weights were content 20 / links 25 / weekly 20 / lag 20 /
 *   lint 15. On 2026-08-01 the vault scored 89 = B with FOUR components maxed
 *   and lint at D. Because lint capped at 15 and F only cost 15 more points, a
 *   total lint failure still scored 85 — comfortably above the B target the
 *   improve loop gates on. The loop therefore printed "Already at or above
 *   target grade B. Nothing to do." every night while 15 broken wikilinks and
 *   11 missing articles sat unaddressed, and the vault froze for five weeks
 *   while reporting healthy.
 *
 *   Weekly activity is deleted outright: "files touched this week" measures
 *   motion, not quality, and awarded a full 20 points during any active week —
 *   which is precisely when a defect is most likely to have just been
 *   introduced. A correct, finished vault that nobody edited was penalised;
 *   a broken one being churned was rewarded.
 *
 *   Correctness now decides the grade. Everything else can only modulate it:
 *   with all three remaining components maxed (40), a vault still needs a lint
 *   score of ~58 to reach B and ~83 to reach A.
 */
export function getGrade(metrics) {
  let score = 0;

  // Lint health (0-60) — the dominant term.
  // Prefer the numeric score; fall back to letter midpoints for older reports
  // that predate lintScore, and to a neutral 50 when lint has never run.
  const letterMidpoint = { A: 95, B: 82, C: 67, D: 50, F: 20, 'N/A': 50 };
  const lintPct = Number.isFinite(metrics.health.lintScore)
    ? metrics.health.lintScore
    : (letterMidpoint[metrics.health.lintGrade] ?? 50);
  score += (lintPct / 100) * 60;

  // Link density (0-15): 2+ links/article = full marks
  score += Math.min(15, metrics.connections.linkDensity * 7.5);

  // Compilation lag (0-15): full points for 0 uncompiled, decreasing
  score += 15 - Math.min(15, metrics.health.compilationLag * 3);

  // Content volume (0-10): a vault needs some substance, but having files is
  // not quality — this is a floor check, not a growth incentive.
  const contentCount = metrics.counts.concepts + metrics.counts.summaries;
  score += Math.min(10, contentCount * 0.5);

  // Round off float drift; clamp defensively.
  score = Math.max(0, Math.min(100, Math.round(score)));

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

  const d = metrics.deltas;
  const delta = (val) => val > 0 ? ` (+${val})` : val < 0 ? ` (${val})` : '';

  console.log(`
=== Neuron Brain Score ===

  Grade: ${grade} [${gradeBar}] ${score}/100

  Content:
    Concepts:      ${metrics.counts.concepts}${d ? delta(d.conceptsDelta) : ''}
    Summaries:     ${metrics.counts.summaries}
    Queries:       ${metrics.counts.queries}${d ? delta(d.queriesDelta) : ''}
    Sessions:      ${metrics.counts.sessions}
    Uncompiled:    ${metrics.counts.uncompiled}

  Connections:
    Total links:   ${metrics.connections.totalWikilinks}${d ? delta(d.linksDelta) : ''}
    Per article:   ${metrics.connections.linkDensity}
    Cross-linked:  ${metrics.connections.articlesWithRelated} articles with Related section
    Contradicts:   ${metrics.connections.contradictions}${d ? delta(d.contradictionsDelta) : ''}
    Supports:      ${metrics.connections.supports}

  This Week:
    New concepts:  ${metrics.weekly.newConcepts}
    New queries:   ${metrics.weekly.newQueries}
    New sessions:  ${metrics.weekly.newSessions}
    Gap questions: ${metrics.weekly.gapQuestions}
    Research rpts: ${metrics.weekly.researchReports}

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
