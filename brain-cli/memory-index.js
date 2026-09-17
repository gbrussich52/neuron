import { writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'fs';
import { dirname, join, relative } from 'path';
import { readProjectNodes } from './projects.js';

export const PROJECTS_START = '<!-- neuron:projects:start -->';
export const PROJECTS_END = '<!-- neuron:projects:end -->';

function notConfidential(n) {
  return String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL';
}

// A relative link is only correct for the file's REAL location. `path.relative` is
// lexical -- it never resolves symlinks -- so calling this with the legacy alias
// ~/.claude/projects/-Users-gianibrussich-project-claude/memory (a symlink to
// project-claude/.claude/memory, one directory deeper) produced `../../../../`,
// right for the alias and dead for the real file. That is the whole of the
// Command-Center pointer bug that regressed six times between 09-05 and 09-16:
// which value landed depended on which path the caller happened to pass. Resolve
// both ends first and either caller yields the same, correct link.
function realDir(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;                       // not created yet: lexical is all we have
  }
}

function buildBlock(kbDir, indexPath) {
  const count = readProjectNodes(kbDir).filter(notConfidential).length;
  const rel = relative(realDir(dirname(indexPath)), join(realDir(kbDir), 'Command-Center.md'));
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
