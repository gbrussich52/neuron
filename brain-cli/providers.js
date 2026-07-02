/**
 * providers.js — LLM provider abstraction for neuron
 *
 * Supports three backends:
 *   - claude-cli: shells out to `claude --print` (default, zero config)
 *   - anthropic-api: direct HTTP to Anthropic Messages API
 *   - openai-compatible: works with Ollama, Grok, LM Studio, etc.
 *
 * Tier-based routing maps task complexity to model cost:
 *   classify  → cheapest (tagging, classification)
 *   compile   → mid-tier (wiki compilation, summaries)
 *   synthesize → best (deep analysis, research)
 *   embed     → embedding model (vector search)
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'neuron.config.json');

// ── Config Loading ────────────────────────────────────────────

let _config = null;
let _warnedMaxTokensIgnored = false; // dedupe the claude-cli maxTokens warning per process

/** Test-only helper: reset the once-per-process maxTokens warning dedupe flag. */
export function __resetMaxTokensWarning() {
  _warnedMaxTokensIgnored = false;
}

export function loadConfig() {
  if (!_config) {
    _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return _config;
}

export function reloadConfig() {
  _config = null;
  return loadConfig();
}

// ── Model Resolution ──────────────────────────────────────────

/**
 * Resolve the concrete model name for a tier + provider.
 * Tiers map to an alias (opus|sonnet|haiku); the `models` registry maps
 * each alias to a provider-specific ID. `embed` is resolved separately.
 * @param {string} tier - classify | compile | synthesize | embed
 * @param {string} [provider] - defaults to config.provider
 * @returns {string|null}
 */
export function resolveModel(tier, provider) {
  const config = loadConfig();
  provider = provider || config.provider;

  if (tier === 'embed') {
    return config.embed?.model || null;
  }

  const alias = config.tiers[tier];
  if (!alias) throw new Error(`Unknown tier: ${tier}`);

  const providerModels = config.models?.[provider];
  if (!providerModels) {
    throw new Error(`Provider "${provider}" missing from models registry`);
  }
  const modelId = providerModels[alias];
  if (!modelId) {
    throw new Error(`Alias "${alias}" not mapped for provider "${provider}" in models registry`);
  }
  return modelId;
}

// ── Retry ─────────────────────────────────────────────────────

/**
 * Run an async fn with exponential backoff.
 * @param {Function} fn - async function to attempt
 * @param {{retries?:number, baseDelayMs?:number}} [opts]
 */
export async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Provider Implementations ──────────────────────────────────

/**
 * claude-cli provider: shells out to `claude --print`
 * This is the null migration — exact same behavior as before.
 *
 * NOTE (cost control): the `claude` CLI has no `--max-tokens` flag, so
 * `maxTokens` CANNOT be enforced for this provider — it only bounds output
 * for anthropic-api/openai-compatible. We warn on stderr whenever a caller
 * requests a non-default cap here so this limitation is visible instead of
 * silent, per the project's cost-first engineering priority.
 */
export function claudeCliCall({ prompt, tools, model, maxTokens, timeout }) {
  const args = ['--print', prompt];

  if (tools && tools.length > 0) {
    args.push('--allowedTools', tools.join(','));
  }
  if (model) {
    args.push('--model', model);
  }
  if (maxTokens && !_warnedMaxTokensIgnored) {
    _warnedMaxTokensIgnored = true;
    console.warn(
      `[neuron] Warning: maxTokens is set but the claude-cli provider has no ` +
      `--max-tokens flag and cannot enforce it. Output length is unbounded on ` +
      `this provider — switch to anthropic-api or openai-compatible if a hard ` +
      `cap is required. (This warning is logged once per process.)`
    );
  }

  const opts = {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: timeout || 300000,   // 5 min default
  };

  return execFileSync('claude', args, opts);
}

/**
 * anthropic-api provider: direct HTTP to Anthropic Messages API
 * Uses native fetch (Node 18+).
 */
async function anthropicApiCall({ prompt, model, maxTokens }) {
  const config = loadConfig();
  const providerConfig = config.providers['anthropic-api'];
  const apiKey = process.env[providerConfig.api_key_env];

  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${providerConfig.api_key_env} environment variable`
    );
  }

  return withRetry(async () => {
    const response = await fetch(`${providerConfig.base_url}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': providerConfig.api_version,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    // Extract text from content blocks
    return data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  });
}

