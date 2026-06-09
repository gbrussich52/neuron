// lib/frontmatter.js — minimal YAML-frontmatter field read/write (no deps).
// Only supports flat `key: value` lines, which is all the vault uses for the
// classification/trust fields. Nested YAML (relationships:) is preserved verbatim.

// trailing \n* consumes the blank separator; setField re-adds exactly one blank line.
const FM_RE = /^---\n([\s\S]*?)\n---\n*/;

export function parseFrontmatter(content) {
  content = content.replace(/\r\n/g, '\n');
  const m = content.match(FM_RE);
  if (!m) return { data: {}, body: content, hasFm: false, raw: '' };
  const data = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (mm) data[mm[1].toLowerCase()] = mm[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: content.slice(m[0].length), hasFm: true, raw: m[1] };
}

export function hasField(content, key) {
  return key.toLowerCase() in parseFrontmatter(content).data;
}

export function setField(content, key, value) {
  content = content.replace(/\r\n/g, '\n');
  const m = content.match(FM_RE);
  const line = `${key}: ${value}`;
  if (!m) return `---\n${line}\n---\n\n${content}`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`^${escaped}\\s*:.*$`, 'im');
  let raw = m[1];
  const body = content.slice(m[0].length);
  raw = keyRe.test(raw) ? raw.replace(keyRe, line) : `${raw}\n${line}`;
  return `---\n${raw}\n---\n\n${body}`;
}
