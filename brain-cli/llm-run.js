#!/usr/bin/env node
/**
 * llm-run.js — Shell bridge for providers.js
 *
 * Lets bash scripts call the LLM provider abstraction without
 * being rewritten to Node.js. Reads prompt from stdin or --prompt arg.
 *
 * Usage:
 *   node llm-run.js <tier> "<prompt>" [--tools Tool1,Tool2] [--max-tokens N] [--timeout N]
 *   echo "prompt text" | node llm-run.js <tier> --stdin [--tools Tool1,Tool2]
 *
 * For claude-cli provider: constructs the exact same `claude --print` command.
 * For API providers: makes HTTP calls and writes response to stdout.
 *
 * Exit codes:
 *   0 = success (response on stdout)
 *   1 = error (message on stderr)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import to share the same providers.js module
const { llmCall, llmCallSync, loadConfig } = await import(
  join(__dirname, 'providers.js')
);

// ── Argument Parsing ──────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2); // skip node and script path
  const result = {
    tier: null,
    prompt: null,
    tools: null,
    maxTokens: 4096,
    timeout: 300000,
    stdin: false,
  };

  let i = 0;

  // First positional arg = tier
  if (args.length > 0 && !args[0].startsWith('--')) {
    result.tier = args[0];
    i = 1;
  }

  // Second positional arg = prompt (if not a flag)
  if (args.length > 1 && !args[1].startsWith('--')) {
    result.prompt = args[1];
    i = 2;
  }

  // Named args
  while (i < args.length) {
    switch (args[i]) {
      case '--tools':
        result.tools = args[++i]?.split(',').map(t => t.trim());
        break;
      case '--max-tokens':
        result.maxTokens = parseInt(args[++i], 10);
        break;
      case '--timeout':
        result.timeout = parseInt(args[++i], 10);
        break;
      case '--stdin':
        result.stdin = true;
        break;
      case '--tier':
        result.tier = args[++i];
        break;
      case '--prompt':
        result.prompt = args[++i];
        break;
      default:
        // If we haven't captured prompt yet, treat unknown positional as prompt
        if (!result.prompt && !args[i].startsWith('--')) {
          result.prompt = args[i];
        }
        break;
    }
    i++;
  }

  return result;
}

function readStdin() {
  try {
    return readFileSync('/dev/stdin', 'utf-8');
  } catch {
    return '';
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.tier) {
    console.error(
      'Usage: node llm-run.js <tier> "<prompt>" [--tools Tool1,Tool2] [--max-tokens N]'
    );
    console.error('Tiers: classify, compile, synthesize, embed');
    process.exit(1);
  }

  // Get prompt from stdin if flagged, or from positional/named arg
  let prompt = args.prompt;
  if (args.stdin || !prompt) {
    const stdinContent = readStdin().trim();
    if (stdinContent) {
      prompt = stdinContent;
    }
  }

  if (!prompt) {
    console.error('Error: No prompt provided. Pass as argument or pipe via stdin.');
    process.exit(1);
  }

  try {
    const config = loadConfig();

    // For claude-cli, use sync call (simpler, no event loop issues in scripts)
    if (config.provider === 'claude-cli') {
      const result = llmCallSync({
        prompt,
        tier: args.tier,
        tools: args.tools,
        maxTokens: args.maxTokens,
        timeout: args.timeout,
      });
      process.stdout.write(result);
    } else {
      // Async providers
      const result = await llmCall({
        prompt,
        tier: args.tier,
        tools: args.tools,
        maxTokens: args.maxTokens,
      });
      process.stdout.write(result);
    }
  } catch (err) {
    console.error(`[llm-run] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
