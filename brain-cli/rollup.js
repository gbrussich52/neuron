import { buildCommandCenter } from './command-center.js';
import { buildMemoryIndex } from './memory-index.js';

// Deterministic, free rollup: refresh the dashboard + splice the MEMORY.md projects region.
// (LLM connect-pass over orphans is a separate opt-in; not invoked here.)
export function runRollup({ kbDir, indexPath }) {
  const commandCenter = buildCommandCenter(kbDir);
  const memoryIndex = buildMemoryIndex(kbDir, indexPath);
  return { commandCenter, memoryIndex };
}
