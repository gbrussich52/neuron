import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildMemoryIndex, PROJECTS_START, PROJECTS_END } from '../memory-index.js';

let kb, memDir, idx;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), 'kb-'));
  memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  idx = join(memDir, 'MEMORY.md');
});
afterEach(() => { rmSync(kb, { recursive: true, force: true }); rmSync(memDir, { recursive: true, force: true }); });

function seedProjects(n) {
  for (let i = 0; i < n; i++) writeProjectNode(kb, { slug: `p${i}`, title: `P${i}`, status: 'active', next_action: 'x', last_touched: '2026-06-28' });
}

it('replaces ONLY the managed block, preserving curated sections', () => {
  seedProjects(3);
  const curated = `# Memory Index\n\n## Projects\n${PROJECTS_START}\nOLD\n${PROJECTS_END}\n\n## Feedback\n- keep me\n\n## Rules\n- keep me too\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('## Feedback\n- keep me');
  expect(out).toContain('## Rules\n- keep me too');
  expect(out).not.toContain('OLD');
  expect(out).toContain('Command-Center.md');
  expect(out).toMatch(/3 projects/);
});

it('is idempotent — second run with no change is byte-identical', () => {
  seedProjects(2);
  const curated = `# Memory Index\n\n## Projects\n${PROJECTS_START}\n\n${PROJECTS_END}\n\n## Rules\n- x\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const a = readFileSync(idx, 'utf8');
  buildMemoryIndex(kb, idx);
  const b = readFileSync(idx, 'utf8');
  expect(b).toBe(a);
});

it('missing markers → inserts under ## Projects, never overwrites the whole file', () => {
  seedProjects(1);
  const curated = `# Memory Index\n\n## Projects\n- stale line\n\n## Feedback\n- keep me\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('## Feedback\n- keep me');     // curated preserved
  expect(out).toContain(PROJECTS_START);                // markers now present
  expect(out).toContain(PROJECTS_END);
});

it('no file → creates a minimal index with the block', () => {
  seedProjects(1);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('# Memory Index');
  expect(out).toContain(PROJECTS_START);
  expect(out).toContain('Command-Center.md');
});

it('excludes CONFIDENTIAL nodes from the count', () => {
  seedProjects(2);
  const f = join(kb, 'Projects', 'p0.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: confidential'));
  writeFileSync(idx, `## Projects\n${PROJECTS_START}\n\n${PROJECTS_END}\n`);
  buildMemoryIndex(kb, idx);
  expect(readFileSync(idx, 'utf8')).toMatch(/1 projects/);
});
