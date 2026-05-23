/**
 * review.js — Human approval queue for autonomous research output.
 *
 * Items in <vault>/wiki/_review/ are drafts produced by `neuron improve`.
 * They land here (never in wiki/ directly) until a human approves them.
 *
 * Exports:
 *   listPending(vaultRoot)              — pending items, oldest first
 *   approveItem(vaultRoot, name)        — move to target_path; remove from queue
 *   rejectItem(vaultRoot, name)         — move to Archive/ with rejected- prefix
 *   runReview(args, vaultRoot)          — CLI entrypoint (used by brain.js)
 */

import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { timestamp } from './lib/util.js';

function defaultVault() {
  return process.env.KB_DIR || join(homedir(), 'knowledge-base');
}

function reviewDir(vaultRoot) {
  return join(vaultRoot, 'wiki', '_review');
}

/**
 * Parses YAML frontmatter from a markdown file's content.
 * Handles the limited subset Neuron uses: single-line `key: value` pairs.
 * Does NOT use a YAML library to keep the dependency footprint minimal.
 *
 * @param {string} content - Raw file content
 * @returns {Record<string, string>} - Parsed frontmatter key/value pairs
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

/**
 * Returns all pending review items, sorted oldest-first by the `created`
 * frontmatter field. Ignores README.md and .gitkeep meta files.
 *
 * @param {string} [vaultRoot] - Vault root directory (defaults to KB_DIR env or ~/knowledge-base)
 * @returns {Array<{name: string, created: string, target_path: string, classification: string}>}
 */
export function listPending(vaultRoot = defaultVault()) {
  const dir = reviewDir(vaultRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(name => {
      const content = readFileSync(join(dir, name), 'utf-8');
      const fm = parseFrontmatter(content);
      return {
        name,
        created: fm.created || '',
        target_path: fm.target_path || '',
        classification: fm.classification || '',
      };
    })
    .sort((a, b) => (a.created || '').localeCompare(b.created || ''));
}

/**
 * Approves a review item by moving it to the path specified in its
 * `target_path` frontmatter field. Throws if the item is not found
 * or if `target_path` is absent from frontmatter.
 *
 * @param {string} vaultRoot - Vault root directory
 * @param {string} name - Filename within the _review/ queue
 * @returns {{ moved: true, target: string }}
 */
export function approveItem(vaultRoot, name) {
  const src = join(reviewDir(vaultRoot), name);
  if (!existsSync(src)) throw new Error(`Item not found in review queue: ${name}`);
  const content = readFileSync(src, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm.target_path) {
    throw new Error(`Cannot approve "${name}": frontmatter is missing target_path`);
  }
  const target = join(vaultRoot, fm.target_path);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(src, target);
  return { moved: true, target };
}

/**
 * Rejects a review item by moving it to Archive/ with a
 * `rejected-<timestamp>-<name>` prefix. Throws if the item is not found.
 *
 * @param {string} vaultRoot - Vault root directory
 * @param {string} name - Filename within the _review/ queue
 * @returns {{ archived: true, target: string }}
 */
export function rejectItem(vaultRoot, name) {
  const src = join(reviewDir(vaultRoot), name);
  if (!existsSync(src)) throw new Error(`Item not found in review queue: ${name}`);
  const archiveDir = join(vaultRoot, 'Archive');
  mkdirSync(archiveDir, { recursive: true });
  const target = join(archiveDir, `rejected-${timestamp()}-${name}`);
  renameSync(src, target);
  return { archived: true, target };
}

/**
 * CLI entrypoint for `neuron review`.
 * Subcommands: list (default), next, approve <n>, reject <n>.
 *
 * @param {string[]} args - CLI args after "review"
 * @param {string} [vaultRoot] - Vault root directory
 */
export async function runReview(args, vaultRoot = defaultVault()) {
  const sub = args[0];
  const items = listPending(vaultRoot);

  if (!sub || sub === 'list') {
    if (items.length === 0) {
      console.log('Review queue is empty.');
      return;
    }
    console.log(`${items.length} pending:\n`);
    items.forEach((it, i) => {
      console.log(`  [${i + 1}] ${it.name}`);
      console.log(`      created:     ${it.created}`);
      console.log(`      target_path: ${it.target_path || '(none — cannot approve)'}`);
    });
    console.log('\nUsage: neuron review next | approve <n> | reject <n>');
    return;
  }

  if (sub === 'next') {
    if (items.length === 0) { console.log('Review queue is empty.'); return; }
    const item = items[0];
    const content = readFileSync(join(reviewDir(vaultRoot), item.name), 'utf-8');
    console.log(`=== ${item.name} ===\n`);
    console.log(content);
    return;
  }

  if (sub === 'approve') {
    const n = parseInt(args[1], 10);
    if (!Number.isInteger(n) || n < 1 || n > items.length) {
      console.error(`Usage: neuron review approve <n>   (1..${items.length})`);
      return;
    }
    const item = items[n - 1];
    const { target } = approveItem(vaultRoot, item.name);
    console.log(`Approved → ${target}`);
    return;
  }

  if (sub === 'reject') {
    const n = parseInt(args[1], 10);
    if (!Number.isInteger(n) || n < 1 || n > items.length) {
      console.error(`Usage: neuron review reject <n>   (1..${items.length})`);
      return;
    }
    const item = items[n - 1];
    const { target } = rejectItem(vaultRoot, item.name);
    console.log(`Rejected → ${target}`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}`);
  console.error('Usage: neuron review [list|next|approve <n>|reject <n>]');
}
