/**
 * improve.js — Self-improvement loop for neuron
 *
 * Combines compile → lint → find gaps → research gaps → recompile
 * in an iterative loop until quality targets are met.
 *
 * Two modes:
 *   1. Ralph Loop mode (default) — creates .claude/ralph-loop.local.md
 *      state, leverages the Ralph Loop Stop hook for re-injection
 *   2. Standalone mode (--standalone) — runs the loop internally via
 *      Node.js for cron/CI/LaunchAgent contexts
 *
 * Exports:
 *   runImprove(args)  — Parse args and run the improvement loop
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const RALPH_STATE = join(process.cwd(), '.claude', 'ralph-loop.local.md');
const SCRIPTS = join(KB_DIR, 'scripts');

const { loadConfig } = await import(join(__dirname, 'providers.js'));
const { computeMetrics, getGrade, takeSnapshot } = await import(join(__dirname, 'metrics.js'));

// ── Argument Parsing ──────────────────────────────────────────

function parseImproveArgs(args) {
  const opts = {
    standalone: false,
    maxIterations: null,  // null = use config default
    targetGrade: null,    // null = use config default
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--standalone':
        opts.standalone = true;
        break;
      case '--max-iterations':
        opts.maxIterations = parseInt(args[++i], 10);
        break;
      case '--target-grade':
        opts.targetGrade = args[++i]?.toUpperCase();
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
    }
  }

  const config = loadConfig();
  opts.maxIterations = opts.maxIterations || config.improve?.max_iterations || 5;
  opts.targetGrade = opts.targetGrade || config.improve?.target_grade || 'B';

  return opts;
}

// ── Single Iteration ──────────────────────────────────────────

/**
 * Run a single improvement iteration:
 *   compile → lint → check gaps → research top gaps → metrics snapshot
 *
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
    console.log(`  Lint: ${e.message?.slice(0, 100)}`);
  }

  // Step 3: Check for gaps (from lint report)
  console.log('  [3/5] Analyzing gaps...');
  const gaps = extractGapsFromLintReport();

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
      try {
        const { runResearch } = await import(join(__dirname, 'research.js'));
        await runResearch(gap);
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
 * Extract research gaps from the lint report.
 * Looks for "Suggested new articles" or "gaps" sections.
 */
function extractGapsFromLintReport() {
  const lintReport = join(KB_DIR, 'wiki', 'lint-report.md');
  if (!existsSync(lintReport)) return [];

  const content = readFileSync(lintReport, 'utf-8');
  const gaps = [];

  // Look for suggested topics/articles
  const suggestedMatch = content.match(/(?:suggest|new article|topic|gap|explore)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\Z)/gi);
  if (suggestedMatch) {
    for (const section of suggestedMatch) {
      const lines = section.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-*]\s*/, '').replace(/\[\[|\]\]/g, '').trim();
        if (cleaned.length > 10 && cleaned.length < 200 && !cleaned.startsWith('#')) {
          gaps.push(cleaned);
        }
      }
    }
  }

  // Also check for "needs human attention" items
  const attentionMatch = content.match(/needs?\s+(?:human\s+)?attention[^\n]*\n([\s\S]*?)(?=\n##|\n---|\Z)/gi);
  if (attentionMatch) {
    for (const section of attentionMatch) {
      const lines = section.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned.length > 10 && cleaned.length < 200 && !cleaned.startsWith('#')) {
          gaps.push(cleaned);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(gaps)].slice(0, 10);
}

// ── Grade Comparison ──────────────────────────────────────────

const GRADE_ORDER = { A: 5, B: 4, C: 3, D: 2, F: 1 };

function gradeAtOrAbove(current, target) {
  return (GRADE_ORDER[current] || 0) >= (GRADE_ORDER[target] || 0);
}

// ── Ralph Loop Mode ───────────────────────────────────────────

function setupRalphLoop(opts) {
  const stateDir = dirname(RALPH_STATE);
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  const prompt = `Run one neuron self-improvement iteration:
1. Run: bash ${join(SCRIPTS, 'compile.sh')}
2. Run: bash ${join(SCRIPTS, 'lint.sh')}
3. Read ${join(KB_DIR, 'wiki', 'lint-report.md')} for gaps
4. For each gap (max ${opts.maxIterations} per iteration), run: node ${join(__dirname, 'research.js')} "<gap topic>"
5. Run: node ${join(__dirname, 'metrics.js')} to check Brain Score
6. If Brain Score >= ${opts.targetGrade}, output: <promise>BRAIN_SCORE_TARGET_MET</promise>
7. Otherwise, report current grade and what gaps remain.`;

  const state = [
    '---',
    'active: true',
    'iteration: 1',
    `session_id: ${Date.now()}`,
    `max_iterations: ${opts.maxIterations}`,
    `completion_promise: "BRAIN_SCORE_TARGET_MET"`,
    `started_at: ${new Date().toISOString()}`,
    '---',
    '',
    prompt,
  ].join('\n');

  writeFileSync(RALPH_STATE, state);
  console.log(`[neuron] Ralph Loop configured.`);
  console.log(`  Max iterations: ${opts.maxIterations}`);
  console.log(`  Target grade: ${opts.targetGrade}`);
  console.log(`  Completion promise: BRAIN_SCORE_TARGET_MET`);
  console.log(`  State file: ${RALPH_STATE}`);
  console.log(`\n  The loop will start when Claude exits this session.`);
  console.log(`  Cancel with: /cancel-ralph`);
}

// ── Standalone Mode ───────────────────────────────────────────

async function runStandalone(opts) {
  console.log(`[neuron] Starting standalone improvement loop`);
  console.log(`  Max iterations: ${opts.maxIterations}`);
  console.log(`  Target grade: ${opts.targetGrade}`);
  console.log(`  Dry run: ${opts.dryRun}`);

  // Take initial snapshot
  const initialMetrics = computeMetrics();
  const initialGrade = getGrade(initialMetrics);
  console.log(`\n  Starting grade: ${initialGrade.grade} (${initialGrade.score}/100)`);

  if (gradeAtOrAbove(initialGrade.grade, opts.targetGrade)) {
    console.log(`  Already at or above target grade ${opts.targetGrade}. Nothing to do.`);
    return;
  }

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

  if (opts.standalone) {
    await runStandalone(opts);
  } else {
    setupRalphLoop(opts);
  }
}
