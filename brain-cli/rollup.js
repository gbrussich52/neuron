import { readFileSync, existsSync, realpathSync } from 'fs';
import { dirname, resolve } from 'path';
import { buildCommandCenter } from './command-center.js';
import { buildMemoryIndex } from './memory-index.js';

// Deterministic, free rollup: refresh the dashboard + splice the MEMORY.md projects region.
// (LLM connect-pass over orphans is a separate opt-in; not invoked here.)
export function runRollup({ kbDir, indexPath }) {
  const commandCenter = buildCommandCenter(kbDir);
  const memoryIndex = buildMemoryIndex(kbDir, indexPath);
  assertPointerResolves(memoryIndex);
  return { commandCenter, memoryIndex };
}

// MEMORY.md's dangling-pointer gate is a PreToolUse hook, so it only ever sees
// Claude's hands. This job is the other writer and walks straight past it -- which
// is why the Command-Center link could break six times under a live gate. Nothing
// but the writer can catch the writer: we just wrote Command-Center.md, so the link
// we emitted must resolve, and a rollup that emits a dead one fails now, loudly, in
// its own log rather than a week later in someone else's validator.
function assertPointerResolves(indexPath) {
  const real = existsSync(indexPath) ? realpathSync(indexPath) : indexPath;
  const body = readFileSync(real, 'utf8');
  const dead = [...body.matchAll(/\]\(((?:\.\.?\/)[^)]+)\)/g)]
    .map((m) => m[1].split('#')[0])
    .filter((link) => !existsSync(resolve(dirname(real), link)));
  if (dead.length) {
    throw new Error(
      `rollup wrote ${dead.length} pointer(s) that do not resolve from ${dirname(real)}: ` +
      `${dead.join(', ')}. The link is computed from the index path -- check that it was ` +
      'resolved through realpath before relative() (see memory-index.js).'
    );
  }
}
