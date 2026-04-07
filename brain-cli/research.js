/**
 * research.js — Autonomous web research for neuron
 *
 * Karpathy's vision: "Every question could spawn a team of LLMs to automate
 * the whole thing: iteratively construct an ephemeral wiki, lint it, loop,
 * then write a full report."
 *
 * Pipeline:
 *   1. Decompose topic into 3-5 research steps
 *   2. Execute Tavily web searches for each step
 *   3. Create raw source files with frontmatter
 *   4. Auto-compile into wiki
 *   5. Run connection finder on new articles
 *   6. Generate synthesis report in wiki/queries/
 *
 * Exports:
 *   runResearch(topic)  — Full autonomous research pipeline
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const RAW_DIR = join(KB_DIR, 'raw');
const WIKI_DIR = join(KB_DIR, 'wiki');

const { llmCall, loadConfig } = await import(join(__dirname, 'providers.js'));

// ── Tavily Search ─────────────────────────────────────────────

const TAVILY_API_URL = 'https://api.tavily.com/search';

async function tavilySearch(query, maxResults = 3) {
  const config = loadConfig();
  const apiKey = process.env[config.research.tavily_api_key_env || 'TAVILY_API_KEY'];

  if (!apiKey) {
    throw new Error(
      'Missing TAVILY_API_KEY. Set it in your environment to enable web research.\n' +
      '  export TAVILY_API_KEY=tvly-...\n' +
      '  Get a key at https://tavily.com'
    );
  }

  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'advanced',
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    answer: data.answer || '',
    results: (data.results || []).map(r => ({
      title: r.title || 'Untitled',
      content: r.content || '',
      url: r.url || '',
      score: r.score || 0,
      source: extractDomain(r.url),
    })),
    followUp: data.follow_up_questions || [],
  };
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return 'unknown'; }
}

// ── Research Pipeline ─────────────────────────────────────────

/**
 * Decompose a topic into research steps using LLM.
 */
async function planResearch(topic) {
  const config = loadConfig();
  const maxSteps = config.research?.max_steps || 5;

  const plan = await llmCall({
    prompt: `You are a research planner. Decompose this research topic into ${maxSteps} specific search queries.

Topic: ${topic}

Output EXACTLY ${maxSteps} lines, one search query per line. Each query should be specific and searchable.
Focus on different angles: facts, statistics, recent developments, expert opinions, counterarguments.

Example output for "PFAS water contamination":
PFAS contamination levels drinking water 2025 statistics
PFAS health effects long-term exposure research studies
PFAS water filtration removal methods effectiveness comparison
PFAS EPA regulations new standards 2025
PFAS class action lawsuits settlements water utilities

Output your ${maxSteps} search queries (one per line, no numbering or bullets):`,
    tier: 'classify',
    maxTokens: 500,
  });

  return plan
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 10 && !line.startsWith('#') && !line.startsWith('-'))
    .slice(0, maxSteps);
}

/**
 * Execute searches and create raw source files.
 */
