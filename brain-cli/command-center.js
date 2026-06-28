import { writeFileSync } from 'fs';
import { join } from 'path';
import { readProjectNodes } from './projects.js';

export function buildCommandCenter(kbDir) {
  const nodes = readProjectNodes(kbDir)
    .filter(n => String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL');
  const rows = nodes.map(n => {
    const d = n.data;
    return `| [[${n.slug}]] | ${d.status || ''} | ${d.next_action || ''} | ${d.blocker || ''} | ${d.last_touched || ''} |`;
  });
  const md = [
    '---',
    'classification: PRIVATE',
    'type: dashboard',
    '---',
    '',
    '# Command Center',
    '',
    '> Where everything stands. Generated from Projects/ — edit the project notes, not this file.',
    '',
    '| Project | Status | Next action | Blocker | Last touched |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  const file = join(kbDir, 'Command-Center.md');
  writeFileSync(file, md);
  return file;
}
