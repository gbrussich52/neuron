import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  collectReviewItems, renderReview, writeReviewIfChanged, archiveAged, parseCheckedSlugs,
} from '../review-surface.js';

let vault;
const CFG = { trust: { reverify_ttl_days: 180, aging_archive_days: 30 } };

function note(fields, body = 'Body text.') {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${fm}\n---\n\n# T\n${body}`;
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-rev-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('collectReviewItems', () => {
  it('routes notes into the four sections', () => {
    writeFileSync(join(vault, 'wiki/concepts/clean.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'claude', source: 'session', captured_at: '2026-06-09' }));
    writeFileSync(join(vault, 'wiki/concepts/mech.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'claude', captured_at: '2026-06-09' })); // missing source
    writeFileSync(join(vault, 'wiki/concepts/old.md'),
      note({ classification: 'PRIVATE', trust: 'verified', author: 'legacy', source: 'pre-neuron', verified_at: '2020-01-01' }));
    writeFileSync(join(vault, 'wiki/concepts/ok.md'),
      note({ classification: 'PRIVATE', trust: 'verified', author: 'giani', source: 'manual', verified_at: '2026-06-09' }));
    writeFileSync(join(vault, 'wiki/concepts/gone.md'),
      note({ classification: 'PRIVATE', trust: 'rejected', author: 'claude', source: 'session', rejected_at: '2026-06-09' }));
    const items = collectReviewItems(vault, CFG);
    expect(items.clean.map(i => i.slug)).toEqual(['wiki/concepts/clean.md']);
    expect(items.mechanical.map(i => i.slug)).toEqual(['wiki/concepts/mech.md']);
    expect(items.reverify.map(i => i.slug)).toEqual(['wiki/concepts/old.md']);
    expect(items.softFlags).toEqual([]);
  });
  it('merges sync flags from .neuron/flags.jsonl into mechanical', () => {
    mkdirSync(join(vault, '.neuron'), { recursive: true });
    writeFileSync(join(vault, '.neuron/flags.jsonl'),
      '{"file":"wiki/concepts/x.md","reason":"CONFIDENTIAL was tracked","ts":"2026-06-09T00:00:00Z"}\n');
    const items = collectReviewItems(vault, CFG);
    expect(items.mechanical[0]).toMatchObject({ slug: 'wiki/concepts/x.md' });
  });
  it('suppresses a lint contradiction when dismissed', () => {
    mkdirSync(join(vault, '.neuron'), { recursive: true });
    mkdirSync(join(vault, 'wiki'), { recursive: true });
    writeFileSync(join(vault, 'wiki/lint-report.json'),
      JSON.stringify({ contradictions: [{ id: 'c1', a: 'wiki/concepts/a.md', b: 'wiki/concepts/b.md', note: 'disagree' }] }));
    writeFileSync(join(vault, '.neuron/dismissed.json'), JSON.stringify(['c1']));
    expect(collectReviewItems(vault, CFG).softFlags).toEqual([]);
  });
});

describe('renderReview + writeReviewIfChanged (vector 13: idempotency)', () => {
  it('renders deterministically and only writes on change', () => {
    writeFileSync(join(vault, 'wiki/concepts/clean.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'claude', source: 'session', captured_at: '2026-06-09' }));
    const first = writeReviewIfChanged(vault, CFG);
    expect(first.changed).toBe(true);
    const content = readFileSync(join(vault, 'REVIEW.md'), 'utf-8');
    expect(content).toContain('## ① Mechanical fails');
    expect(content).toContain('## ④ Clean');
    expect(content).toContain('- [ ] `wiki/concepts/clean.md`');
    const second = writeReviewIfChanged(vault, CFG);
    expect(second.changed).toBe(false);
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toBe(content);
  });
});

describe('archiveAged (vector 12)', () => {
  it('moves unverified items idle past the window to Archive/_aged-review, provenance kept', () => {
    writeFileSync(join(vault, 'wiki/concepts/stale.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'nightly', source: 'neuron-research', captured_at: '2026-01-01' }));
    writeFileSync(join(vault, 'wiki/concepts/fresh.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'nightly', source: 'neuron-research', captured_at: '2099-01-01' }));
    const moved = archiveAged(vault, CFG);
    expect(moved).toEqual(['wiki/concepts/stale.md']);
    expect(existsSync(join(vault, 'wiki/concepts/stale.md'))).toBe(false);
    const archived = readFileSync(join(vault, 'Archive/_aged-review/2026-01-01-stale.md'), 'utf-8');
    expect(archived).toContain('archived_from: wiki/concepts/stale.md');
    expect(existsSync(join(vault, 'wiki/concepts/fresh.md'))).toBe(true);
  });
  it('never ages an item with no captured_at (cannot prove idleness)', () => {
    writeFileSync(join(vault, 'wiki/concepts/nodate.md'),
      note({ classification: 'PRIVATE', trust: 'unverified', author: 'nightly', source: 'neuron-research' }));
    expect(archiveAged(vault, CFG)).toEqual([]);
  });
});

describe('parseCheckedSlugs', () => {
  it('is section-aware: Clean → approve, Re-verify → reverify; unchecked ignored', () => {
    const review = [
      '## ③ Re-verify (verified, past TTL — still served until acted on)',
      '- [x] `wiki/concepts/old.md` — verified_at 2020-01-01',
      '- [ ] `wiki/concepts/old2.md` — verified_at 2020-02-01',
      '## ④ Clean — needs a yes',
      '- [X] `wiki/concepts/clean.md` — captured 2026-06-09',
      '- [ ] `wiki/concepts/clean2.md`',
    ].join('\n');
    expect(parseCheckedSlugs(review)).toEqual({
      approve: ['wiki/concepts/clean.md'],
      reverify: ['wiki/concepts/old.md'],
    });
  });
});
