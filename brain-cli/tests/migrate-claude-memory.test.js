import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateMemory } from '../../scripts/migrate-claude-memory.js';

let src, kb;
beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), 'src-'));
  kb = mkdtempSync(join(tmpdir(), 'kb-'));
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(kb, { recursive: true, force: true });
});

it('migrates a project_*.md into Projects/<slug>.md preserving links', () => {
  writeFileSync(
    join(src, 'project_ecom_brand.md'),
    `---\nclassification: PRIVATE\ntype: project\n---\n\nStoried & Blessed. See [[lulu-integration]].`
  );
  const res = migrateMemory(src, kb);
  expect(res.migrated).toContain('ecom-brand');
  const out = join(kb, 'Projects', 'ecom-brand.md');
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out, 'utf8')).toContain('[[lulu-integration]]');
});

it('skips CONFIDENTIAL files', () => {
  writeFileSync(
    join(src, 'project_secret.md'),
    `---\nclassification: CONFIDENTIAL\n---\n\nsecret`
  );
  const res = migrateMemory(src, kb);
  expect(res.skipped).toContain('secret');
  expect(existsSync(join(kb, 'Projects', 'secret.md'))).toBe(false);
});

it('skips confidential files (lowercase)', () => {
  writeFileSync(
    join(src, 'project_hidden.md'),
    `---\nclassification: confidential\n---\n\nhidden`
  );
  const res = migrateMemory(src, kb);
  expect(res.skipped).toContain('hidden');
  expect(existsSync(join(kb, 'Projects', 'hidden.md'))).toBe(false);
});
