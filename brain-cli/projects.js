import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter } from './lib/frontmatter.js';

function projectsDir(kbDir) { return join(kbDir, 'Projects'); }

function parseLinks(rawFm) {
  const out = [];
  let inLinks = false;
  for (const line of String(rawFm).split('\n')) {
    if (/^links:\s*$/.test(line)) { inLinks = true; continue; }
    if (!inLinks) continue;
    const m = line.match(/^\s*-\s*"?\[\[([^\]]+)\]\]"?\s*$/);
    if (m) { out.push(m[1]); continue; }
    if (/^\S/.test(line)) break; // a new top-level key ends the list
  }
  return out;
}

export function writeProjectNode(kbDir, opts) {
  const { slug, title, status, next_action, blocker = '', last_touched, links = [], body = '' } = opts;
  const dir = projectsDir(kbDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const linkList = links.map(l => `  - "[[${l}]]"`).join('\n');
  const fm = [
    '---',
    'classification: PRIVATE',
    'type: project',
    `title: ${title}`,
    `status: ${status}`,
    `next_action: ${next_action}`,
    `blocker: ${blocker}`,
    `last_touched: ${last_touched}`,
    'links:',
    linkList,
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
    '## Related',
    ...links.map(l => `- [[${l}]]`),
    '',
  ].join('\n');
  const file = join(dir, `${slug}.md`);
  writeFileSync(file, fm);
  return file;
}

export function readProjectNodes(kbDir) {
  const dir = projectsDir(kbDir);
  if (!existsSync(dir)) return [];
  const nodes = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const file = join(dir, f);
    const { data, body, raw } = parseFrontmatter(readFileSync(file, 'utf8'));
    data.links = parseLinks(raw);
    return { slug: f.replace(/\.md$/, ''), data, body, file };
  });
  nodes.sort((a, b) => String(b.data.last_touched || '').localeCompare(String(a.data.last_touched || '')));
  return nodes;
}