async function executeSearches(queries, topic) {
  const sourceFiles = [];
  const allResults = [];
  const timestamp = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
  const topicSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`  Step ${i + 1}/${queries.length}: ${query}`);

    try {
      const response = await tavilySearch(query, 3);
      allResults.push({ query, ...response });

      // Create raw source file for this search
      const fileName = `${timestamp}_research_${topicSlug}_step${i + 1}.md`;
      const filePath = join(RAW_DIR, fileName);

      const sourceContent = [
        '---',
        'classification: PRIVATE',
        `source_url: tavily-search://${encodeURIComponent(query)}`,
        `research_topic: "${topic}"`,
        `search_query: "${query}"`,
        `ingested: ${new Date().toISOString()}`,
        `tags: [research, auto-generated, ${topicSlug}]`,
        'type: research',
        'compiled: false',
        '---',
        '',
        `# Research: ${query}`,
        '',
        response.answer ? `## Summary\n${response.answer}\n` : '',
        '## Sources',
        '',
        ...response.results.map(r =>
          `### ${r.title}\n**Source:** ${r.url} (${r.source})\n\n${r.content}\n`
        ),
        response.followUp.length > 0
          ? `## Follow-up Questions\n${response.followUp.map(q => `- ${q}`).join('\n')}\n`
          : '',
      ].filter(Boolean).join('\n');

      writeFileSync(filePath, sourceContent);
      sourceFiles.push(filePath);

      // Rate limiting between searches
      if (i < queries.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  return { sourceFiles, allResults };
}

/**
 * Generate a synthesis report from all search results.
 */
async function synthesizeReport(topic, allResults, sourceFiles) {
  const timestamp = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
  const topicSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);

  // Compile source summaries for the LLM
  const sourceSummary = allResults
    .map((r, i) => {
      const resultTexts = r.results
        .map(res => `- ${res.title}: ${res.content.slice(0, 200)}`)
        .join('\n');
      return `### Step ${i + 1}: ${r.query}\n${r.answer || '(no summary)'}\n${resultTexts}`;
    })
    .join('\n\n');

  const report = await llmCall({
    prompt: `You are a research synthesis agent. Write a comprehensive report from these search results.

## Research Topic
${topic}

## Search Results
${sourceSummary}

## Instructions
Write a thorough research report with:
1. Executive summary (3-5 sentences)
2. Key findings (organized by theme, not by search query)
3. Data points and statistics (with source attribution)
4. Contradictions or gaps in the research
5. Actionable next steps or questions for deeper research

Use [[wikilinks]] when referencing concepts that might exist in a knowledge base.
Be specific. Include numbers, dates, and source names. Do NOT include generic filler.

Output only the report content (no frontmatter).`,
    tier: 'synthesize',
    maxTokens: 4000,
  });

  // Write the report
  const reportFile = join(WIKI_DIR, 'queries', `${timestamp}_research_${topicSlug}.md`);
  const reportContent = [
    '---',
    'classification: PRIVATE',
    'type: research-report',
    `topic: "${topic}"`,
    `generated: ${new Date().toISOString()}`,
    `sources_count: ${allResults.reduce((sum, r) => sum + r.results.length, 0)}`,
    `search_steps: ${allResults.length}`,
    `tags: [research, auto-generated, ${topicSlug}]`,
    '---',
    '',
    `# Research Report: ${topic}`,
    '',
    report,
    '',
    '## Raw Sources',
    ...sourceFiles.map(f => `- ${basename(f)}`),
    '',
  ].join('\n');

  writeFileSync(reportFile, reportContent);
  return reportFile;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Run the full autonomous research pipeline.
 */
export async function runResearch(topic) {
  if (!topic) {
    console.log('Usage: neuron research <topic>');
    console.log('Example: neuron research "PFAS water filtration regulations"');
    return;
  }

  console.log(`[neuron] Starting autonomous research: "${topic}"\n`);
  const startTime = Date.now();

  // Step 1: Plan research
  console.log('  Planning research steps...');
  const queries = await planResearch(topic);
  console.log(`  Planned ${queries.length} search steps\n`);

  // Step 2: Execute searches
  console.log('  Executing web searches...');
  const { sourceFiles, allResults } = await executeSearches(queries, topic);
  const totalSources = allResults.reduce((sum, r) => sum + r.results.length, 0);
  console.log(`\n  Found ${totalSources} sources across ${queries.length} searches\n`);

  if (sourceFiles.length === 0) {
    console.log('  No sources found. Check your TAVILY_API_KEY and try a different topic.');
    return;
  }

  // Step 3: Generate synthesis report
  console.log('  Synthesizing report...');
  const reportFile = await synthesizeReport(topic, allResults, sourceFiles);
  console.log(`  Report: ${basename(reportFile)}\n`);

  // Step 4: Auto-compile (if enabled)
  const config = loadConfig();
  if (config.research?.auto_compile !== false) {
    console.log('  Compiling new sources into wiki...');
    try {
      execFileSync('bash', [join(KB_DIR, 'scripts', 'compile.sh')], {
        stdio: 'pipe',
        timeout: 300000,
      });
      console.log('  Compilation complete.\n');
    } catch (e) {
      console.log(`  Compilation skipped: ${e.message}\n`);
    }
  }

  // Step 5: Run connection finder (if enabled and semantic index exists)
  if (config.research?.auto_connect !== false && config.features?.semantic_search) {
    console.log('  Finding connections...');
    try {
      const { findConnections } = await import(join(__dirname, 'connections.js'));
      await findConnections(reportFile, { auto: true, quiet: true });
      console.log('  Connections applied.\n');
    } catch (e) {
      console.log(`  Connection finding skipped: ${e.message}\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Done in ${elapsed}s. ${sourceFiles.length} sources ingested, report generated.`);
  console.log(`  Report: ${reportFile}`);
  console.log(`  Run \`neuron compile\` if auto-compile was skipped.`);

  return { reportFile, sourceFiles, allResults };
}

// ── Deep Research (Karpathy Auto-Research Loop) ───────────────

/**
 * Iterative deep research on a single topic.
 *
 * This is the full Karpathy vision: research → compile wiki → lint →
 * identify what's still missing about THIS topic → research those gaps →
 * recompile → repeat until the topic is thoroughly covered.
 *
 * Each iteration:
 *   1. Research the topic (or remaining gaps from previous iteration)
 *   2. Compile new sources into wiki
 *   3. Lint the wiki for this topic area
 *   4. Ask LLM: "What's still missing or weak about [topic]?"
 *   5. If gaps remain and iterations left → loop with gap-focused queries
 *   6. Final synthesis: merge all iteration reports into one comprehensive report
 *
 * @param {string} topic - The research topic
 * @param {Object} [opts]
 * @param {number} [opts.maxIterations=3] - Max research iterations
 * @param {number} [opts.maxStepsPerIteration=5] - Search steps per iteration
 * @param {boolean} [opts.standalone=true] - Run internally (vs Ralph Loop)
 */
export async function runDeepResearch(topic, opts = {}) {
  const {
    maxIterations = 3,
    standalone = true,
  } = opts;

  if (!topic) {
    console.log('Usage: neuron deep-research <topic>');
    console.log('       neuron deep-research "PFAS remediation" --max-iterations 5');
    console.log('');
    console.log('Iteratively researches a topic until thoroughly covered.');
    console.log('Each iteration: search → compile → lint → find gaps → repeat.');
    return;
  }

  // If not standalone, set up Ralph Loop
  if (!standalone) {
    return setupDeepResearchRalph(topic, maxIterations);
  }

  console.log(`\n[neuron] Deep Research: "${topic}"`);
  console.log(`  Max iterations: ${maxIterations}`);
  console.log(`  Mode: Karpathy auto-research loop\n`);

  const startTime = Date.now();
  const allReports = [];
  let currentTopic = topic;
  let totalSources = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ITERATION ${iteration}/${maxIterations}: ${currentTopic}`);
    console.log(`${'='.repeat(60)}\n`);

    // Step 1: Research (first iteration = broad, subsequent = gap-focused)
    const result = await runResearch(currentTopic);
    if (!result || !result.sourceFiles || result.sourceFiles.length === 0) {
      console.log(`  No results for "${currentTopic}". Stopping.`);
      break;
    }
    totalSources += result.sourceFiles.length;
    allReports.push(result.reportFile);

    // Step 2: Compile is already handled inside runResearch (auto_compile)

    // Step 3: Analyze what's still missing about this specific topic
    console.log('\n  Analyzing coverage gaps...');
    const gaps = await findTopicGaps(topic, iteration);

    if (gaps.length === 0) {
      console.log('  Topic thoroughly covered. No significant gaps remain.');
      break;
    }

    console.log(`  Found ${gaps.length} gap(s):`);
    gaps.forEach((g, i) => console.log(`    ${i + 1}. ${g}`));

    if (iteration < maxIterations) {
      // Pick the most important gap as the next iteration's focus
      currentTopic = `${topic}: ${gaps[0]}`;
      console.log(`\n  Next iteration will focus on: "${currentTopic}"`);
    }
  }

  // Step 4: Final synthesis — merge all iteration reports
  console.log(`\n${'='.repeat(60)}`);
  console.log('  FINAL SYNTHESIS');
  console.log(`${'='.repeat(60)}\n`);

  const finalReport = await synthesizeFinalReport(topic, allReports);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n[neuron] Deep research complete.`);
  console.log(`  Topic:       ${topic}`);
  console.log(`  Iterations:  ${allReports.length}`);
  console.log(`  Sources:     ${totalSources}`);
  console.log(`  Time:        ${elapsed}s`);
  console.log(`  Final report: ${finalReport}`);
}

/**
 * Ask the LLM what's still missing about a topic based on current wiki state.
 */
async function findTopicGaps(topic, iteration) {
  const gapAnalysis = await llmCall({
    prompt: `You are a research gap analyst. Given a topic and the current state of a knowledge base, identify what's still missing.

## Topic
${topic}

## Context
This is iteration ${iteration} of a deep research loop. The knowledge base at ${KB_DIR}/wiki/ has been updated with research so far.

Read the wiki index at ${WIKI_DIR}/index.md and any concept articles related to "${topic}".

## Instructions
Identify 2-3 specific gaps — things that are:
1. NOT yet covered or only superficially mentioned
2. Important for a thorough understanding of "${topic}"
3. Researchable via web search

Do NOT repeat what's already well-covered. Focus on what's MISSING.

## Output format (one gap per line, no numbering or bullets, just the gap description)
Example:
cost comparison of different PFAS filtration technologies
regulatory timeline for EPA PFAS limits by state
long-term health outcome studies for low-level PFAS exposure

Output 2-3 gaps (one per line):`,
    tier: 'compile',
    tools: ['Read', 'Glob', 'Grep'],
    maxTokens: 500,
  });

  return gapAnalysis
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 15 && line.length < 200 && !line.startsWith('#'));
}

/**
 * Merge all iteration reports into one comprehensive final report.
 */
async function synthesizeFinalReport(topic, reportFiles) {
  const timestamp = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
  const topicSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);

  // Read all iteration reports
  const reports = reportFiles
    .filter(f => existsSync(f))
    .map((f, i) => {
      const content = readFileSync(f, 'utf-8');
      // Strip frontmatter
      const body = content.replace(/^---[\s\S]*?---\s*/, '');
      return `### Iteration ${i + 1}\n${body}`;
    })
    .join('\n\n---\n\n');

  const finalContent = await llmCall({
    prompt: `You are a research synthesis agent. Merge these ${reportFiles.length} iteration reports into one comprehensive, well-organized final report.

## Topic
${topic}

## Iteration Reports
${reports.slice(0, 15000)}

## Instructions
Write one unified report that:
1. Opens with a comprehensive executive summary (5-8 sentences)
2. Organizes all findings by THEME (not by iteration)
3. Eliminates redundancy — each fact appears once, in its best context
4. Preserves all specific data points, statistics, and source citations
5. Highlights contradictions and unresolved questions
6. Ends with actionable conclusions and recommended next steps
7. Uses [[wikilinks]] for cross-references

This should read as a single authoritative report, not as a collection of iterations.
Output only the report content (no frontmatter).`,
    tier: 'synthesize',
    maxTokens: 6000,
  });

  const finalFile = join(WIKI_DIR, 'queries', `${timestamp}_deep_research_${topicSlug}.md`);
  const finalDoc = [
    '---',
    'classification: PRIVATE',
    'type: deep-research-report',
    `topic: "${topic}"`,
    `generated: ${new Date().toISOString()}`,
    `iterations: ${reportFiles.length}`,
    `tags: [deep-research, auto-generated, ${topicSlug}]`,
    '---',
    '',
    `# Deep Research: ${topic}`,
    '',
    finalContent,
    '',
    '## Iteration Reports',
    ...reportFiles.map((f, i) => `${i + 1}. ${basename(f)}`),
    '',
  ].join('\n');

  writeFileSync(finalFile, finalDoc);
  return finalFile;
}

