/**
 * review.js — `neuron review`: the REVIEW.md surface (spec Component 2).
 * The old wiki/_review/ queue was retired in Plan 1; REVIEW.md (review-surface.js)
 * is the single approval surface.
 *
 * Subcommands:
 *   (none)        regenerate REVIEW.md + print the pending summary
 *   apply         apply checked boxes (Clean → approve, Re-verify → reverify)
 *   --age         also move unverified items idle past the window to Archive/_aged-review/
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { collectReviewItems, writeReviewIfChanged, archiveAged, parseCheckedSlugs } from './review-surface.js';
import { approve, reverify } from './trust-cli.js';

function defaultVault() {
  return process.env.KB_DIR || join(homedir(), 'knowledge-base');
}

export async function runReview(args, vaultRoot = defaultVault()) {
  let config = {};
  try {
    const { loadConfig } = await import('./providers.js');
    config = loadConfig();
  } catch (e) {
    // Temp vaults / missing module: silent defaults. Anything else (e.g. malformed
    // neuron.config.json in the real vault) must be visible — a silent fallback
    // would quietly swap the configured TTLs for defaults.
    if (e.code !== 'MODULE_NOT_FOUND') console.warn(`[neuron] config load failed — using defaults (${e.message})`);
  }

  if (args[0] === 'apply') {
    const reviewPath = join(vaultRoot, 'REVIEW.md');
    if (existsSync(reviewPath)) {
      const { approve: toApprove, reverify: toReverify } = parseCheckedSlugs(readFileSync(reviewPath, 'utf-8'));
      for (const slug of toApprove) {
        try { approve(vaultRoot, slug); console.log(`Approved: ${slug}`); }
        catch (e) { console.error(`approve ${slug}: ${e.message}`); }
      }
      for (const slug of toReverify) {
        try { reverify(vaultRoot, slug); console.log(`Re-verified: ${slug}`); }
        catch (e) { console.error(`reverify ${slug}: ${e.message}`); }
      }
    }
  }

  if (args.includes('--age')) {
    for (const moved of archiveAged(vaultRoot, config)) console.log(`Aged out → Archive/_aged-review/: ${moved}`);
  }

  const { changed } = writeReviewIfChanged(vaultRoot, config);
  const items = collectReviewItems(vaultRoot, config);
  const pending = items.mechanical.length + items.softFlags.length + items.clean.length;
  console.log(`REVIEW.md ${changed ? 'regenerated' : 'up to date'} — ${pending} pending, ${items.reverify.length} to re-verify`);
  const show = (title, arr, fmt) => {
    if (!arr.length) return;
    console.log(`\n${title}`);
    arr.forEach(i => console.log(fmt(i)));
  };
  show('Mechanical fails:', items.mechanical, i => `  ${i.slug} — ${i.reason}`);
  show('Soft flags:', items.softFlags, i => `  ${i.slug} — ${i.reason}`);
  show('Re-verify:', items.reverify, i => `  ${i.slug} — ${i.reason}`);
  show('Clean (needs a yes):', items.clean, i => `  ${i.slug}`);
  if (pending + items.reverify.length === 0) console.log('Nothing pending.');
  else console.log('\nAct with: neuron approve|reject|reverify <slug>, or check boxes in REVIEW.md and run neuron review apply');
}
