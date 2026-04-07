#!/usr/bin/env node
/**
 * neuron — LLM-powered second brain CLI
 *
 * Watches Inbox/, auto-processes knowledge inputs, updates wiki,
 * and surfaces proactive insights.
 *
 * Commands:
 *   neuron watch              — Watch Inbox/ for new files, auto-process
 *   neuron process            — Process all pending Inbox/ files now
 *   neuron braindump          — Interactive brain dump (stdin → Inbox/)
 *   neuron search <query>     — Full-text search across the entire KB
 *   neuron semantic-search <q> — Semantic/vector search (requires reindex)
 *   neuron reindex            — Build/update semantic search index
 *   neuron status             — Show KB stats and health
 *   neuron daily              — Generate today's daily note
 *   neuron insights           — Run proactive insight generation
 *   neuron connections <file> — Find related articles and suggest wikilinks
 *   neuron metrics            — Show thinking quality score
 *   neuron research <topic>   — Autonomous web research → wiki
 *   neuron improve            — Self-improvement loop (compile→lint→research→repeat)
 *
 * Security note: execSync is used intentionally for local CLI delegation.
 * All inputs are local file paths or user-provided search queries — no
 * untrusted external input reaches shell execution.
 */

import { watch, readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs';
import { join, basename, extname, resolve, dirname } from 'path';
import { execSync, execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

// Provider abstraction — routes LLM calls through configured backend
const __dirname = dirname(fileURLToPath(import.meta.url));
const { llmCall, llmCallSync, loadConfig } = await import(join(__dirname, 'providers.js'));

// ── Configuration ──────────────────────────────────────────────
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');
const INBOX = join(KB_DIR, 'Inbox');
const RAW = join(KB_DIR, 'raw');
const WIKI = join(KB_DIR, 'wiki');
const DAILY = join(KB_DIR, 'Daily');
const ARCHIVE = join(KB_DIR, 'Archive');
const MEMORY = join(KB_DIR, 'memory');
const SCRIPTS = join(KB_DIR, 'scripts');
const STATE_FILE = join(KB_DIR, 'brain-cli', '.brain-state.json');

// ── Helpers ────────────────────────────────────────────────────
const timestamp = () => new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
const dateStr = () => new Date().toISOString().slice(0, 10);
const log = (msg) => console.log(`[neuron] ${msg}`);
const warn = (msg) => console.log(`[neuron] WARNING: ${msg}`);

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return { processed: [], lastRun: null, totalProcessed: 0 };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function countFiles(dir, ext = '.md') {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir, { recursive: true })
      .filter(f => f.endsWith(ext)).length;
  } catch { return 0; }
}

