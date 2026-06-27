import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { timestamp, slugify } from './lib/util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default linker reuses the existing semantic cross-linker in --auto mode.
async function defaultLinker(file) {
  const { findConnections } = await import(join(__dirname, 'connections.js'));
  return findConnections(file, { auto: true, quiet: true });
}

export async function captureNote(text, opts = {}) {
  const {
    source = 'terminal',
    kbDir = process.env.KB_DIR || join(homedir(), 'knowledge-base'),
    linker = defaultLinker,
    now = () => new Date(),
  } = opts;

  const inbox = join(kbDir, 'Inbox');
  if (!existsSync(inbox)) mkdirSync(inbox, { recursive: true });

  const slug = slugify(text);
  const title = text.split('\n')[0].slice(0, 80);
  const file = join(inbox, `${timestamp()}_capture_${slug}.md`);
  const note = `---\nclassification: PRIVATE\ntype: idea\nsource: ${source}\ncaptured: ${now().toISOString()}\nstatus: raw\n---\n\n${text}\n`;
  writeFileSync(file, note);

  let links = [];
  try {
    const result = await linker(file);
    links = (result?.links || []).map(l => (typeof l === 'string' ? l : l.target));
  } catch {
    // Linking is best-effort; a capture must never be lost because linking failed.
  }
  return { file, title, slug, links };
}
