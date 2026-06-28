# Neuron Nucleus — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Neuron vault the single connected nucleus — capture-with-auto-link from the terminal and Discord, project status as linked nodes, a Command Center dashboard, and the harness `MEMORY.md` generated from the vault — by wiring thin glue over the existing `neuron` CLI engine.

**Architecture:** Add four small modules (`capture.js`, `projects.js`, `command-center.js`, `memory-index.js`) plus a migration script, all in `brain-cli/`. Each reuses existing primitives (`lib/util.js`, `lib/frontmatter.js`, `connections.js`) and is unit-tested against a temp vault via `KB_DIR` override and dependency injection — no test ever hits the real vault or an LLM. New CLI verbs are added to the `brain.js` command switch.

**Tech Stack:** Node 24 ESM JavaScript, vitest, Obsidian-flavored markdown with YAML frontmatter.

## Global Constraints

- Language/runtime: ES modules, Node 24. No TypeScript in this repo (it is JS).
- Tests: vitest, files `tests/**/*.test.js`, `environment: node`. Run with `npx vitest run`.
- Reuse (do NOT reimplement): `lib/util.js` → `timestamp()`, `slugify(text, maxLength=60)`; `lib/frontmatter.js` → `parseFrontmatter(md) → {data, body, hasFm}`, `setField(content, key, value)`; `connections.js` → `findConnections(filePath, {auto, quiet}) → {links, questions}` (auto mode appends a `## Related` section; links are `{target, reason}`).
- Vault path: `KB_DIR` env (default `~/knowledge-base`). Subdirs: `Inbox/`, `raw/`, new `Projects/`. Every test sets `KB_DIR` to a fresh temp dir.
- Classification: every note's frontmatter MUST carry `classification:` (PUBLIC|PRIVATE|CONFIDENTIAL). Default new captures to PRIVATE. CONFIDENTIAL content is NEVER migrated to a committable location and NEVER written into `MEMORY.md`.
- Harness memory index path (the file Claude auto-loads): `~/.claude/projects/-Users-gianibrussich-project-claude/memory/MEMORY.md`. Treated as a generated artifact; the index stays ≤ ~50 lines, one pointer line per project.
- Commits: conventional (`feat:`/`test:`/`chore:`), one per task minimum.
- No network in unit tests: inject the linker; default linker is the real `findConnections`.

---

## File Structure

- `brain-cli/capture.js` — Create. `captureNote(text, opts)`: write an Inbox idea note + auto-link it. One responsibility: turn raw text into a linked vault note.
- `brain-cli/projects.js` — Create. `writeProjectNode(opts)` + `readProjectNodes(kbDir)`: project-node read/write over `Projects/`.
- `brain-cli/command-center.js` — Create. `buildCommandCenter(kbDir)`: roll project nodes into `Command-Center.md`.
- `brain-cli/memory-index.js` — Create. `buildMemoryIndex(kbDir, indexPath)`: emit the harness `MEMORY.md` from project nodes.
- `brain-cli/discord-capture.js` — Create. `captureFromDiscord(msg, deps)`: thin adapter → `captureNote`.
- `scripts/migrate-claude-memory.js` — Create. One-shot migration of `~/.claude/.../memory/project_*.md` → `Projects/`.
- `brain.js` — Modify: add `capture`, `command-center`, `memory-index` verbs to the command switch (near line 633).
- `tests/capture.test.js`, `tests/projects.test.js`, `tests/command-center.test.js`, `tests/memory-index.test.js`, `tests/discord-capture.test.js` — Create.

---

## Task 1: Capture core — write a linked-ready Inbox note

**Files:**
- Create: `brain-cli/capture.js`
- Test: `tests/capture.test.js`

**Interfaces:**
- Consumes: `timestamp`, `slugify` from `./lib/util.js`.
- Produces: `captureNote(text, { source = 'terminal', kbDir = process.env.KB_DIR || join(homedir(),'knowledge-base'), linker = defaultLinker, now = () => new Date() }) → Promise<{ file, title, slug, links }>`. Writes `Inbox/<timestamp>_capture_<slug>.md`. `links` is `string[]` (link targets), empty if none.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/capture.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { captureNote } from '../capture.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

