import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from '../brain-cli/lib/frontmatter.js';
import { writeProjectNode } from '../brain-cli/projects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrateMemory(srcDir, kbDir) {
  const migrated = [], skipped = [];
  if (!existsSync(srcDir)) return { migrated, skipped };

  for (const f of readdirSync(srcDir)) {
    if (!/^project_.*\.md$/.test(f)) continue;

    const slug = f.replace(/^project_/, '').replace(/\.md$/, '').replace(/_/g, '-');
    const raw = readFileSync(join(srcDir, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);

    if (String(data.classification || '').toUpperCase() === 'CONFIDENTIAL') {
      skipped.push(slug);
      continue;
    }

    const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
    writeProjectNode(kbDir, {
      slug,
      title: data.title || slug,
      status: data.status || 'active',
      next_action: data.next_action || 'review and set',
      blocker: data.blocker || '',
      last_touched: data.last_touched || '2026-06-27',
      links: [...new Set(links)],
      body: body || '',
    });
    migrated.push(slug);
  }

  return { migrated, skipped };
}

// CLI entry: `node scripts/migrate-claude-memory.js <srcDir> <kbDir>`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, kb] = process.argv.slice(2);
  const res = migrateMemory(src, kb || process.env.KB_DIR);
  console.log(`migrated: ${res.migrated.length}, skipped (confidential): ${res.skipped.length}`);
}
