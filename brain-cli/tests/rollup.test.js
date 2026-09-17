import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { runRollup } from '../rollup.js';

let kb, memDir, idx;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(),'kb-')); memDir = mkdtempSync(join(tmpdir(),'mem-')); idx = join(memDir,'MEMORY.md'); });
afterEach(() => { rmSync(kb,{recursive:true,force:true}); rmSync(memDir,{recursive:true,force:true}); });

it('regenerates Command-Center and splices MEMORY.md in one call', () => {
  writeProjectNode(kb, { slug: 'p', title: 'P', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  writeFileSync(idx, '## Projects\n<!-- neuron:projects:start -->\n\n<!-- neuron:projects:end -->\n');
  const r = runRollup({ kbDir: kb, indexPath: idx });
  expect(existsSync(r.commandCenter)).toBe(true);
  expect(existsSync(r.memoryIndex)).toBe(true);
  expect(readFileSync(join(kb,'Command-Center.md'),'utf8')).toContain('[[p]]');
  expect(readFileSync(idx,'utf8')).toContain('Command-Center.md');
});

// The rollup is MEMORY.md's second writer and never passes through the PreToolUse
// dangling-pointer hook that guards Claude's edits. It has to catch itself.
it('a dead pointer in the index fails the rollup, loudly', () => {
  writeProjectNode(kb, { slug: 'p', title: 'P', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  writeFileSync(idx, '## Projects\n<!-- neuron:projects:start -->\n\n<!-- neuron:projects:end -->\n\n- [gone](./deleted-note.md)\n');
  expect(() => runRollup({ kbDir: kb, indexPath: idx })).toThrow(/do not resolve.*deleted-note\.md/s);
});

it('a curated index whose pointers all resolve passes', () => {
  writeProjectNode(kb, { slug: 'p', title: 'P', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  writeFileSync(join(memDir, 'real-note.md'), '# here\n');
  writeFileSync(idx, '## Projects\n<!-- neuron:projects:start -->\n\n<!-- neuron:projects:end -->\n\n- [here](./real-note.md)\n');
  expect(() => runRollup({ kbDir: kb, indexPath: idx })).not.toThrow();
});
