import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { readProjectNodes } from './projects.js';

export function buildMemoryIndex(kbDir, indexPath) {
  const nodes = readProjectNodes(kbDir)
    .filter(n => String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL');
  const lines = nodes.map(n => {
    const d = n.data;
    return `- [${d.title || n.slug}](Projects/${n.slug}.md) — ${d.status || ''} — ${d.next_action || ''}`;
  });
  const md = [
    '# Memory Index',
    '',
    '> Generated from the Neuron vault Projects/ tree. Do not hand-edit — edit the project notes.',
    '',
    '## Projects',
    ...lines,
    '',
  ].join('\n');
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, md);
  return indexPath;
}
