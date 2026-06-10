// tests/review.test.js — `neuron review` now summarizes REVIEW.md state and
// applies checkbox decisions; the wiki/_review/ queue is retired.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runReview } from '../review.js';
import { parseFrontmatter } from '../lib/frontmatter.js';

let vault;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'neuron-revcmd-'));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  writeFileSync(join(vault, 'wiki/concepts/draft.md'),
    '---\nclassification: PRIVATE\ntrust: unverified\nauthor: nightly\nsource: neuron-research\ncaptured_at: 2026-06-09\n---\n\n# D\nbody');
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe('runReview', () => {
  it('regenerates REVIEW.md and lists the pending draft', async () => {
    await runReview([], vault);
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toContain('- [ ] `wiki/concepts/draft.md`');
  });
  it('`review apply` promotes checked boxes to verified', async () => {
    await runReview([], vault);
    const review = readFileSync(join(vault, 'REVIEW.md'), 'utf-8')
      .replace('- [ ] `wiki/concepts/draft.md`', '- [x] `wiki/concepts/draft.md`');
    writeFileSync(join(vault, 'REVIEW.md'), review);
    await runReview(['apply'], vault);
    expect(parseFrontmatter(readFileSync(join(vault, 'wiki/concepts/draft.md'), 'utf-8')).data.trust).toBe('verified');
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).not.toContain('- [x]');
  });
  it('`review apply` skips a nonexistent checked slug without throwing; valid slugs still approve', async () => {
    await runReview([], vault);
    // Check the valid draft AND inject a checked box for a file that does not exist,
    // both inside the Clean section so parseCheckedSlugs treats them as approvals.
    const review = readFileSync(join(vault, 'REVIEW.md'), 'utf-8')
      .replace(
        '- [ ] `wiki/concepts/draft.md`',
        '- [x] `wiki/concepts/ghost.md`\n- [x] `wiki/concepts/draft.md`'
      );
    writeFileSync(join(vault, 'REVIEW.md'), review);
    await expect(runReview(['apply'], vault)).resolves.not.toThrow();
    expect(parseFrontmatter(readFileSync(join(vault, 'wiki/concepts/draft.md'), 'utf-8')).data.trust).toBe('verified');
  });
  it('`review apply` with no REVIEW.md present generates one without crashing', async () => {
    expect(existsSync(join(vault, 'REVIEW.md'))).toBe(false);
    await expect(runReview(['apply'], vault)).resolves.not.toThrow();
    expect(existsSync(join(vault, 'REVIEW.md'))).toBe(true);
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toContain('- [ ] `wiki/concepts/draft.md`');
  });
});
