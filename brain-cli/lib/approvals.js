// lib/approvals.js — append-only JSONL audit log binding approvals to content
// hashes (spec: Approval Binding). approvals.log lives at the vault root and is
// committed, so every machine reconciles trust against the same record.
import { appendFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_NAME = 'approvals.log';

/** Append an audit entry. `approver` is required — audit records must never
 *  be silently attributed to a default identity. */
export function appendEntry(kbDir, { action, slug, content_hash, approver }) {
  if (!approver) throw new Error('appendEntry requires an explicit approver');
  const entry = {
    action,
    slug,
    content_hash: content_hash || null,
    approver,
    ts: new Date().toISOString(),
  };
  appendFileSync(join(kbDir, LOG_NAME), JSON.stringify(entry) + '\n');
  return entry;
}

export function readEntries(kbDir) {
  const path = join(kbDir, LOG_NAME);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/** Latest entry for a slug+action, or null. Later lines win (append-only log). */
export function latestFor(kbDir, slug, action = 'approve') {
  const matching = readEntries(kbDir).filter(e => e.slug === slug && e.action === action);
  return matching.length ? matching[matching.length - 1] : null;
}