/**
 * Set up Ralph Loop for deep research (non-standalone mode).
 */
function setupDeepResearchRalph(topic, maxIterations) {
  const stateDir = join(process.cwd(), '.claude');
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  const statePath = join(stateDir, 'ralph-loop.local.md');
  const prompt = `You are running a deep research loop on: "${topic}"

For this iteration:
1. Run: node ${join(__dirname, 'research.js')} deep-research-iteration "${topic}"
   (This searches, compiles new sources, and analyzes gaps)
2. Read the latest research report in ${WIKI_DIR}/queries/
3. Read ${WIKI_DIR}/wiki/concepts/ for current coverage of "${topic}"
4. If the topic is thoroughly covered (no major gaps), output: <promise>DEEP_RESEARCH_COMPLETE</promise>
5. Otherwise, report what gaps remain and what you'd research next.

The loop will re-run this prompt, and you'll see your previous work in the wiki.`;

  const state = [
    '---',
    'active: true',
    'iteration: 1',
    `session_id: ${Date.now()}`,
    `max_iterations: ${maxIterations}`,
    'completion_promise: "DEEP_RESEARCH_COMPLETE"',
    `started_at: ${new Date().toISOString()}`,
    '---',
    '',
    prompt,
  ].join('\n');

  writeFileSync(statePath, state);
  console.log(`[neuron] Ralph Loop deep research configured.`);
  console.log(`  Topic: ${topic}`);
  console.log(`  Max iterations: ${maxIterations}`);
  console.log(`  Completion promise: DEEP_RESEARCH_COMPLETE`);
  console.log(`\n  The loop starts when Claude exits this session.`);
  console.log(`  Cancel with: /cancel-ralph`);
}
