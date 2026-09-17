import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, realpathSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
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

// --- The pointer that broke six times ----------------------------------------
//
// 09-05, 09-09, 09-10, 09-12, 09-13, 09-16: the Command-Center link in MEMORY.md
// flipped between three and four `../` levels and was hand-fixed each time. The
// writer was never wrong about the block, only about where the file lives:
// `~/.claude/projects/-Users-gianibrussich-project-claude/memory` is a symlink to
// `project-claude/.claude/memory`, one directory deeper, and `path.relative` is
// lexical. Whichever path the caller passed decided which link got written.
it('a symlinked index path yields the link the REAL file needs', () => {
  seedProjects(1);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alias-')));
  try {
    const vault = join(root, 'knowledge-base');
    const real = join(root, 'project-claude', '.claude', 'memory');
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    mkdirSync(real, { recursive: true });
    writeFileSync(join(vault, 'Command-Center.md'), '# CC\n');

    // The alias sits one level deeper than the file it points at — exactly the
    // shape that produced the extra `../`.
    const aliasParent = join(root, 'home', 'projects', 'slug');
    mkdirSync(aliasParent, { recursive: true });
    const alias = join(aliasParent, 'memory');
    symlinkSync(real, alias);

    buildMemoryIndex(vault, join(alias, 'MEMORY.md'));

    const link = readFileSync(join(real, 'MEMORY.md'), 'utf8')
      .match(/\]\(([^)]*Command-Center\.md)\)/)[1];
    // The only assertion that matters: resolved from where the file actually is,
    // the link lands on the real Command-Center.md.
    expect(resolve(real, link)).toBe(join(vault, 'Command-Center.md'));
    expect(existsSync(resolve(real, link))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('both aliases of the same index write the identical link', () => {
  seedProjects(1);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alias2-')));
  try {
    const vault = join(root, 'knowledge-base');
    const real = join(root, 'a', 'b', 'memory');
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    mkdirSync(real, { recursive: true });
    writeFileSync(join(vault, 'Command-Center.md'), '# CC\n');
    const aliasParent = join(root, 'x', 'y', 'z');
    mkdirSync(aliasParent, { recursive: true });
    symlinkSync(real, join(aliasParent, 'memory'));

    const linkFrom = (p) => {
      buildMemoryIndex(vault, p);
      return readFileSync(join(real, 'MEMORY.md'), 'utf8')
        .match(/\]\(([^)]*Command-Center\.md)\)/)[1];
    };
    expect(linkFrom(join(aliasParent, 'memory', 'MEMORY.md')))
      .toBe(linkFrom(join(real, 'MEMORY.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
