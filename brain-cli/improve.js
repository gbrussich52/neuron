/**
 * improve.js — Self-improvement loop for neuron
 *
 * Combines compile → lint → find gaps → research gaps → recompile
 * in an iterative loop until quality targets are met.
 *
 * Exports:
 *   runImprove(args)  — Parse args and run the improvement loop
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const SCRIPTS = join(KB_DIR, 'scripts');

const { loadConfig } = await import(join(__dirname, 'providers.js'));
const { computeMetrics, getGrade, takeSnapshot } = await import(join(__dirname, 'metrics.js'));

// Step timeouts. Compile is the long pole: one LLM pass that reads every
// uncompiled source and writes a summary plus concept articles for each, so it
// scales with batch size. The old shared 5-minute ceiling killed a *successful*
// compile of 5 documents mid-flight — the wiki files landed anyway and the loop
// still recorded a failure, which is a guard that silently discards real work.
// Lint is a single bounded pass over the existing wiki and stays tighter.
const COMPILE_TIMEOUT_MS = Number(process.env.NEURON_COMPILE_TIMEOUT_MS) || 20 * 60 * 1000;
const LINT_TIMEOUT_MS = Number(process.env.NEURON_LINT_TIMEOUT_MS) || 10 * 60 * 1000;

/**
 * Render a step failure so a timeout is never mistaken for a crash.
 * A bare "spawnSync bash ETIMEDOUT" reads like the script failed, when it
 * actually means we stopped waiting — a distinction that decides whether the
 * fix is "debug the script" or "raise the ceiling".
 */
function describeStepFailure(err, timeoutMs) {
  if (err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM') {
    const mins = Math.round(timeoutMs / 60000);
    return `timed out after ${mins}m — the step may still have completed; check the wiki and raise the timeout if this recurs`;
  }
  return err?.message?.slice(0, 200) || String(err);
}

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

// ── Vault state refresh (pre-gate) ────────────────────────────

const LINT_REPORT = join(KB_DIR, 'wiki', 'lint-report.json');

/**
 * Decide whether the lint report needs regenerating.
 *
 * Pure so it can be tested without a vault. Both arguments are epoch-ms.
 * `null` report mtime means "no report on disk".
 *
 * @param {number|null} reportMtime - mtime of lint-report.json
 * @param {number} newestWikiMtime  - newest mtime of any wiki .md
 */
export function lintNeedsRefresh(reportMtime, newestWikiMtime) {
  if (reportMtime === null || !Number.isFinite(reportMtime)) return true;
  return newestWikiMtime > reportMtime;
}

/**
 * Newest mtime (ms) of any wiki .md file.
 *
 * lint-report.md is excluded: it is lint's own output, so counting it would
 * make every lint run look like a wiki change and re-trigger the next one.
 * An unreadable tree returns Infinity — failing toward running a lint we did
 * not need is recoverable; failing toward skipping one we did need is the bug
 * this whole function exists to prevent.
 */
function newestWikiMtime() {
  const wikiDir = join(KB_DIR, 'wiki');
  if (!existsSync(wikiDir)) return 0;
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md') || entry.name === 'lint-report.md') continue;
      const m = statSync(full).mtimeMs;
      if (m > newest) newest = m;
    }
  };
  try { walk(wikiDir); } catch { return Infinity; }
  return newest;
}

/**
 * Bring on-disk vault state up to date so it can be graded truthfully.
 *
 * Compile and lint used to live ONLY inside runIteration, i.e. below the
 * target-grade gate in runStandalone. A vault already at target returned before
 * either ran, with two silent consequences:
 *
 *   1. Newly-dropped raw sources were never compiled. The compile-lag penalty
 *      is 4 points per uncompiled source (capped at 20), so 1-4 new sources
 *      could not by themselves drag a healthy vault under target — they just
 *      sat in raw/ indefinitely. Only a batch of 5+ tripped the gate.
 *   2. lint-report.json froze at its last write while still contributing 15
 *      points to the composite. The gate was reading a number that only the
 *      code path it skipped could ever refresh.
 *
 * compile.sh returns before its LLM call when nothing is uncompiled, so running
 * it unconditionally is free. lint.sh always calls the LLM, so it re-runs only
 * when the wiki actually changed — strictly cheaper than the unconditional lint
 * every iteration used to pay.
 *
 * @param {{ label?: string, strictLint?: boolean }} [options]
 *   strictLint throws on lint failure (iteration semantics); otherwise the
 *   error is returned for the caller to act on.
 * @returns {{ linted: boolean, lintError: string|null }}
 */
