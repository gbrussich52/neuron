/**
 * connections.js — Cross-linker and gap detector for neuron
 *
 * Given a file, finds semantically related articles and suggests
 * wikilinks and new questions to explore. Supports interactive
 * approval (default) or --auto mode for automation.
 *
 * Exports:
 *   findConnections(filePath, opts)  — Analyze a file and suggest links
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.env.KB_DIR || join(homedir(), 'knowledge-base');

const { searchQuiet } = await import(join(__dirname, 'semantic.js'));
const { llmCall, loadConfig } = await import(join(__dirname, 'providers.js'));

// ── Helpers ───────────────────────────────────────────────────

function extractExistingLinks(content) {
  const links = new Set();
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.add(match[1].toLowerCase());
  }
  return links;
}

function askUser(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Main ──────────────────────────────────────────────────────

/**
 * Analyze a file and suggest connections.
 *
 * @param {string} filePath - Path to the file to analyze (absolute or relative to KB_DIR)
 * @param {Object} [opts]
 * @param {boolean} [opts.auto=false] - Auto-approve all suggestions
 * @param {boolean} [opts.quiet=false] - Suppress console output (return suggestions only)
 * @returns {Promise<{links: string[], questions: string[]}>}
 */
export async function findConnections(filePath, opts = {}) {
  const { auto = false, quiet = false } = opts;

  // Resolve path
  if (!filePath) {
    if (!quiet) console.log('Usage: neuron connections <file>');
    return { links: [], questions: [] };
  }

  const absPath = filePath.startsWith('/') ? filePath : join(KB_DIR, filePath);
  if (!existsSync(absPath)) {
    if (!quiet) console.error(`[neuron] File not found: ${filePath}`);
    return { links: [], questions: [] };
  }

  const content = readFileSync(absPath, 'utf-8');
  const relPath = relative(KB_DIR, absPath);
  const existingLinks = extractExistingLinks(content);

  if (!quiet) console.log(`[neuron] Finding connections for: ${relPath}\n`);

  // Step 1: Semantic search for related articles
  const related = await searchQuiet(content.slice(0, 2000), 8);

  // Filter out self-references
  const candidates = related.filter(r =>
    r.file !== relPath && r.score > 0.3
  );

  if (candidates.length === 0) {
    if (!quiet) console.log('  No related articles found. Build more wiki content first.');
    return { links: [], questions: [] };
  }

  // Step 2: Use LLM to suggest specific wikilinks and questions
  const candidateList = candidates
    .map((c, i) => `${i + 1}. [${(c.score * 100).toFixed(0)}%] ${c.file} — ${c.heading}: ${c.text.slice(0, 100)}`)
    .join('\n');

  const existingList = existingLinks.size > 0
    ? `Already linked: ${[...existingLinks].join(', ')}`
    : 'No existing wikilinks.';

  const suggestion = await llmCall({
    prompt: `You are a knowledge connection agent. Given a source file and related articles, suggest specific wikilinks and new questions.

## Source file
Path: ${relPath}
Content (first 1500 chars):
${content.slice(0, 1500)}

## Related articles found by semantic search
${candidateList}

## Existing links in this file
${existingList}

## Instructions
1. Suggest 2-3 specific [[wikilinks]] to add to the source file. Only suggest links to articles that actually exist in the candidate list. Format the link target as the concept filename without path or extension (e.g., [[water-filtration-business]]).
2. Suggest 1-2 new questions or topics worth exploring that bridge gaps between this file and the related articles.
3. If the source file already links to a candidate, skip it.

## Output format (EXACTLY this format, parseable)
LINKS:
- [[concept-name]] — reason to link (where in the source to add it)
- [[concept-name]] — reason to link

QUESTIONS:
- Question or topic to explore
- Question or topic to explore

If no good links exist, write "LINKS: none". Same for questions.`,
    tier: 'classify',
    maxTokens: 1000,
  });

  // Step 3: Parse suggestions
  const links = [];
  const questions = [];

  const linkSection = suggestion.match(/LINKS:\n([\s\S]*?)(?=QUESTIONS:|$)/);
  if (linkSection) {
    const linkLines = linkSection[1].split('\n').filter(l => l.trim().startsWith('- [['));
    for (const line of linkLines) {
      const linkMatch = line.match(/\[\[([^\]]+)\]\]/);
      if (linkMatch) {
        links.push({
          target: linkMatch[1],
          reason: line.replace(/^-\s*\[\[[^\]]+\]\]\s*—?\s*/, '').trim(),
        });
      }
    }
  }

  const questionSection = suggestion.match(/QUESTIONS:\n([\s\S]*?)$/);
  if (questionSection) {
    const qLines = questionSection[1].split('\n').filter(l => l.trim().startsWith('- '));
    for (const line of qLines) {
      const q = line.replace(/^-\s*/, '').trim();
      if (q && q !== 'none') questions.push(q);
    }
  }

  if (!quiet) {
    if (links.length > 0) {
      console.log('  Suggested wikilinks:');
      for (const link of links) {
        console.log(`    [[${link.target}]] — ${link.reason}`);
      }
    }
    if (questions.length > 0) {
      console.log('\n  Questions to explore:');
      for (const q of questions) {
        console.log(`    ? ${q}`);
      }
    }
    if (links.length === 0 && questions.length === 0) {
      console.log('  No new connections suggested.');
    }
  }

  // Step 4: Apply links (interactive or auto)
  const appliedLinks = [];

  if (links.length > 0) {
    if (auto) {
      // Auto mode: append a Related section at the end of the file
      const relatedSection = '\n\n## Related\n' +
        links.map(l => `- [[${l.target}]] — ${l.reason}`).join('\n') + '\n';

      // Only add if there isn't already a Related section
      if (!content.includes('## Related')) {
        writeFileSync(absPath, content.trimEnd() + relatedSection);
        appliedLinks.push(...links.map(l => l.target));
        if (!quiet) console.log(`\n  Auto-applied ${links.length} link(s) to Related section.`);
      }
    } else if (!quiet) {
      // Interactive mode
      console.log('');
      const answer = await askUser('  Apply these links? (y/n/q) ');
      if (answer === 'y' || answer === 'yes') {
        const relatedSection = '\n\n## Related\n' +
          links.map(l => `- [[${l.target}]] — ${l.reason}`).join('\n') + '\n';

        if (!content.includes('## Related')) {
          writeFileSync(absPath, content.trimEnd() + relatedSection);
          appliedLinks.push(...links.map(l => l.target));
          console.log(`  Applied ${links.length} link(s).`);
        } else {
          console.log('  File already has a Related section. Skipping.');
        }
      }
    }
  }

  // Log questions to wiki/queries/ if any
  if (questions.length > 0 && (auto || !quiet)) {
    const ts = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
    const qFile = join(KB_DIR, 'wiki', 'queries', `${ts}_gap_questions.md`);
    const qContent = [
      '---',
      'classification: PRIVATE',
      'type: gap-questions',
      `source: ${relPath}`,
      `generated: ${new Date().toISOString()}`,
      'tags: [auto-generated, connections]',
      '---',
      '',
      '# Questions from Connection Analysis',
      '',
      `Source: ${relPath}`,
      '',
      ...questions.map(q => `- ${q}`),
      '',
    ].join('\n');
    writeFileSync(qFile, qContent);
    if (!quiet) console.log(`  Questions filed to: ${basename(qFile)}`);
  }

  return { links: appliedLinks, questions };
}