describe('captureNote', () => {
  it('writes a PRIVATE idea note to Inbox/ with frontmatter and body', async () => {
    const noopLinker = async () => ({ links: [] });
    const res = await captureNote('coffee subscription idea, faith angle',
      { source: 'terminal', kbDir: kb, linker: noopLinker });

    expect(existsSync(res.file)).toBe(true);
    expect(res.file).toContain(join(kb, 'Inbox'));
    const md = readFileSync(res.file, 'utf8');
    expect(md).toMatch(/classification: PRIVATE/);
    expect(md).toMatch(/type: idea/);
    expect(md).toMatch(/source: terminal/);
    expect(md).toMatch(/status: raw/);
    expect(md).toContain('coffee subscription idea, faith angle');
    expect(res.links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/capture.test.js`
Expected: FAIL — `Cannot find module '../capture.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// brain-cli/capture.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/capture.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/capture.js tests/capture.test.js
git commit -m "feat: captureNote writes linked-ready Inbox idea notes"
```

---

## Task 2: Capture auto-links via the existing engine

**Files:**
- Modify: `brain-cli/capture.js` (no signature change — verify link plumbing)
- Test: `tests/capture.test.js` (add a case)

**Interfaces:**
- Consumes: injected `linker` returning `{ links: [{target, reason}] }` (the real `findConnections` shape).
- Produces: same `captureNote`; asserts `links` are flattened to target strings.

- [ ] **Step 1: Write the failing test**

```javascript
// append to tests/capture.test.js
it('returns link targets from the linker (findConnections shape)', async () => {
  const fakeLinker = async () => ({
    links: [
      { target: 'storied-and-blessed', reason: 'faith' },
      { target: 'coffee', reason: 'domain' },
    ],
    questions: [],
  });
  const res = await captureNote('coffee + faith subscription',
    { kbDir: kb, linker: fakeLinker });
  expect(res.links).toEqual(['storied-and-blessed', 'coffee']);
});

it('never throws if the linker fails (capture is durable)', async () => {
  const boomLinker = async () => { throw new Error('semantic index down'); };
  const res = await captureNote('idea while offline', { kbDir: kb, linker: boomLinker });
  expect(res.links).toEqual([]);
  expect(existsSync(res.file)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `cd brain-cli && npx vitest run ../tests/capture.test.js`
Expected: PASS (the Task-1 implementation already flattens `{target}` and swallows linker errors). If either fails, fix `capture.js` accordingly.

- [ ] **Step 3: Commit**

```bash
git add tests/capture.test.js
git commit -m "test: capture flattens link targets and survives linker failure"
```

---

## Task 3: Wire `neuron capture "<text>"` into the CLI

**Files:**
- Modify: `brain-cli/brain.js` (command switch near line 633; add import)

**Interfaces:**
- Consumes: `captureNote` from `./capture.js`.
- Produces: CLI verb `capture` that prints `✓ captured → [[a]] [[b]]`.

- [ ] **Step 1: Add the import near the other imports in brain.js**

```javascript
import { captureNote } from './capture.js';
```

- [ ] **Step 2: Add the command handler function (near cmdBraindump)**

```javascript
async function cmdCapture(args) {
  const text = args.join(' ').trim();
  if (!text) { console.error('usage: neuron capture "<your idea>"'); process.exit(1); }
  const { file, links } = await captureNote(text, { source: 'terminal' });
  const linkStr = links.length ? links.map(t => `[[${t}]]`).join(' ') : '(no links yet)';
  console.log(`✓ captured → ${linkStr}`);
  console.log(`  ${file}`);
}
```

- [ ] **Step 3: Add the case to the command switch (alongside `case 'braindump'`)**

```javascript
      case 'capture': await cmdCapture(args); break;
```

- [ ] **Step 4: Manual verification against a throwaway vault**

Run:
```bash
KB_DIR="$(mktemp -d)" node brain-cli/brain.js capture "test idea: bundle water test with filtration install"
```
Expected: prints `✓ captured → ...` and a path under the temp `Inbox/`; the file exists and contains the text. (Links may be empty without a semantic index — that is fine here.)

- [ ] **Step 5: Commit**

```bash
git add brain-cli/brain.js
git commit -m "feat: add 'neuron capture' verb for terminal idea capture"
```

---

## Task 4: Project nodes — read/write `Projects/`

**Files:**
- Create: `brain-cli/projects.js`
- Test: `tests/projects.test.js`

**Interfaces:**
- Consumes: `parseFrontmatter` from `./lib/frontmatter.js`; `slugify` from `./lib/util.js`.
- Produces:
  - `writeProjectNode(kbDir, { slug, title, status, next_action, blocker = '', last_touched, links = [], body = '' }) → file path`. Writes `Projects/<slug>.md`.
  - `readProjectNodes(kbDir) → Array<{ slug, data, body, file }>` (sorted by `last_touched` desc; missing dates sort last).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/projects.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode, readProjectNodes } from '../projects.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('writes a project node with status frontmatter and links', () => {
  const file = writeProjectNode(kb, {
    slug: 'storied-and-blessed', title: 'Storied & Blessed',
    status: 'active', next_action: 'Grok art handoff', blocker: 'awaiting endpapers',
    last_touched: '2026-06-22', links: ['the-day-you-were-baptized', 'lulu-integration'],
    body: 'Faith childrens books.',
  });
  const md = readFileSync(file, 'utf8');
  expect(md).toMatch(/classification: PRIVATE/);
  expect(md).toMatch(/type: project/);
  expect(md).toMatch(/status: active/);
  expect(md).toMatch(/next_action: Grok art handoff/);
  expect(md).toContain('[[the-day-you-were-baptized]]');
});

it('reads project nodes sorted by last_touched desc', () => {
  writeProjectNode(kb, { slug: 'old', title: 'Old', status: 'active', next_action: 'x', last_touched: '2026-01-01' });
  writeProjectNode(kb, { slug: 'new', title: 'New', status: 'active', next_action: 'y', last_touched: '2026-06-22' });
  const nodes = readProjectNodes(kb);
  expect(nodes.map(n => n.slug)).toEqual(['new', 'old']);
  expect(nodes[0].data.status).toBe('active');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/projects.test.js`
Expected: FAIL — `Cannot find module '../projects.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// brain-cli/projects.js
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter } from './lib/frontmatter.js';

function projectsDir(kbDir) { return join(kbDir, 'Projects'); }

export function writeProjectNode(kbDir, opts) {
  const { slug, title, status, next_action, blocker = '', last_touched, links = [], body = '' } = opts;
  const dir = projectsDir(kbDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const linkList = links.map(l => `  - "[[${l}]]"`).join('\n');
  const fm = [
    '---',
    'classification: PRIVATE',
    'type: project',
    `title: ${title}`,
    `status: ${status}`,
    `next_action: ${next_action}`,
    `blocker: ${blocker}`,
    `last_touched: ${last_touched}`,
    'links:',
    linkList,
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
    '## Related',
    ...links.map(l => `- [[${l}]]`),
    '',
  ].join('\n');
  const file = join(dir, `${slug}.md`);
  writeFileSync(file, fm);
  return file;
}

export function readProjectNodes(kbDir) {
  const dir = projectsDir(kbDir);
  if (!existsSync(dir)) return [];
  const nodes = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const file = join(dir, f);
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    return { slug: f.replace(/\.md$/, ''), data, body, file };
  });
  nodes.sort((a, b) => String(b.data.last_touched || '').localeCompare(String(a.data.last_touched || '')));
  return nodes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/projects.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/projects.js tests/projects.test.js
git commit -m "feat: project nodes read/write over Projects/"
```

---

## Task 5: Command Center dashboard generator

**Files:**
- Create: `brain-cli/command-center.js`
- Test: `tests/command-center.test.js`

**Interfaces:**
- Consumes: `readProjectNodes` from `./projects.js`.
- Produces: `buildCommandCenter(kbDir) → file path`. Writes `Command-Center.md`: a table (project · status · next action · blocker · last touched) sorted by staleness, with each project name as a `[[wikilink]]`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/command-center.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildCommandCenter } from '../command-center.js';

let kb;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(), 'kb-')); });
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('builds a Command-Center.md table linking each project, sorted by last_touched', () => {
  writeProjectNode(kb, { slug: 'pap', title: 'Property Appraiser Pro', status: 'live', next_action: 'UAD export', last_touched: '2026-06-10' });
  writeProjectNode(kb, { slug: 'sb', title: 'Storied & Blessed', status: 'active', next_action: 'Grok art', blocker: 'endpapers', last_touched: '2026-06-22' });
  const file = buildCommandCenter(kb);
  const md = readFileSync(file, 'utf8');
  expect(file).toContain('Command-Center.md');
  expect(md).toMatch(/\| Project \| Status \| Next action \| Blocker \| Last touched \|/);
  // Most-recently-touched project appears first
  expect(md.indexOf('[[sb]]')).toBeLessThan(md.indexOf('[[pap]]'));
  expect(md).toContain('endpapers');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/command-center.test.js`
Expected: FAIL — `Cannot find module '../command-center.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// brain-cli/command-center.js
import { writeFileSync } from 'fs';
import { join } from 'path';
import { readProjectNodes } from './projects.js';

export function buildCommandCenter(kbDir) {
  const nodes = readProjectNodes(kbDir);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/command-center.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/command-center.js tests/command-center.test.js
git commit -m "feat: Command-Center dashboard generated from project nodes"
```

---

## Task 6: MEMORY.md generator (the split-brain keystone)

**Files:**
- Create: `brain-cli/memory-index.js`
- Test: `tests/memory-index.test.js`

**Interfaces:**
- Consumes: `readProjectNodes` from `./projects.js`.
- Produces: `buildMemoryIndex(kbDir, indexPath) → file path`. Emits ≤50-line pointer index (one line per project: `- [Title](Projects/<slug>.md) — <status> — <next_action>`). Skips any node whose `classification` is CONFIDENTIAL. Writes to `indexPath`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/memory-index.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildMemoryIndex } from '../memory-index.js';

let kb, idx;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), 'kb-'));
  idx = join(mkdtempSync(join(tmpdir(), 'mem-')), 'MEMORY.md');
});
afterEach(() => { rmSync(kb, { recursive: true, force: true }); });

