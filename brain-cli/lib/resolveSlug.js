// lib/resolveSlug.js — map a user-facing slug to a vault-relative note path.
// Accepts a vault-relative path verbatim (with or without .md), or a bare
// basename searched across the governed content dirs (walkMarkdown).
// Ambiguity is an error listing the candidates — never a guess.
import { existsSync } from 'fs';
import { basename, relative, resolve, sep } from 'path';
import { walkMarkdown } from '../migrate.js';

export function resolveSlug(kbDir, slug) {
  if (!slug) throw new Error('No slug given');
  if (slug.includes('/')) {
    const rel = slug.endsWith('.md') ? slug : `${slug}.md`;
    // Vault-boundary check: resolve normalizes `..`, so a traversal attempt
    // (e.g. "../outside/secret") lands outside kbDir and is rejected, never read.
    const abs = resolve(kbDir, rel);
    if (!abs.startsWith(resolve(kbDir) + sep)) {
      throw new Error(`Slug "${slug}" resolves outside the vault.`);
    }
    if (existsSync(abs)) return rel;
    throw new Error(`No note found at path "${rel}"`);
  }
  const name = slug.endsWith('.md') ? slug : `${slug}.md`;
  const matches = walkMarkdown(kbDir)
    .filter(p => basename(p) === name)
    .map(p => relative(kbDir, p));
  if (matches.length === 0) throw new Error(`No note found for slug "${slug}"`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous slug "${slug}" — matches:\n  ${matches.join('\n  ')}\nUse the full relative path.`);
  }
  return matches[0];
}
