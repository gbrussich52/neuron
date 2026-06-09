// lib/contentHash.js — content-addressed approval binding (spec: Approval Binding).
// The hash covers ONLY the trimmed body (frontmatter excluded), so metadata stamps
// (trust, author, content_hash itself) never change the hash. parseFrontmatter
// normalizes CRLF, which makes the hash line-ending independent.
import { createHash } from 'crypto';
import { parseFrontmatter } from './frontmatter.js';

export function computeContentHash(content) {
  const { body } = parseFrontmatter(content);
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

/**
 * Compare the stored frontmatter content_hash to the computed one.
 * @returns {boolean|null} null when no content_hash is stored.
 */
export function hashMatches(content) {
  const { data } = parseFrontmatter(content);
  if (!data.content_hash) return null;
  return data.content_hash === computeContentHash(content);
}