it('emits one pointer line per project, newest first', () => {
  writeProjectNode(kb, { slug: 'sb', title: 'Storied & Blessed', status: 'active', next_action: 'Grok art', last_touched: '2026-06-22' });
  writeProjectNode(kb, { slug: 'pap', title: 'Property Appraiser Pro', status: 'live', next_action: 'UAD export', last_touched: '2026-06-10' });
  buildMemoryIndex(kb, idx);
  const md = readFileSync(idx, 'utf8');
  expect(md).toContain('- [Storied & Blessed](Projects/sb.md) — active — Grok art');
  expect(md.indexOf('sb.md')).toBeLessThan(md.indexOf('pap.md'));
});

it('never lists a CONFIDENTIAL project', () => {
  const f = writeProjectNode(kb, { slug: 'secret', title: 'Secret', status: 'active', next_action: 'x', last_touched: '2026-06-22' });
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: CONFIDENTIAL'));
  buildMemoryIndex(kb, idx);
  expect(readFileSync(idx, 'utf8')).not.toContain('secret');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/memory-index.test.js`
Expected: FAIL — `Cannot find module '../memory-index.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// brain-cli/memory-index.js
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { readProjectNodes } from './projects.js';

export function buildMemoryIndex(kbDir, indexPath) {
  const nodes = readProjectNodes(kbDir)
    .filter(n => String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL');
  const lines = nodes.map(n => {
    const d = n.data;
    return `- [${d.title || n.slug}](Projects/${n.slug}.md) — ${d.status || ''} — ${d.next_action || ''}`;
  });
  const md = [
    '# Memory Index',
    '',
    '> Generated from the Neuron vault Projects/ tree. Do not hand-edit — edit the project notes.',
    '',
    '## Projects',
    ...lines,
    '',
  ].join('\n');
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, md);
  return indexPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/memory-index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/memory-index.js tests/memory-index.test.js
git commit -m "feat: generate harness MEMORY.md index from vault project nodes"
```

---

## Task 7: One-shot migration — `.claude/memory` → `Projects/`

**Files:**
- Create: `scripts/migrate-claude-memory.js`
- Test: `tests/migrate-claude-memory.test.js`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../brain-cli/lib/frontmatter.js`; `writeProjectNode` from `../brain-cli/projects.js`.
- Produces: `migrateMemory(srcDir, kbDir) → { migrated: string[], skipped: string[] }`. Reads `project_*.md` from `srcDir`, derives slug from filename (`project_ecom_brand.md` → `ecom-brand`), writes a project node preserving body + any `[[links]]`. Skips CONFIDENTIAL files (adds to `skipped`). Pure transform + writes; deletes nothing.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/migrate-claude-memory.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateMemory } from '../scripts/migrate-claude-memory.js';

let src, kb;
beforeEach(() => { src = mkdtempSync(join(tmpdir(),'src-')); kb = mkdtempSync(join(tmpdir(),'kb-')); });
afterEach(() => { rmSync(src,{recursive:true,force:true}); rmSync(kb,{recursive:true,force:true}); });

it('migrates a project_*.md into Projects/<slug>.md preserving links', () => {
  writeFileSync(join(src,'project_ecom_brand.md'),
    `---\nclassification: PRIVATE\ntype: project\n---\n\nStoried & Blessed. See [[lulu-integration]].`);
  const res = migrateMemory(src, kb);
  expect(res.migrated).toContain('ecom-brand');
  const out = join(kb,'Projects','ecom-brand.md');
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out,'utf8')).toContain('[[lulu-integration]]');
});

