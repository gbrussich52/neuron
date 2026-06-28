import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { readProjectNodes } from './projects.js';

export const PROJECTS_START = '<!-- neuron:projects:start -->';
export const PROJECTS_END = '<!-- neuron:projects:end -->';

function notConfidential(n) {
  return String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL';
}

function buildBlock(kbDir, indexPath) {
  const count = readProjectNodes(kbDir).filter(notConfidential).length;
  const rel = relative(dirname(indexPath), join(kbDir, 'Command-Center.md'));
  return [
    PROJECTS_START,
    `- [Command Center — all projects: status + next action](${rel}) — ${count} projects in Projects/`,
    PROJECTS_END,
  ].join('\n');
}

export function buildMemoryIndex(kbDir, indexPath) {
  const block = buildBlock(kbDir, indexPath);
  let out;

  if (existsSync(indexPath)) {
    const cur = readFileSync(indexPath, 'utf8');
    const s = cur.indexOf(PROJECTS_START);
    const e = cur.indexOf(PROJECTS_END);
    if (s !== -1 && e !== -1 && e > s) {
      // Replace ONLY the marked region (inclusive of end marker line).
      out = cur.slice(0, s) + block + cur.slice(e + PROJECTS_END.length);
    } else if (/^##\s+Projects\s*$/m.test(cur)) {
      // Markers missing but a Projects heading exists: insert block right after it.
      out = cur.replace(/^(##\s+Projects\s*)$/m, `$1\n${block}`);
    } else {
      // Fail-safe: never overwrite curated content — append a Projects section.
      out = cur.trimEnd() + `\n\n## Projects\n${block}\n`;
    }
  } else {
    out = `# Memory Index\n\n> Vault \`~/knowledge-base\` is canonical. Projects roll up in Command-Center.md.\n\n## Projects\n${block}\n`;
  }

  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, out);
  const lineCount = out.split('\n').length;
  if (lineCount > 50) console.warn(`[neuron] MEMORY.md is ${lineCount} lines (>50 guideline — trim curated sections).`);
  return indexPath;
}
