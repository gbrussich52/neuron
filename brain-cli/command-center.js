import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readProjectNodes } from './projects.js';

// Same delimiters as knowledge-base/scripts/neuron-health.sh's BANNER_START/END —
// that script splices an escalation banner into Command-Center.md at 03:07 when
// the nightly loop has failed repeatedly. This rollup runs at 06:00 and used to
// clobber the whole file with writeFileSync, silently wiping the banner every
// morning (found 2026-09-02). Read any existing banner out of the file before
// regenerating, then re-inject it in the same spot neuron-health.sh puts it:
// right after the frontmatter.
const BANNER_START = '<!-- neuron-health-banner -->';
const BANNER_END = '<!-- /neuron-health-banner -->';

function extractBanner(existingMd) {
  const start = existingMd.indexOf(BANNER_START);
  if (start === -1) return '';
  const endMarker = existingMd.indexOf(BANNER_END, start);
  if (endMarker === -1) return '';
  const end = endMarker + BANNER_END.length;
  // Include one trailing blank line if present, mirroring neuron-health.sh's own banner block.
  let sliceEnd = end;
  if (existingMd.slice(end, end + 2) === '\n\n') sliceEnd = end + 2;
  else if (existingMd[end] === '\n') sliceEnd = end + 1;
  return existingMd.slice(start, sliceEnd);
}

export function buildCommandCenter(kbDir) {
  const nodes = readProjectNodes(kbDir)
    .filter(n => String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL');
  const rows = nodes.map(n => {
    const d = n.data;
    return `| [[${n.slug}]] | ${d.status || ''} | ${d.next_action || ''} | ${d.blocker || ''} | ${d.last_touched || ''} |`;
  });
  const file = join(kbDir, 'Command-Center.md');
  let banner = '';
  if (existsSync(file)) {
    banner = extractBanner(readFileSync(file, 'utf8'));
  }
  const md = [
    '---',
    'classification: PRIVATE',
    'type: dashboard',
    '---',
    '',
    ...(banner ? [banner.replace(/\n+$/, '')] : []),
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
  writeFileSync(file, md);
  return file;
}