// ── Content Type Detection ─────────────────────────────────────
function detectContentType(filename, content) {
  const ext = extname(filename).toLowerCase();
  const text = content?.slice(0, 500) || '';

  if (text.match(/youtube\.com\/watch|youtu\.be\//)) return 'youtube';
  if (text.match(/gist\.github\.com\//)) return 'url';
  if (text.match(/github\.com\/.*\/blob\//)) return 'url';
  if (text.match(/linkedin\.com\/(posts|pulse)\//)) return 'url';
  if (text.match(/reddit\.com\/r\/.*\/comments\//)) return 'url';
  if (text.match(/stackoverflow\.com\/questions\//)) return 'url';
  if (text.match(/news\.ycombinator\.com\/item/)) return 'url';
  if (text.match(/^https?:\/\/\S+$/m) && text.trim().split('\n').length <= 3) return 'url';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.json' || ext === '.jsonl') return 'data';
  if (ext === '.md' || ext === '.txt' || ext === '') return 'text';
  return 'unknown';
}

// ── Processors ─────────────────────────────────────────────────

function processUrl(filepath, content) {
  const url = content.trim().split('\n')[0].trim();
  log(`Ingesting URL: ${url}`);
  try {
    execFileSync('bash', [join(SCRIPTS, 'ingest.sh'), url], { stdio: 'pipe' });
    return true;
  } catch (e) {
    warn(`Failed to ingest URL: ${e.message}`);
    return false;
  }
}

function processYoutube(filepath, content) {
  const urlMatch = content.match(/(https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+|https?:\/\/youtu\.be\/[\w-]+)/);
  if (!urlMatch) { warn('No YouTube URL found'); return false; }
  const url = urlMatch[1];
  const slug = timestamp();
  const outFile = join(RAW, `${slug}_youtube.md`);

  log(`Processing YouTube: ${url}`);

  try {
    // Get video title
    let title = 'Unknown Video';
    try {
      title = execFileSync('yt-dlp', ['--get-title', url], { encoding: 'utf-8', timeout: 15000 }).trim();
    } catch { /* use default */ }

    // Try to get transcript via yt-dlp subtitles
    let transcript = 'No transcript available — video may need manual summarization.';
    try {
      const tmpBase = join('/tmp', `brain-yt-${slug}`);
      execFileSync('yt-dlp', [
        '--write-auto-sub', '--sub-lang', 'en', '--skip-download',
        '-o', tmpBase, url
      ], { timeout: 30000, stdio: 'pipe' });

      const vttFile = `${tmpBase}.en.vtt`;
      if (existsSync(vttFile)) {
        const vttContent = readFileSync(vttFile, 'utf-8');
        transcript = vttContent
          .split('\n')
          .filter(line => !line.match(/^(WEBVTT|Kind:|Language:|[\d:.]+ -->|\s*$)/))
          .filter(line => line.trim())
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .slice(0, 10000);
      }
    } catch { /* transcript unavailable */ }

    writeFileSync(outFile, [
      '---',
      'classification: PUBLIC',
      `source_url: ${url}`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      `ingested: ${timestamp()}`,
      'tags: [youtube, video]',
      'type: youtube',
      'compiled: false',
      '---',
      '',
      `# ${title}`,
      '',
      `Source: ${url}`,
      '',
      '## Transcript',
      '',
      transcript,
    ].join('\n'));

    log(`YouTube transcript saved: ${basename(outFile)}`);
    return true;
  } catch (e) {
    warn(`YouTube processing failed: ${e.message}`);
    return processUrl(filepath, url);
  }
}

function processText(filepath, content) {
  const slug = basename(filepath, extname(filepath))
    .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const outFile = join(RAW, `${timestamp()}_${slug}.md`);

  if (content.startsWith('---')) {
    if (!content.includes('compiled:')) {
      content = content.replace('---', '---\ncompiled: false');
    }
    writeFileSync(outFile, content);
  } else {
    writeFileSync(outFile, [
      '---',
      'classification: PRIVATE',
      `ingested: ${timestamp()}`,
      'tags: [inbox]',
      'type: note',
      'compiled: false',
      '---',
      '',
      content,
    ].join('\n'));
  }

  log(`Text processed: ${basename(outFile)}`);
  return true;
}

function processBinary(filepath) {
  const name = basename(filepath);
  const dest = join(RAW, `${timestamp()}_${name}`);
  const sidecar = `${dest}.meta.md`;

  execFileSync('cp', [filepath, dest]);
  writeFileSync(sidecar, [
    '---',
    'classification: PRIVATE',
    `source_file: ${name}`,
    `ingested: ${timestamp()}`,
    `format: ${extname(filepath).slice(1)}`,
    'tags: [inbox, binary]',
    'type: binary',
    'compiled: false',
    '---',
    '',
    `Binary file: ${name}`,
    'Requires LLM processing during compilation.',
  ].join('\n'));

  log(`Binary copied + sidecar created: ${name}`);
  return true;
}

// ── Main Processing Pipeline ───────────────────────────────────
function processFile(filepath) {
  const name = basename(filepath);
  if (name.startsWith('.') || name === '.DS_Store') return false;

  let content = '';
  try {
    content = readFileSync(filepath, 'utf-8');
  } catch {
    return processBinary(filepath);
  }

  const type = detectContentType(name, content);
  log(`Detected type: ${type} for ${name}`);

  let success = false;
  switch (type) {
    case 'youtube': success = processYoutube(filepath, content); break;
    case 'url': success = processUrl(filepath, content); break;
    case 'image':
    case 'pdf': success = processBinary(filepath); break;
    default: success = processText(filepath, content); break;
  }

  if (success) {
    const archiveDest = join(ARCHIVE, `${dateStr()}_${name}`);
    try { renameSync(filepath, archiveDest); } catch { /* file may not exist */ }
  }
  return success;
}

// ── Commands ───────────────────────────────────────────────────

function cmdWatch() {
  log(`Watching ${INBOX}/ for new files...`);
  log('Press Ctrl+C to stop.\n');

  cmdProcess();

  const watcher = watch(INBOX, { persistent: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return;
    const filepath = join(INBOX, filename);
    setTimeout(() => {
      if (existsSync(filepath)) {
        log(`New file detected: ${filename}`);
        const state = loadState();
        if (processFile(filepath)) {
          state.totalProcessed++;
          state.lastRun = new Date().toISOString();
          saveState(state);
        }
      }
    }, 1000);
  });

  process.on('SIGINT', () => { watcher.close(); log('Watcher stopped.'); process.exit(0); });
}

function cmdProcess() {
  if (!existsSync(INBOX)) { log('Inbox/ is empty.'); return; }
  const files = readdirSync(INBOX).filter(f => !f.startsWith('.'));
  if (files.length === 0) { log('Inbox/ is empty. Nothing to process.'); return; }

  log(`Processing ${files.length} file(s) from Inbox/...`);
  const state = loadState();
  let processed = 0;
  for (const file of files) {
    if (processFile(join(INBOX, file))) processed++;
  }
  state.totalProcessed += processed;
  state.lastRun = new Date().toISOString();
  saveState(state);
  log(`Done. ${processed}/${files.length} files processed.`);
}

function cmdBraindump() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  console.log('=== Brain Dump ===');
  console.log('Type or paste anything. Press Ctrl+D when done.\n');
  rl.on('line', (line) => lines.push(line));
  rl.on('close', () => {
    const content = lines.join('\n').trim();
    if (!content) { log('Empty dump. Nothing saved.'); return; }
    const slug = content.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const outFile = join(INBOX, `${timestamp()}_braindump_${slug}.md`);
    writeFileSync(outFile, content);
    log(`Brain dump saved: ${basename(outFile)}`);
    log('Run `brain process` or `brain watch` to auto-process.');
  });
}

function cmdSearch(query) {
  if (!query) { console.log('Usage: brain search <query>'); return; }
  log(`Searching for: "${query}"\n`);
  try {
    const result = execFileSync('rg', [
      '-i', '--color=always', '-C', '1', query, KB_DIR,
      '--glob', '*.md', '-g', '!node_modules', '-g', '!.obsidian'
    ], { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    console.log(result);
  } catch { console.log('No results found.'); }
}

function cmdStatus() {
  const state = loadState();
  const inboxCount = existsSync(INBOX) ? readdirSync(INBOX).filter(f => !f.startsWith('.')).length : 0;
  const rawCount = countFiles(RAW);
  const conceptCount = countFiles(join(WIKI, 'concepts'));
  const summaryCount = countFiles(join(WIKI, 'summaries'));
  const queryCount = countFiles(join(WIKI, 'queries'));
  const sessionCount = countFiles(join(WIKI, 'sessions'));
  const dailyCount = countFiles(DAILY);
  const archiveCount = existsSync(ARCHIVE) ? readdirSync(ARCHIVE).filter(f => !f.startsWith('.')).length : 0;

  let uncompiled = 0;
  try {
    const r = execFileSync('grep', ['-rl', 'compiled: false', RAW], { encoding: 'utf-8' });
    uncompiled = r.trim().split('\n').filter(Boolean).length;
  } catch { /* no matches */ }

  console.log(`
=== Neuron Status ===

  Inbox:         ${inboxCount} pending
  Raw sources:   ${rawCount} (${uncompiled} uncompiled)
  Concepts:      ${conceptCount}
  Summaries:     ${summaryCount}
  Queries:       ${queryCount}
  Sessions:      ${sessionCount}
  Daily notes:   ${dailyCount}
  Archive:       ${archiveCount}

  Total processed: ${state.totalProcessed}
  Last run:        ${state.lastRun || 'never'}
`);
  if (uncompiled > 0) console.log(`  --> ${uncompiled} source(s) need compilation. Run: capture.sh compile`);
  if (inboxCount > 0) console.log(`  --> ${inboxCount} file(s) in Inbox. Run: brain process`);
  console.log('');
}

async function cmdDaily() {
  const today = dateStr();
  const dailyFile = join(DAILY, `${today}.md`);

  if (existsSync(dailyFile)) {
    log(`Daily note already exists: ${today}.md`);
    return;
  }

  log(`Generating daily note for ${today}...`);
  try {
    await llmCall({
      prompt: `You are a daily briefing agent. Read ${MEMORY}/context.md and ${WIKI}/index.md. ` +
        `Write a daily note to ${dailyFile} with frontmatter (classification: PRIVATE, date: ${today}, type: daily-note) ` +
        `and sections: Morning Briefing (what's active today), Open Questions (worth exploring), ` +
        `Connections to Explore (non-obvious links), Capture Zone (empty for throughout the day). ` +
        `Be concise. Focus on actionable items.`,
      tier: 'compile',
      tools: ['Read', 'Write', 'Glob'],
      timeout: 60000,
    });

    if (existsSync(dailyFile)) {
      log(`Daily note created: ${today}.md`);
    } else {
      writeDailyTemplate(dailyFile, today);
    }
  } catch {
    writeDailyTemplate(dailyFile, today);
  }
}

function writeDailyTemplate(file, date) {
  writeFileSync(file, `---
classification: PRIVATE
date: ${date}
type: daily-note
---

# ${date}

## Morning Briefing
-

## Open Questions
-

## Connections to Explore
-

## Capture Zone

`);
  log(`Template daily note created: ${date}.md`);
}

async function cmdInsights() {
  log('Generating proactive insights...\n');
  try {
    const result = await llmCall({
      prompt: `You are a proactive insight agent for a knowledge base at ${KB_DIR}. ` +
        `Read the wiki index, recent session extracts, and memory files. Generate: ` +
        `1) Challenge Your Assumptions — pick 2-3 beliefs from the KB, present counter-arguments, rate confidence 1-10. ` +
        `2) Knowledge Gaps — 3 underexplored topics with why they matter and suggested sources. ` +
        `3) Hidden Connections — 2-3 non-obvious links between concepts in different areas. ` +
        `4) Learning Path — 3 things to learn this week based on current projects. ` +
        `Be specific. Reference actual articles and facts, not generic advice. Print to stdout.`,
      tier: 'synthesize',
      tools: ['Read', 'Glob', 'Grep'],
      timeout: 120000,
    });
    console.log(result);

    // File the insights
    const insightFile = join(WIKI, 'queries', `${timestamp()}_proactive_insights.md`);
    writeFileSync(insightFile, `---
classification: PRIVATE
type: proactive-insights
generated: ${timestamp()}
tags: [insights, proactive, auto-generated]
---

# Proactive Insights

${result}`);
    log(`Insights filed: ${basename(insightFile)}`);
  } catch (e) {
    warn(`Insight generation failed: ${e.message}`);
  }
}

// ── Dynamic Command Loaders ───────────────────────────────────
// These load modules on demand to avoid startup cost for unused features.

async function cmdSemanticSearch(query) {
  try {
    const { search } = await import(join(__dirname, 'semantic.js'));
    await search(query);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      warn('Semantic search not yet available. Run `neuron reindex` first.');
    } else { throw e; }
  }
}

async function cmdSmartSearch(query) {
  const { smartSearch } = await import(join(__dirname, 'semantic.js'));
  await smartSearch(query);
}

async function cmdReindex() {
  const { buildIndex } = await import(join(__dirname, 'semantic.js'));
  await buildIndex();
}

async function cmdConnections(filePath) {
  const { findConnections } = await import(join(__dirname, 'connections.js'));
  await findConnections(filePath);
}

async function cmdMetrics(showHistory) {
  const { displayMetrics } = await import(join(__dirname, 'metrics.js'));
  await displayMetrics(showHistory);
}

function cmdConfig(args) {
  const configPath = join(__dirname, 'neuron.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const sub = args[0];

  if (!sub || sub === 'show') {
    console.log(`
=== Neuron Config ===

  Provider:     ${config.provider}
  Tiers:
    classify    → ${config.tiers.classify.models[config.provider] || '(not set)'}
    compile     → ${config.tiers.compile.models[config.provider] || '(not set)'}
    synthesize  → ${config.tiers.synthesize.models[config.provider] || '(not set)'}
    embed       → ${config.tiers.embed.models[config.tiers.embed.embed_provider] || '(not set)'} (via ${config.tiers.embed.embed_provider})

  Features:
${Object.entries(config.features).map(([k, v]) => `    ${k}: ${v ? 'ON' : 'off'}`).join('\n')}

  Config file: ${configPath}
`);
    return;
  }

  if (sub === 'provider') {
    const newProvider = args[1];
    if (!newProvider) {
      console.log(`Current provider: ${config.provider}`);
      console.log(`Available: ${Object.keys(config.providers).join(', ')}`);
      console.log(`Usage: neuron config provider <name>`);
      return;
    }
    if (!config.providers[newProvider]) {
      console.error(`Unknown provider: ${newProvider}`);
      console.error(`Available: ${Object.keys(config.providers).join(', ')}`);
      return;
    }
    config.provider = newProvider;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`Provider switched to: ${newProvider}`);
    // Show what models this maps to
    console.log(`  classify    → ${config.tiers.classify.models[newProvider] || '(not configured)'}`);
    console.log(`  compile     → ${config.tiers.compile.models[newProvider] || '(not configured)'}`);
    console.log(`  synthesize  → ${config.tiers.synthesize.models[newProvider] || '(not configured)'}`);
    return;
  }

  if (sub === 'feature') {
    const feature = args[1];
    const value = args[2];
    if (!feature || !value) {
      console.log('Usage: neuron config feature <name> <on|off>');
      console.log(`Features: ${Object.keys(config.features).join(', ')}`);
      return;
    }
    if (!(feature in config.features)) {
      console.error(`Unknown feature: ${feature}`);
      return;
    }
    config.features[feature] = value === 'on' || value === 'true';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`Feature ${feature}: ${config.features[feature] ? 'ON' : 'off'}`);
    return;
  }

  if (sub === 'model') {
    const tier = args[1];
    const model = args[2];
    if (!tier || !model) {
      console.log('Usage: neuron config model <tier> <model-name>');
      console.log('Tiers: classify, compile, synthesize');
      console.log('Example: neuron config model compile gemma4:e4b');
      return;
    }
    if (!config.tiers[tier]) {
      console.error(`Unknown tier: ${tier}`);
      return;
    }
    config.tiers[tier].models[config.provider] = model;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`${tier} model (${config.provider}): ${model}`);
    return;
  }

  console.log(`
Usage: neuron config <subcommand>

  show                          Show current config
  provider <name>               Switch LLM provider (claude-cli, anthropic-api, openai-compatible)
  feature <name> <on|off>       Toggle a feature flag
  model <tier> <model-name>     Set model for a tier (classify, compile, synthesize)

Examples:
  neuron config provider openai-compatible    # Switch to Ollama/local
  neuron config provider claude-cli           # Switch back to Claude
  neuron config feature semantic_search on    # Enable semantic search
  neuron config model compile gemma4:e4b      # Use Gemma 4 for compilation
`);
}

async function cmdResearch(topic) {
  const { runResearch } = await import(join(__dirname, 'research.js'));
  await runResearch(topic);
}

async function cmdDeepResearch(args) {
  const { runDeepResearch } = await import(join(__dirname, 'research.js'));
  // Parse args: topic is everything that's not a flag
  const flags = {};
  const topicParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-iterations') { flags.maxIterations = parseInt(args[++i], 10); }
    else if (args[i] === '--ralph') { flags.standalone = false; }
    else { topicParts.push(args[i]); }
  }
  await runDeepResearch(topicParts.join(' '), flags);
}

async function cmdImprove(args) {
  const { runImprove } = await import(join(__dirname, 'improve.js'));
  await runImprove(args);
}

// ── CLI Router ─────────────────────────────────────────────────
const [,, command, ...args] = process.argv;

// Wrap in async IIFE to support await in command handlers
(async () => {
  try {
    switch (command) {
      case 'watch': cmdWatch(); break;
      case 'process': cmdProcess(); break;
      case 'braindump': case 'dump': cmdBraindump(); break;
      case 'search': cmdSearch(args.join(' ')); break;
      case 'semantic-search': await cmdSemanticSearch(args.join(' ')); break;
      case 'smart-search': await cmdSmartSearch(args.join(' ')); break;
      case 'reindex': await cmdReindex(); break;
      case 'connections': await cmdConnections(args[0]); break;
      case 'metrics': await cmdMetrics(args.includes('--history')); break;
      case 'research': await cmdResearch(args.join(' ')); break;
      case 'deep-research': await cmdDeepResearch(args); break;
      case 'improve': await cmdImprove(args); break;
      case 'config': cmdConfig(args); break;
      case 'status': cmdStatus(); break;
      case 'daily': await cmdDaily(); break;
      case 'insights': await cmdInsights(); break;
      default:
        console.log(`
  neuron — LLM-powered second brain

  Core:
    watch               Watch Inbox/ and auto-process new files
    process             Process all pending Inbox/ files now
    braindump           Interactive brain dump (type/paste, Ctrl+D to save)
    status              Show KB stats and health
    daily               Generate today's daily note

  Search:
    search <query>      Full-text search (ripgrep) across KB
    smart-search <q>    Combined semantic + keyword search (best results)
    semantic-search <q> Pure semantic/vector search
    reindex             Build or update the semantic search index

  Intelligence:
    insights            Run proactive insight generation
    connections <file>  Find related articles and suggest wikilinks
    metrics [--history] Show thinking quality score and trends
    research <topic>    Autonomous web research → wiki (single pass)
    deep-research <t>   Karpathy auto-research loop (iterative deep dive)
                        --max-iterations N  --ralph (use Ralph Loop)
    improve [opts]      Self-improvement loop (compile→lint→research→repeat)
                        --max-iterations N  --standalone  --target-grade A-F

  Config:
    config                Show current provider, models, features
    config provider <p>   Switch LLM provider (claude-cli, openai-compatible, ...)
    config feature <f> on Toggle feature flags
    config model <t> <m>  Set model for a tier

  Drop anything into ~/knowledge-base/Inbox/ — it gets auto-processed.
  URLs, YouTube links, text files, PDFs, images — all handled.
        `);
    }
  } catch (err) {
    console.error(`[neuron] Fatal: ${err.message}`);
    process.exit(1);
  }
})();
