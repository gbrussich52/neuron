// validate.js — trust-ladder stamping + content-hash reconciliation
// (spec Components 1 + 3 + Approval Binding).
//
// Trust rules (fail-closed):
//   - missing trust → born `unverified` unless author resolves to `giani`
//   - stamping a MISSING content_hash never changes trust (grandfathered notes
//     keep `verified` — they predate the hash convention)
//   - a body edit after stamping re-binds trust to approvals.log: promoted only
//     when an `approve` entry matches the NEW hash; a `verified` note without
//     one demotes to `unverified` and re-enters REVIEW.md
//   - `rejected` is terminal: only the hash restamps, trust never resurrects
import { readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { parseFrontmatter, hasField, setField } from './lib/frontmatter.js';
import { computeContentHash } from './lib/contentHash.js';
import { latestFor } from './lib/approvals.js';
import { walkMarkdown } from './migrate.js';

const today = () => new Date().toISOString().slice(0, 10);
const defaultVault = () => process.env.KB_DIR || join(homedir(), 'knowledge-base');

/**
 * Stamp + reconcile one note. Pure: takes content, returns new content + change list.
 * @param {string} content
 * @param {{author?: string, relPath?: string, kbDir?: string|null}} opts
 *   relPath+kbDir enable the approvals.log lookup for reconciliation.
 */
export function validateFile(content, { author, relPath = '', kbDir = null } = {}) {
  const changes = [];
  let out = content;
  const stampAuthor = author || process.env.NEURON_AUTHOR || 'unknown';

  if (!hasField(out, 'classification')) {
    out = setField(out, 'classification', 'PRIVATE');
    changes.push('classification: PRIVATE');
  }
  if (!hasField(out, 'author')) {
    out = setField(out, 'author', stampAuthor);
    changes.push(`author: ${stampAuthor}`);
  }
  if (!hasField(out, 'captured_at')) {
    out = setField(out, 'captured_at', today());
    changes.push(`captured_at: ${today()}`);
  }
  if (!hasField(out, 'trust')) {
    // Born verified ONLY for the user's own writes; everything else quarantines.
    const a = parseFrontmatter(out).data.author;
    const trust = a === 'giani' ? 'verified' : 'unverified';
    out = setField(out, 'trust', trust);
    if (trust === 'verified') out = setField(out, 'verified_at', today());
    changes.push(`trust: ${trust}`);
  }

  const hash = computeContentHash(out);
  const { data } = parseFrontmatter(out);
  if (!data.content_hash) {
    out = setField(out, 'content_hash', hash); // metadata-only: trust unchanged
    changes.push('content_hash: stamped');
  } else if (data.content_hash !== hash) {
    out = setField(out, 'content_hash', hash);
    if (data.trust === 'rejected') {
      changes.push('content_hash: restamped (rejected is terminal)');
    } else {
      const approval = kbDir && relPath ? latestFor(kbDir, relPath, 'approve') : null;
      if (approval && approval.content_hash === hash) {
        out = setField(out, 'trust', 'verified');
        out = setField(out, 'verified_at', today());
        changes.push('trust: verified (approval matches new hash)');
      } else if (data.trust === 'verified') {
        out = setField(out, 'trust', 'unverified');
        changes.push('trust: demoted to unverified (body changed after verification)');
      } else {
        changes.push('content_hash: updated');
      }
    }
  }
  return { content: out, changes };
}

/**
 * Working-tree sweep over the governed content dirs (spec design-spine #3):
 * catches Obsidian saves and write-then-exit agents that left notes unstamped.
 * Dry-run by default; idempotent once applied.
 */
export function runSweep(kbDir, { apply = false, author } = {}) {
  const report = [];
  for (const path of walkMarkdown(kbDir)) {
    const rel = relative(kbDir, path);
    const original = readFileSync(path, 'utf-8');
    const { content, changes } = validateFile(original, { author, relPath: rel, kbDir });
    if (changes.length === 0) continue;
    report.push({ file: rel, changes });
    if (apply) writeFileSync(path, content);
  }
  return report;
}

/** CLI: neuron validate --sweep [--apply] | neuron validate <file...> [--apply] */
export async function runValidate(args, kbDir = defaultVault()) {
  const apply = args.includes('--apply');
  const sweep = args.includes('--sweep');
  const files = args.filter(a => !a.startsWith('--'));
  if (!sweep && files.length === 0) {
    console.log('Usage: neuron validate --sweep [--apply] | neuron validate <file...> [--apply]');
    return;
  }
  let report = [];
  if (sweep) {
    report = runSweep(kbDir, { apply });
  } else {
    for (const f of files) {
      const path = join(kbDir, f);
      const original = readFileSync(path, 'utf-8');
      const { content, changes } = validateFile(original, { relPath: f, kbDir });
      if (changes.length === 0) continue;
      report.push({ file: f, changes });
      if (apply) writeFileSync(path, content);
    }
  }
  const mode = apply ? '' : '[dry-run] ';
  console.log(`${mode}${report.length} file(s) stamped/reconciled:`);
  for (const r of report) console.log(`  ${r.file}: ${r.changes.join('; ')}`);
  if (!apply && report.length) console.log('\nRe-run with --apply to write changes.');
}