it('skips CONFIDENTIAL files', () => {
  writeFileSync(join(src,'project_secret.md'),
    `---\nclassification: CONFIDENTIAL\n---\n\nsecret`);
  const res = migrateMemory(src, kb);
  expect(res.skipped).toContain('secret');
  expect(existsSync(join(kb,'Projects','secret.md'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/migrate-claude-memory.test.js`
Expected: FAIL — `Cannot find module '../scripts/migrate-claude-memory.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/migrate-claude-memory.js
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
    if (String(data.classification || '').toUpperCase() === 'CONFIDENTIAL') { skipped.push(slug); continue; }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/migrate-claude-memory.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-claude-memory.js tests/migrate-claude-memory.test.js
git commit -m "feat: one-shot migration of .claude project memory into vault Projects/"
```

---

## Task 8: Discord capture adapter

**Files:**
- Create: `brain-cli/discord-capture.js`
- Test: `tests/discord-capture.test.js`

**Interfaces:**
- Consumes: `captureNote` from `./capture.js` (injectable via `deps.capture`).
- Produces: `captureFromDiscord({ text }, deps = {}) → Promise<{ reply, file, links }>`. Calls capture with `source:'discord'`, returns a human reply string `✓ captured → [[a]] [[b]]`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/discord-capture.test.js
import { describe, it, expect } from 'vitest';
import { captureFromDiscord } from '../discord-capture.js';

it('captures a discord message and returns a reply with link chips', async () => {
  const fakeCapture = async (text, opts) => {
    expect(opts.source).toBe('discord');
    return { file: '/x/Inbox/n.md', title: text, slug: 'n', links: ['westchester-water', 'rental-property'] };
  };
  const res = await captureFromDiscord({ text: 'bundle water test + install' }, { capture: fakeCapture });
  expect(res.reply).toBe('✓ captured → [[westchester-water]] [[rental-property]]');
  expect(res.links).toEqual(['westchester-water', 'rental-property']);
});

it('replies cleanly when no links found', async () => {
  const fakeCapture = async () => ({ file: '/x/n.md', links: [] });
  const res = await captureFromDiscord({ text: 'lone idea' }, { capture: fakeCapture });
  expect(res.reply).toBe('✓ captured → (no links yet)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain-cli && npx vitest run ../tests/discord-capture.test.js`
Expected: FAIL — `Cannot find module '../discord-capture.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// brain-cli/discord-capture.js
import { captureNote } from './capture.js';

export async function captureFromDiscord(msg, deps = {}) {
  const capture = deps.capture || captureNote;
  const { file, links = [] } = await capture(msg.text, { source: 'discord' });
  const reply = links.length
    ? `✓ captured → ${links.map(t => `[[${t}]]`).join(' ')}`
    : '✓ captured → (no links yet)';
  return { reply, file, links };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain-cli && npx vitest run ../tests/discord-capture.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/discord-capture.js tests/discord-capture.test.js
git commit -m "feat: discord capture adapter over captureNote"
```

> **Wiring note (not code):** the live Discord path runs inside a session where Giani has messaged the gateway — the handler calls `captureFromDiscord({text}, {})` and replies with `res.reply`. The reply-only transport (per the Discord MCP) means this responds to inbound messages; an unprompted push is out of Phase-1 scope.

---

## Task 9: Full-suite green + run the real migration once

**Files:** none (operational)

- [ ] **Step 1: Run the whole test suite**

Run: `cd brain-cli && npx vitest run`
Expected: all prior 116 tests PLUS the new suites PASS.

- [ ] **Step 2: Snapshot the vault before mutating it (reversibility)**

```bash
cd ~/knowledge-base && git add -A && git commit -m "chore: pre-nucleus snapshot" || echo "nothing to commit"
```

- [ ] **Step 3: Run the migration against the real stores**

```bash
node ~/project-claude/llm-knowledge-base/scripts/migrate-claude-memory.js \
  ~/.claude/projects/-Users-gianibrussich-project-claude/memory \
  ~/knowledge-base
```
Expected: prints migrated/skipped counts; `~/knowledge-base/Projects/` now holds one node per project.

- [ ] **Step 4: Generate Command Center + MEMORY.md**

```bash
node -e "import('file://$HOME/project-claude/llm-knowledge-base/brain-cli/command-center.js').then(m=>console.log(m.buildCommandCenter(process.env.HOME+'/knowledge-base')))"
node -e "import('file://$HOME/project-claude/llm-knowledge-base/brain-cli/memory-index.js').then(m=>console.log(m.buildMemoryIndex(process.env.HOME+'/knowledge-base', process.env.HOME+'/.claude/projects/-Users-gianibrussich-project-claude/memory/MEMORY.md')))"
```
Expected: `Command-Center.md` exists at vault root; `MEMORY.md` regenerated. **Manually confirm the new `MEMORY.md` still reads sensibly before trusting it** (this is the keystone risk).

- [ ] **Step 5: Verify the graph claim**

Open Obsidian → Graph view. Expected: project nodes appear as hubs; orphan ratio visibly down. Spot-check that a captured idea's `## Related` links resolve.

---

## Self-Review (completed by author)

- **Spec coverage:** Capture path (Tasks 1–3, 8) ✓; split-brain unification (Tasks 6, 7) ✓; project layer + command center (Tasks 4, 5) ✓; verification (Task 9) ✓. Deferred per spec phasing: Obsidian Inbox watcher + nightly schedule (Phase 2), voice (Phase 3) — not in this plan by design.
- **Placeholder scan:** none — every code step contains full source.
- **Type/name consistency:** `captureNote(text, opts)` returns `{file,title,slug,links}` used consistently in Tasks 3 & 8; `writeProjectNode(kbDir, opts)`/`readProjectNodes(kbDir)` consumed unchanged by Tasks 5–7; `buildMemoryIndex(kbDir, indexPath)` and `buildCommandCenter(kbDir)` signatures match their call sites in Task 9.
- **Known follow-ups (Phase 2):** idempotency of re-running auto-link (skip if `## Related` exists — already handled inside `connections.js`); scheduled connect+rollup job; wiring the Inbox watcher to call `findConnections` on change.
