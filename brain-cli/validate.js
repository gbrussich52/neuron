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
import { join, relative, resolve, sep } from 'path';
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
  const date = today(); // cached once — a midnight tick must not split the stamps
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
    out = setField(out, 'captured_at', date);
    changes.push(`captured_at: ${date}`);
  }
  if (!hasField(out, 'trust')) {
    // Born verified ONLY for the user's own writes; everything else quarantines.
    const a = parseFrontmatter(out).data.author;
    const trust = a === 'giani' ? 'verified' : 'unverified';
    out = setField(out, 'trust', trust);
    if (trust === 'verified') out = setField(out, 'verified_at', date);
    changes.push(`trust: ${trust}`);
  }

  // Normalize semantic field casing — `Trust: Verified` or `classification: confidential`
  // must not dodge the trust rules or the read-side CONFIDENTIAL checks (=== comparisons).
  let d = parseFrontmatter(out).data;
  if (d.trust && d.trust !== d.trust.toLowerCase()) {
    out = setField(out, 'trust', d.trust.toLowerCase());
    changes.push(`trust: normalized casing (${d.trust})`);
  }
  if (d.classification && d.classification !== d.classification.toUpperCase()) {
    out = setField(out, 'classification', d.classification.toUpperCase());
    changes.push(`classification: normalized casing (${d.classification})`);
  }
  // Collapse duplicate semantic keys — parse is first-wins, but the smuggled
  // second line must not survive on disk (setField rewrites to exactly one line
  // carrying the first-wins value).
  for (const key of ['trust', 'classification']) {
    const keyRe = new RegExp(`^${key}\\s*:`, 'i');
    const count = parseFrontmatter(out).raw.split('\n').filter(l => keyRe.test(l)).length;
    if (count > 1) {
      out = setField(out, key, parseFrontmatter(out).data[key]);
      changes.push(`${key}: collapsed ${count} duplicate keys`);
    }
  }

  const hash = computeContentHash(out);
  const data = parseFrontmatter(out).data; // re-parsed: normalized casing/dedupe applied
  let hashMismatched = false; // tracks the mismatch branch — gates crash recovery below
  if (!data.content_hash) {
    out = setField(out, 'content_hash', hash); // metadata-only: trust unchanged
    changes.push('content_hash: stamped');
  } else if (data.content_hash !== hash) {
    hashMismatched = true;
    out = setField(out, 'content_hash', hash);
    if (data.trust === 'rejected') {
      changes.push('content_hash: restamped (rejected is terminal)');
    } else {
      // An approval only stands if no LATER reject entry exists for the slug —
      // approve-then-reject must resolve to rejected, not resurrect to verified.
      const approval = kbDir && relPath ? latestFor(kbDir, relPath, 'approve') : null;
      const rejection = kbDir && relPath ? latestFor(kbDir, relPath, 'reject') : null;
      const approvalStands = approval && (!rejection || approval.ts > rejection.ts);
      if (approvalStands && approval.content_hash === hash) {
        out = setField(out, 'trust', 'verified');
        out = setField(out, 'verified_at', date);
        changes.push('trust: verified (approval matches new hash)');
      } else if (data.trust === 'verified') {
        out = setField(out, 'trust', 'unverified');
        changes.push('trust: demoted to unverified (body changed after verification)');
      } else {
        changes.push('content_hash: updated');
      }
    }
  }

  // Crash recovery: a reject logged for THIS EXACT content (hash match) means a
  // reject was interrupted before the archive step — re-apply it. A differing
  // hash means new content at the same path (e.g. a regenerated draft): leave
  // it unverified for normal review, never kill new content with an old reject.
  // Gated to the non-mismatch paths (missing-hash freshly stamped, or equal):
  // an interrupted reject never alters the source file, so its hash field is
  // either absent or matching — the mismatch branch already has its own rules.
  if (!hashMismatched && kbDir && relPath &&
      parseFrontmatter(out).data.trust === 'unverified') {
    const rejection = latestFor(kbDir, relPath, 'reject');
    const approvalAfter = latestFor(kbDir, relPath, 'approve');
    if (rejection && rejection.content_hash === hash &&
        (!approvalAfter || approvalAfter.ts <= rejection.ts)) {
      out = setField(out, 'trust', 'rejected');
      out = setField(out, 'rejected_at', rejection.ts.slice(0, 10));
      changes.push('trust: rejected (re-applied interrupted reject from log)');
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
    try {
      const original = readFileSync(path, 'utf-8');
      const { content, changes } = validateFile(original, { author, relPath: rel, kbDir });
      if (changes.length === 0) continue;
      report.push({ file: rel, changes });
      if (apply) writeFileSync(path, content);
    } catch (err) {
      // One unreadable/unwritable file must not abort the whole sweep.
      report.push({ file: rel, changes: ['ERROR: ' + err.message] });
    }
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
      // Containment: a relative arg like ../../etc must not escape the vault.
      const abs = resolve(kbDir, f);
      if (!abs.startsWith(resolve(kbDir) + sep)) {
        console.error(`Path escapes vault: ${f}`);
        process.exitCode = 1;
        continue;
      }
      const original = readFileSync(abs, 'utf-8');
      const { content, changes } = validateFile(original, { relPath: f, kbDir });
      if (changes.length === 0) continue;
      report.push({ file: f, changes });
      if (apply) writeFileSync(abs, content);
    }
  }
  const mode = apply ? '' : '[dry-run] ';
  console.log(`${mode}${report.length} file(s) stamped/reconciled:`);
  for (const r of report) console.log(`  ${r.file}: ${r.changes.join('; ')}`);
  if (!apply && report.length) console.log('\nRe-run with --apply to write changes.');
}
