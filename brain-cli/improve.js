/**
 * improve.js — Self-improvement loop for neuron
 *
 * Combines compile → lint → find gaps → research gaps → recompile
 * in an iterative loop until quality targets are met.
 *
 * Exports:
 *   runImprove(args)  — Parse args and run the improvement loop
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const SCRIPTS = join(KB_DIR, 'scripts');

const { loadConfig } = await import(join(__dirname, 'providers.js'));
const { computeMetrics, getGrade, takeSnapshot } = await import(join(__dirname, 'metrics.js'));

// ── Argument Parsing ──────────────────────────────────────────

export function parseImproveArgs(args) {
  const opts = {
    maxIterations: null,  // null = use config default
    targetGrade: null,    // null = use config default
    dryRun: false,
    maxResearchCalls: null, // null = use config default (hard ceiling on total research() calls this run)
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max-iterations':
        opts.maxIterations = parseInt(args[++i], 10);
        break;
      case '--target-grade':
        opts.targetGrade = args[++i]?.toUpperCase();
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--max-research-calls': {
        const parsed = parseInt(args[++i], 10);
        // Guard against a garbage value (e.g. "not-a-number") producing NaN,
        // which would silently propagate as an unbounded/broken budget.
        opts.maxResearchCalls = Number.isNaN(parsed) ? null : parsed;
        break;
      }
    }
  }

  const config = loadConfig();
  opts.maxIterations = opts.maxIterations || config.improve?.max_iterations || 5;
  opts.targetGrade = opts.targetGrade || config.improve?.target_grade || 'B';

  const gapsToResearch = config.improve?.research_gaps_per_iteration || 2;
  // Cost ceiling: each research() call is a full research+synthesis pipeline (or a
  // 20-minute web-research shell-out when no Tavily key is set). Without a hard cap,
  // maxIterations x gapsToResearch calls can fan out silently. Default cap matches
  // the uncapped worst case (no behavior change unless the operator lowers it).
  // Use ?? (not ||) so an explicit 0 (hard stop) is honored instead of falling
  // through to the config/computed default, which || would silently do since 0 is falsy.
  opts.maxResearchCalls =
    opts.maxResearchCalls ?? config.improve?.max_research_calls ?? (opts.maxIterations * gapsToResearch);

  return opts;
}

// ── Single Iteration ──────────────────────────────────────────

/**
 * Run a single improvement iteration:
 *   compile → lint → check gaps → research top gaps → metrics snapshot
 *
 * @param {number} iterationNum
 * @param {Object} opts - includes researchBudget: { used: number, cap: number } shared
 *   across the whole runImprove() invocation to enforce the global cost ceiling.
 * @returns {{ grade: string, score: number, gaps: string[], improved: boolean }}
 */
async function runIteration(iterationNum, opts) {
  console.log(`\n--- Improvement Iteration ${iterationNum} ---\n`);

  // Step 1: Compile
  console.log('  [1/5] Compiling raw sources...');
  try {
    execFileSync('bash', [join(SCRIPTS, 'compile.sh')], {
      stdio: 'pipe',
      timeout: 300000,
    });
    console.log('  Compilation complete.');
  } catch (e) {
    console.log(`  Compilation: ${e.message?.slice(0, 100)}`);
  }

  // Step 2: Lint
  console.log('  [2/5] Running wiki lint...');
  try {
    execFileSync('bash', [join(SCRIPTS, 'lint.sh')], {
      stdio: 'pipe',
      timeout: 300000,
    });
    console.log('  Lint complete.');
  } catch (e) {
    throw new Error(`Lint step failed — aborting iteration: ${e.message?.slice(0, 200)}`);
  }

  // Step 3: Check for gaps (from lint report)
  console.log('  [3/5] Analyzing gaps...');
  const gaps = readGaps();

  if (gaps.length > 0) {
    console.log(`  Found ${gaps.length} gap(s):`);
    gaps.forEach(g => console.log(`    - ${g}`));
  } else {
    console.log('  No gaps found.');
  }

  // Step 4: Research top gaps
  const config = loadConfig();
  const gapsToResearch = config.improve?.research_gaps_per_iteration || 2;

  if (gaps.length > 0 && !opts.dryRun) {
    const topGaps = gaps.slice(0, gapsToResearch);
    console.log(`  [4/5] Researching top ${topGaps.length} gap(s)...`);

    for (const gap of topGaps) {
      // Hard cost ceiling: stop firing research() calls once the run-wide budget
      // is exhausted, instead of fanning out unboundedly (finding #7).
      if (opts.researchBudget.used >= opts.researchBudget.cap) {
        console.log(
          `    Skipping "${gap}" — research call budget exhausted ` +
          `(${opts.researchBudget.used}/${opts.researchBudget.cap}). ` +
          `Raise with --max-research-calls if intentional.`
        );
        continue;
      }
      opts.researchBudget.used++;
      try {
        const { runResearch } = await import(join(__dirname, 'research.js'));
        // routeToReview: true — improvement-loop research lands at its final path in
        // wiki/concepts/ born trust: unverified; REVIEW.md is the approval surface.
        await runResearch(gap, { routeToReview: true });
      } catch (e) {
        console.log(`    Research failed for "${gap}": ${e.message?.slice(0, 80)}`);
      }
    }
  } else {
    console.log('  [4/5] No gaps to research.');
  }

  // Step 5: Metrics snapshot
  console.log('  [5/5] Taking metrics snapshot...');
  const metrics = computeMetrics();
  const { grade, score } = getGrade(metrics);
  takeSnapshot();

  console.log(`\n  Iteration ${iterationNum} result: Grade ${grade} (${score}/100)`);

  return {
    grade,
    score,
    gaps,
    improved: true,
  };
}

