/**
 * util.js — shared helpers for neuron brain-cli.
 */

/** Filesystem-safe timestamp: YYYY-MM-DD-HH-MM-SS (no colons, no 'T'). */
export function timestamp() {
  return new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
}

/** Lowercase slug: non-alphanumerics → underscore, optionally truncated. */
export function slugify(text, maxLength = 60) {
  return String(text)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase()
    .slice(0, maxLength);
}
