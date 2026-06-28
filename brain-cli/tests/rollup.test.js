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
