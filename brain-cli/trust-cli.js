// trust-cli.js — neuron approve / reject / reverify (spec Component 2 + Approval
// Binding). Approval = an approvals.log entry bound to the CURRENT body hash,
// plus the direct frontmatter promotion; sync reconciles every machine against
// the log. Reject is terminal and archives (never deletes).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { parseFrontmatter, setField, hasField } from './lib/frontmatter.js';
import { computeContentHash } from './lib/contentHash.js';
import { appendEntry } from './lib/approvals.js';
import { resolveSlug } from './lib/resolveSlug.js';
import { writeReviewIfChanged } from './review-surface.js';
import { timestamp } from './lib/util.js';

const today = () => new Date().toISOString().slice(0, 10);
const defaultVault = () => process.env.KB_DIR || join(homedir(), 'knowledge-base');
const defaultApprover = () => process.env.NEURON_APPROVER || 'giani';

/**
 * Promote a note to trust: verified and bind the approval to the current
 * content hash in approvals.log. If source is missing, stamps source: manual
 * (approving a note IS providing the missing provenance).
 *
 * @param {string} kbDir  - vault root
 * @param {string} slug   - bare basename or vault-relative path
 * @param {string} approver
 * @returns {{ slug: string, content_hash: string }}
 */
export function approve(kbDir, slug, approver = defaultApprover()) {
  const rel = resolveSlug(kbDir, slug);
  const path = join(kbDir, rel);
  let content = readFileSync(path, 'utf-8');
  const hash = computeContentHash(content);

  // Write approval entry BEFORE frontmatter update. If the subsequent writeFileSync
  // fails, the log says approved but frontmatter lags — the next sync sweep
  // reconciles via hash matching. Acceptable (append-only audit integrity maintained).
  appendEntry(kbDir, { action: 'approve', slug: rel, content_hash: hash, approver });

  content = setField(content, 'trust', 'verified');
  content = setField(content, 'verified_at', today());
  content = setField(content, 'content_hash', hash);
  content = setField(content, 'needs_reverify', 'false');

  // Approving IS providing the missing provenance for a manually curated note.
  if (!hasField(content, 'source')) {
    content = setField(content, 'source', 'manual');
  }

  writeFileSync(path, content);
  writeReviewIfChanged(kbDir);
  return { slug: rel, content_hash: hash };
}

/**
 * Terminal rejection: stamps trust: rejected, moves (never deletes) the note
 * to Archive/ with a `rejected-<timestamp>-<basename>` prefix, and logs the action.
 *
 * @param {string} kbDir
 * @param {string} slug
 * @param {string} approver
 * @returns {{ slug: string, archived: string }}
 */
export function reject(kbDir, slug, approver = defaultApprover()) {
  const rel = resolveSlug(kbDir, slug);
  const path = join(kbDir, rel);
  let content = readFileSync(path, 'utf-8');

  appendEntry(kbDir, { action: 'reject', slug: rel, content_hash: computeContentHash(content), approver });

  content = setField(content, 'trust', 'rejected');
  content = setField(content, 'rejected_at', today());

  const destDir = join(kbDir, 'Archive');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `rejected-${timestamp()}-${basename(path)}`);

  writeFileSync(dest, content);
  rmSync(path);
  writeReviewIfChanged(kbDir);
  return { slug: rel, archived: dest };
}

/**
 * Restamp a note that is already trust: verified — updates verified_at to today
 * and clears needs_reverify. Throws if the note is not currently verified (use
 * approve instead for unverified notes).
 *
 * @param {string} kbDir
 * @param {string} slug
 * @param {string} approver
 * @returns {{ slug: string, verified_at: string }}
 */
export function reverify(kbDir, slug, approver = defaultApprover()) {
  const rel = resolveSlug(kbDir, slug);
  const path = join(kbDir, rel);
  let content = readFileSync(path, 'utf-8');
  const { data } = parseFrontmatter(content);

  if (data.trust !== 'verified') {
    throw new Error(
      `Cannot reverify "${rel}": trust is "${data.trust || 'unset'}", expected verified. Use approve instead.`
    );
  }

  appendEntry(kbDir, { action: 'reverify', slug: rel, content_hash: computeContentHash(content), approver });

  content = setField(content, 'verified_at', today());
  content = setField(content, 'needs_reverify', 'false');

  writeFileSync(path, content);
  writeReviewIfChanged(kbDir);
  return { slug: rel, verified_at: today() };
}

const VERBS = {
  approve: 'Approved',
  reject: 'Rejected → Archive/',
  reverify: 'Re-verified',
};

/**
 * CLI entry point shared by the approve, reject, and reverify commands.
 * Called from brain.js after dynamic import.
 *
 * @param {'approve'|'reject'|'reverify'} action
 * @param {string[]} args - remaining CLI argv after the command name
 * @param {string} [kbDir]
 */
export async function runTrustCommand(action, args, kbDir = defaultVault()) {
  const slug = args[0];
  if (!slug) {
    console.error(`Usage: neuron ${action} <slug>`);
    process.exitCode = 1;
    return;
  }
  try {
    // await is a no-op today (handlers are sync) but future-proofs the dispatch
    // if any handler grows an async step (e.g. remote log append).
    const result = await { approve, reject, reverify }[action](kbDir, slug);
    console.log(`${VERBS[action]}: ${result.slug}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
