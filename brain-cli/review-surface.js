// review-surface.js — REVIEW.md: the single approval surface (spec Component 2).
// Generated deterministically from tree state + .neuron/flags.jsonl, hash-guarded
// so a no-op regen produces zero churn (vector 13). Absolute dates only —
// relative ages would make every regen differ and create daily churn commits.
// Conflict rule: REVIEW.md is never hand-merged; discard both sides + regenerate.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, relative, basename } from 'path';
import { parseFrontmatter, setField } from './lib/frontmatter.js';
import { walkMarkdown } from './migrate.js';

const DAY_MS = 86400000;

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

/** A contradiction pair that already documents itself via reciprocal
 * `contradicts` relationships IS the resolution — suppress the flag. */
function hasReciprocalContradicts(kbDir, a, b) {
  if (!a || !b) return false;
  const check = (file, other) => {
    const path = join(kbDir, file);
    if (!existsSync(path)) return false;
    const { raw } = parseFrontmatter(readFileSync(path, 'utf-8'));
    return /type:\s*contradicts/i.test(raw) && raw.includes(basename(other, '.md'));
  };
  return check(a, b) && check(b, a);
}

/**
 * Collect every markdown file in governed content dirs into four buckets:
 *   mechanical  — hard fails (missing required fields, sync-detected problems)
 *   softFlags   — lint-reported contradictions not dismissed or self-documented
 *   reverify    — verified notes past TTL or explicitly flagged for re-check
 *   clean       — unverified notes with all required fields present (ready to approve)
 *
 * Rejected notes are terminal and excluded from all buckets.
 */
export function collectReviewItems(kbDir, config = {}) {
  const ttlDays = config.trust?.reverify_ttl_days ?? 180;
  const now = Date.now();
  const mechanical = [];
  const softFlags = [];
  const reverify = [];
  const clean = [];

  // ① Sync-detected issues that cannot be derived from tree state (rebase
  // conflicts, quarantined CONFIDENTIAL, push failures) — written by neuron-sync.sh.
  for (const f of readJsonl(join(kbDir, '.neuron', 'flags.jsonl'))) {
    mechanical.push({ slug: f.file || '(sync)', reason: f.reason || 'sync flag' });
  }

  for (const path of walkMarkdown(kbDir)) {
    const rel = relative(kbDir, path);
    const { data } = parseFrontmatter(readFileSync(path, 'utf-8'));
    if (data.trust === 'rejected') continue; // terminal — no further action needed

    if (data.trust === 'verified') {
      const verifiedAt = Date.parse(data.verified_at || '');
      const pastTtl = !Number.isNaN(verifiedAt) && (now - verifiedAt) / DAY_MS > ttlDays;
      const pastReviewAfter = data.review_after && Date.parse(data.review_after) < now;
      if (data.needs_reverify === 'true' || pastTtl || pastReviewAfter) {
        reverify.push({ slug: rel, reason: `verified_at ${data.verified_at || '?'}` });
      }
      continue;
    }

    // unverified (or missing trust entirely — fail-closed: treat as pending)
    const fails = [];
    if (!data.classification) fails.push('missing classification');
    if (!data.source) fails.push('missing source');
    if (!data.trust) fails.push('missing trust (unswept write)');
    if (fails.length) {
      mechanical.push({ slug: rel, reason: fails.join(', ') });
    } else {
      clean.push({ slug: rel, captured: data.captured_at || '' });
    }
  }

  // ② Soft flags: LLM-judged contradictions from the lint report, minus
  // dismissals (.neuron/dismissed.json) and reciprocal-relationship pairs.
  const dismissed = new Set(readJson(join(kbDir, '.neuron', 'dismissed.json'), []));
  const lint = readJson(join(kbDir, 'wiki', 'lint-report.json'), {});
  for (const c of lint.contradictions || []) {
    const id = c.id || `${c.a || ''}~${c.b || ''}`;
    if (dismissed.has(id)) continue;
    if (hasReciprocalContradicts(kbDir, c.a, c.b)) continue;
    softFlags.push({
      slug: c.a || '(unknown)',
      reason: `contradicts ${c.b || '?'}${c.note ? `: ${c.note}` : ''}`,
    });
  }

  const bySlug = (x, y) => x.slug.localeCompare(y.slug);
  mechanical.sort(bySlug);
  softFlags.sort(bySlug);
  reverify.sort(bySlug);
  clean.sort(bySlug);
  return { mechanical, softFlags, reverify, clean };
}

/**
 * Render all four sections as a deterministic string. Uses absolute dates only —
 * any Date.now()-relative value would cause a content change on every regen,
 * defeating the hash-guard in writeReviewIfChanged.
 */