function refreshVaultState({ label = 'pre', strictLint = false } = {}) {
  const result = { linted: false, lintError: null };

  console.log(`  [${label}] Compiling raw sources...`);
  try {
    execFileSync('bash', [join(SCRIPTS, 'compile.sh')], {
      stdio: 'pipe',
      timeout: COMPILE_TIMEOUT_MS,
    });
    console.log('  Compilation complete.');
  } catch (e) {
    console.log(`  Compilation: ${describeStepFailure(e, COMPILE_TIMEOUT_MS)}`);
  }

  const reportMtime = existsSync(LINT_REPORT) ? statSync(LINT_REPORT).mtimeMs : null;
  if (!lintNeedsRefresh(reportMtime, newestWikiMtime())) {
    console.log(`  [${label}] Lint report already current — skipping lint (saves one LLM pass).`);
    return result;
  }

  console.log(`  [${label}] Wiki changed since last lint — refreshing lint report...`);
  try {
    execFileSync('bash', [join(SCRIPTS, 'lint.sh')], {
      stdio: 'pipe',
      timeout: LINT_TIMEOUT_MS,
    });
    result.linted = true;
    console.log('  Lint complete.');
  } catch (e) {
    result.lintError = describeStepFailure(e, LINT_TIMEOUT_MS);
    if (strictLint) throw new Error(`Lint step failed — aborting iteration: ${result.lintError}`);
    console.log(`  Lint: ${result.lintError}`);
  }
  return result;
}

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

  // Steps 1-2: Compile + lint. Shared with the pre-gate refresh so both paths
  // apply the same staleness rule; after research writes new wiki files the
  // report is stale by definition, so the lint that feeds step 3 still runs.
  refreshVaultState({ label: `${iterationNum}:1-2/5`, strictLint: true });

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

  // Tracks whether step 4 actually wrote anything, so step 5 only pays for a
  // re-lint when there is new output to score.
  let researchedThisIteration = false;

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
        researchedThisIteration = true;
      } catch (e) {
        console.log(`    Research failed for "${gap}": ${e.message?.slice(0, 80)}`);
      }
    }
  } else {
    console.log('  [4/5] No gaps to research.');
  }

  // Step 5: Metrics snapshot
  //
  // Re-lint FIRST. Steps 1-2 lint the vault as it was BEFORE step 4 wrote new
  // articles, so grading here without a refresh scores a state that predates
  // this iteration's own work. That is what produced "Saturated — gaps recurred
  // without progress": the loop could not observe anything it did, so the score
  // never moved and the same gaps resurfaced every round.
  //
  // This was uneconomic when lint was a multi-minute nested-LLM call; lint-core.py
  // is deterministic and runs in ~0.03s, so refreshing here is effectively free.
  if (researchedThisIteration) {
    console.log('  [5/5] Re-linting to score this iteration\'s output...');
    refreshVaultState({ label: `${iterationNum}:5/5`, strictLint: false });
  }
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

  // Refresh on-disk state BEFORE grading it. The gate below decides whether any
  // work happens at all, so grading unrefreshed state let a healthy-looking
  // vault skip compiling sources it had never seen. See refreshVaultState().
  const refresh = refreshVaultState({ label: 'pre' });

  // Take initial snapshot
  const initialMetrics = computeMetrics();
  const initialGrade = getGrade(initialMetrics);
  console.log(`\n  Starting grade: ${initialGrade.grade} (${initialGrade.score}/100)`);

  if (refresh.lintError) {
    // Grade is computed partly from the lint report; if we could not refresh it,
    // the score is not trustworthy enough to authorise an early exit. Fall into
    // the loop so the failure surfaces via a non-zero exit instead of a green night.
    console.log(`  Lint could not be refreshed — not trusting the grade to skip the run.`);
  } else if (gradeAtOrAbove(initialGrade.grade, opts.targetGrade)) {
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