/**
 * openai-compatible provider: works with Ollama, Grok, LM Studio, etc.
 * Uses the /v1/chat/completions endpoint.
 */
async function openaiCompatibleCall({ prompt, model, maxTokens }) {
  const config = loadConfig();
  const providerConfig = config.providers['openai-compatible'];
  const apiKey = process.env[providerConfig.api_key_env] || 'not-needed';

  return withRetry(async () => {
    const response = await fetch(
      `${providerConfig.base_url}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens || 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI-compatible API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  });
}

/**
 * Embedding call via OpenAI-compatible endpoint.
 * Works with Ollama, OpenAI, or any /v1/embeddings endpoint.
 */
async function embedCall({ input, model }) {
  const config = loadConfig();
  const embedConfig = config.embed;
  const baseUrl = embedConfig?.base_url ||
    config.providers[embedConfig?.provider]?.base_url;

  if (!baseUrl) {
    throw new Error('No embed provider configured. Set embed.base_url in neuron.config.json');
  }

  const apiKey = process.env.OPENAI_API_KEY || 'not-needed';

  // Normalize to array
  const inputs = Array.isArray(input) ? input : [input];

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || embedConfig.model,
      input: inputs,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// ── Main Entry Point ──────────────────────────────────────────

/**
 * Make an LLM call routed through the configured provider and tier.
 *
 * @param {Object} opts
 * @param {string} opts.prompt - The prompt text
 * @param {string} [opts.tier='compile'] - Task tier: classify|compile|synthesize|embed
 * @param {string[]} [opts.tools] - Allowed tools (claude-cli only)
 * @param {number} [opts.maxTokens=4096] - Max response tokens
 * @param {string} [opts.provider] - Override the default provider
 * @param {string} [opts.model] - Override the model (bypasses tier routing)
 * @param {number} [opts.timeout] - Timeout in ms (claude-cli only)
 * @returns {Promise<string>|string} Response text
 */
export async function llmCall({
  prompt,
  tier = 'compile',
  tools,
  maxTokens = 4096,
  provider,
  model,
  timeout,
}) {
  const config = loadConfig();
  provider = provider || config.provider;
  model = model || resolveModel(tier, provider);

  if (!model) {
    throw new Error(
      `No model configured for tier "${tier}" with provider "${provider}". ` +
      `Update neuron.config.json.`
    );
  }

  switch (provider) {
    case 'claude-cli':
      // claude-cli is synchronous (execFileSync) — return directly
      return claudeCliCall({ prompt, tools, model, maxTokens, timeout });

    case 'anthropic-api':
      return anthropicApiCall({ prompt, model, maxTokens });

    case 'openai-compatible':
      return openaiCompatibleCall({ prompt, model, maxTokens });

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Generate embeddings for text input(s).
 *
 * @param {string|string[]} input - Text(s) to embed
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function embed(input) {
  return embedCall({ input });
}

/**
 * Synchronous LLM call — convenience wrapper for scripts that can't use async.
 * Only works with claude-cli provider.
 */
export function llmCallSync({ prompt, tier = 'compile', tools, maxTokens, timeout }) {
  const config = loadConfig();
  const provider = config.provider;

  if (provider !== 'claude-cli') {
    throw new Error(
      `llmCallSync only works with claude-cli provider (current: ${provider}). ` +
      `Use llmCall() for async providers.`
    );
  }

  const model = resolveModel(tier, provider);
  return claudeCliCall({ prompt, tools, model, maxTokens, timeout });
}