export function renderReview(items) {
  const pending = items.mechanical.length + items.softFlags.length + items.clean.length;
  // oldest captured_at among clean items — purely informational, absolute date string
  const oldest = items.clean.map(c => c.captured).filter(Boolean).sort()[0] || null;
  const L = [];
  L.push('# REVIEW — Neuron approval surface');
  L.push('');
  L.push('> Auto-generated — never edit by hand (regenerated on every sync; rebase');
  L.push('> conflicts are resolved by regeneration). Check a box and run');
  L.push('> `scripts/neuron-sync.sh`, or use `neuron approve|reject|reverify <slug>`.');
  L.push('');
  L.push(`**Pending: ${pending}**${oldest ? ` (oldest: ${oldest})` : ''} · Re-verify: ${items.reverify.length}`);
  L.push('');
  L.push('## ① Mechanical fails');
  L.push('');
  if (!items.mechanical.length) L.push('_None._');
  for (const m of items.mechanical) L.push(`- \`${m.slug}\` — ${m.reason}`);
  L.push('');
  L.push('## ② Soft flags');
  L.push('');
  if (!items.softFlags.length) L.push('_None._');
  for (const s of items.softFlags) L.push(`- \`${s.slug}\` — ${s.reason}`);
  L.push('');
  L.push('## ③ Re-verify (verified, past TTL — still served until acted on)');
  L.push('');
  if (!items.reverify.length) L.push('_None._');
  for (const r of items.reverify) L.push(`- [ ] \`${r.slug}\` — ${r.reason}`);
  L.push('');
  L.push('## ④ Clean — needs a yes');
  L.push('');
  if (!items.clean.length) L.push('_None._');
  for (const c of items.clean) L.push(`- [ ] \`${c.slug}\`${c.captured ? ` — captured ${c.captured}` : ''}`);
  L.push('');
  return L.join('\n');
}

/**
 * Idempotent write: only touches REVIEW.md when content actually changed.
 * On a no-op regen (tree unchanged) the file is left byte-for-byte identical,
 * which means `git status` stays clean and no spurious commit is triggered.
 */
export function writeReviewIfChanged(kbDir, config = {}) {
  const content = renderReview(collectReviewItems(kbDir, config));
  const path = join(kbDir, 'REVIEW.md');
  const prior = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  if (prior === content) return { changed: false, path };
  writeFileSync(path, content);
  return { changed: true, path };
}

/**
 * Items idle past the aging window MOVE (never delete) to Archive/_aged-review/
 * with provenance frontmatter (archived_from, archived_at).
 *
 * Collision safety: if two notes from different subdirs share the same captured_at
 * and basename, the dest filename is suffixed with a counter (e.g. -2, -3) so no
 * write clobbers a previously archived file.
 *
 * No captured_at → cannot prove idleness → kept in place.
 */
export function archiveAged(kbDir, config = {}) {
  const agingDays = config.trust?.aging_archive_days ?? 30;
  const now = Date.now();
  const moved = [];
  const destDir = join(kbDir, 'Archive', '_aged-review');

  for (const path of walkMarkdown(kbDir)) {
    const rel = relative(kbDir, path);
    const content = readFileSync(path, 'utf-8');
    const { data } = parseFrontmatter(content);

    if (data.trust !== 'unverified') continue;

    // No captured_at → cannot prove idleness → keep
    const captured = Date.parse(data.captured_at || '');
    if (Number.isNaN(captured)) continue;
    if ((now - captured) / DAY_MS <= agingDays) continue;

    mkdirSync(destDir, { recursive: true });

    // Build the destination filename, adding provenance fields
    let stamped = setField(content, 'archived_from', rel);
    stamped = setField(stamped, 'archived_at', new Date().toISOString().slice(0, 10));

    // Collision-safe dest: suffix with counter if base name is already taken
    const base = `${data.captured_at}-${basename(path)}`;
    let destPath = join(destDir, base);
    if (existsSync(destPath)) {
      let counter = 2;
      const stem = base.replace(/\.md$/, '');
      while (existsSync(join(destDir, `${stem}-${counter}.md`))) counter++;
      destPath = join(destDir, `${stem}-${counter}.md`);
    }

    writeFileSync(destPath, stamped);
    rmSync(path);
    moved.push(rel);
  }

  return moved;
}

/**
 * Parse user-checked boxes out of REVIEW.md content. Section-aware:
 *   Re-verify section → reverify action
 *   Clean section     → approve action
 * Unchecked boxes and lines in other sections are ignored.
 * Handles both [x] and [X] (case-insensitive).
 */
export function parseCheckedSlugs(reviewContent) {
  const approve = [];
  const reverify = [];
  let section = '';
  for (const line of reviewContent.split('\n')) {
    if (line.startsWith('## ')) { section = line; continue; }
    const m = line.match(/^- \[x\] `([^`]+)`/i);
    if (!m) continue;
    if (section.includes('Re-verify')) reverify.push(m[1]);
    else if (section.includes('Clean')) approve.push(m[1]);
  }
  return { approve, reverify };
}