/**
 * Parse research gaps from a lint-report.json string.
 * Deterministic — throws on malformed input rather than silently
 * returning [] (which would falsely signal "brain complete").
 * @param {string} jsonText - contents of lint-report.json
 * @returns {string[]} gap topics, highest priority first
 */
export function parseGaps(jsonText) {
  let report;
  try {
    report = JSON.parse(jsonText);
  } catch {
    throw new Error('lint-report.json is malformed — cannot determine gaps');
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('lint-report.json is malformed — expected a JSON object');
  }
  const gaps = Array.isArray(report.gaps) ? report.gaps : [];
  return gaps
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(g => g.topic)
    .filter(Boolean);
}

/** Read and parse the gap list from the lint-report.json on disk. */
function readGaps() {
  const reportPath = join(KB_DIR, 'wiki', 'lint-report.json');
  if (!existsSync(reportPath)) {
    throw new Error('lint produced no lint-report.json — cannot determine gaps');
  }
  return parseGaps(readFileSync(reportPath, 'utf-8'));
}

// ── Grade Comparison ──────────────────────────────────────────

const GRADE_ORDER = { A: 5, B: 4, C: 3, D: 2, F: 1 };

function gradeAtOrAbove(current, target) {
  return (GRADE_ORDER[current] || 0) >= (GRADE_ORDER[target] || 0);
}

// ── Standalone Mode ───────────────────────────────────────────

async function runStandalone(opts) {
  console.log(`[neuron] Starting improvement loop`);
  console.log(`  Max iterations: ${opts.maxIterations}`);
  console.log(`  Target grade: ${opts.targetGrade}`);
  console.log(`  Dry run: ${opts.dryRun}`);
  console.log(
    `  Research call budget (cost ceiling): up to ${opts.maxResearchCalls} ` +
    `synthesize-tier research call(s) this run — each is a full research+synthesis ` +
    `pipeline (or a ~20min web-research shell-out without TAVILY_API_KEY). ` +
    `Override with --max-research-calls.`
  );

  // Shared across all iterations so the cap applies to the whole run, not per-iteration.
  opts.researchBudget = { used: 0, cap: opts.maxResearchCalls };

  // Take initial snapshot
  const initialMetrics = computeMetrics();
  const initialGrade = getGrade(initialMetrics);
  console.log(`\n  Starting grade: ${initialGrade.grade} (${initialGrade.score}/100)`);

  if (gradeAtOrAbove(initialGrade.grade, opts.targetGrade)) {
    console.log(`  Already at or above target grade ${opts.targetGrade}. Nothing to do.`);
    return;
  }

  const seenGaps = new Set();
  for (let i = 1; i <= opts.maxIterations; i++) {
    const result = await runIteration(i, opts);

    if (gradeAtOrAbove(result.grade, opts.targetGrade)) {
      console.log(`\n=== Target grade ${opts.targetGrade} achieved! Final: ${result.grade} (${result.score}/100) ===`);
      return;
    }

    if (result.gaps.length === 0) {
      console.log(`\n=== No more gaps to research. Final: ${result.grade} (${result.score}/100) ===`);
      return;
    }

    // Saturation: if every gap this iteration was already seen, stop.
    const allSeen = result.gaps.every(g => seenGaps.has(g));
    if (allSeen) {
      console.log(`\n=== Saturated — gaps recurred without progress. Final: ${result.grade} (${result.score}/100) ===`);
      return;
    }
    result.gaps.forEach(g => seenGaps.add(g));

    if (i < opts.maxIterations) {
      console.log(`\n  Continuing to iteration ${i + 1}...`);
    }
  }

  const finalMetrics = computeMetrics();
  const finalGrade = getGrade(finalMetrics);
  console.log(`\n=== Max iterations reached. Final: ${finalGrade.grade} (${finalGrade.score}/100) ===`);
  console.log(`  Started at: ${initialGrade.grade} (${initialGrade.score}/100)`);
  console.log(`  Improved by: ${finalGrade.score - initialGrade.score} points`);
}

// ── Public API ────────────────────────────────────────────────

export async function runImprove(args) {
  const opts = parseImproveArgs(args);
  await runStandalone(opts);
}
