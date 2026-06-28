# Neuron Nucleus — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nucleus self-sustaining — a managed-region `MEMORY.md` generator that preserves curated sections, CONFIDENTIAL parity on the dashboard, a `links:` round-trip fix, a deterministic `neuron rollup` command, and a nightly launchd schedule — so the vault stays trimmed and current without manual upkeep.

**Architecture:** Five focused changes over the Phase 1 modules: fix link parsing in `projects.js`, add a CONFIDENTIAL filter to `command-center.js`, rewrite `memory-index.js` to splice a marker-delimited block (dedup projects → a single Command-Center pointer), add a `rollup` verb to `brain.js`, and a launchd plist. All deterministic and TDD-tested; no LLM calls in the default path.

**Tech Stack:** Node 24 ESM JavaScript, vitest, launchd.

## Global Constraints
- ES modules JS, Node 24, no TypeScript. Tests: vitest, `brain-cli/tests/*.test.js`, run from `brain-cli/` (`npx vitest run`).
- Reuse: `readProjectNodes`/`writeProjectNode` (`projects.js`), `parseFrontmatter` (`lib/frontmatter.js`, returns `{data, body, hasFm, raw}`), `buildCommandCenter` (`command-center.js`).
- Managed-region markers (exact): `<!-- neuron:projects:start -->` and `<!-- neuron:projects:end -->`.
- CONFIDENTIAL filter everywhere project content is emitted: `String(classification||'PRIVATE').toUpperCase() !== 'CONFIDENTIAL'` (case-insensitive). Every such filter needs a lowercase-`confidential` regression test.
- `MEMORY.md` ≤ 50 lines is a guideline: the generator WARNS (never throws) when exceeded.
- Tests use temp `kbDir`/`indexPath` (no real vault writes), inject linkers (no LLM/network).
- Conventional commits; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Scope note (cost-first):** the LLM "connect-pass over orphans" is an opt-in `--connect` flag, OFF by default. Default `rollup` is deterministic and free. Inbox-watcher auto-link is deferred to Phase 2.5 (entangles with `processText` routing; not worth the risk in this increment).

---

## Task 1: Fix `links:` round-trip in project nodes

**Files:**
- Modify: `brain-cli/projects.js`
- Test: `brain-cli/tests/projects.test.js` (add a case)

**Interfaces:**
- Produces: `readProjectNodes(kbDir)` now returns each node with `data.links` as a `string[]` of slugs (was `''`). Adds internal helper `parseLinks(rawFrontmatter) → string[]`.

- [ ] **Step 1: Write the failing test** (append to `tests/projects.test.js`)

```javascript
it('round-trips links: as an array of slugs (not empty string)', () => {
  writeProjectNode(kb, { slug: 'a', title: 'A', status: 'active', next_action: 'x', last_touched: '2026-06-28', links: ['b-node', 'c-node'] });
  const [node] = readProjectNodes(kb).filter(n => n.slug === 'a');
  expect(Array.isArray(node.data.links)).toBe(true);
  expect(node.data.links).toEqual(['b-node', 'c-node']);
});

it('returns empty array for a node with no links', () => {
  writeProjectNode(kb, { slug: 'd', title: 'D', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  const [node] = readProjectNodes(kb).filter(n => n.slug === 'd');
  expect(node.data.links).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd brain-cli && npx vitest run tests/projects.test.js`
Expected: FAIL — `node.data.links` is `''`, not an array.

- [ ] **Step 3: Implement** — add the helper and use `raw` from `parseFrontmatter` in `readProjectNodes`

```javascript
// add near top of projects.js, after imports
function parseLinks(rawFm) {
  const out = [];
  let inLinks = false;
  for (const line of String(rawFm).split('\n')) {
    if (/^links:\s*$/.test(line)) { inLinks = true; continue; }
    if (!inLinks) continue;
    const m = line.match(/^\s*-\s*"?\[\[([^\]]+)\]\]"?\s*$/);
    if (m) { out.push(m[1]); continue; }
    if (/^\S/.test(line)) break; // a new top-level key ends the list
  }
  return out;
}
```

In `readProjectNodes`, change the per-file parse to capture `raw` and override `data.links`:

```javascript
  const nodes = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const file = join(dir, f);
    const { data, body, raw } = parseFrontmatter(readFileSync(file, 'utf8'));
    data.links = parseLinks(raw);
    return { slug: f.replace(/\.md$/, ''), data, body, file };
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd brain-cli && npx vitest run tests/projects.test.js` → PASS. Then full suite `npx vitest run` → green.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/projects.js tests/projects.test.js
git commit -m "fix: links: frontmatter now round-trips as a string[] in project nodes"
```

---

## Task 2: CONFIDENTIAL parity in `buildCommandCenter`

**Files:**
- Modify: `brain-cli/command-center.js`
- Test: `brain-cli/tests/command-center.test.js` (add a case)

**Interfaces:** `buildCommandCenter(kbDir)` unchanged signature; now excludes CONFIDENTIAL nodes from the table.

- [ ] **Step 1: Write the failing test**

```javascript
it('excludes CONFIDENTIAL nodes (case-insensitive) from the dashboard', () => {
  const f = writeProjectNode(kb, { slug: 'secret', title: 'Secret', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  // flip to lowercase confidential to prove case-insensitivity
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: confidential'));
  writeProjectNode(kb, { slug: 'shown', title: 'Shown', status: 'active', next_action: 'y', last_touched: '2026-06-28' });
  const md = readFileSync(buildCommandCenter(kb), 'utf8');
  expect(md).not.toContain('[[secret]]');
  expect(md).toContain('[[shown]]');
});
```
(Ensure `writeFileSync`, `readFileSync` are imported in the test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd brain-cli && npx vitest run tests/command-center.test.js`
Expected: FAIL — `[[secret]]` currently appears.

- [ ] **Step 3: Implement** — add the filter in `command-center.js`

```javascript
  const nodes = readProjectNodes(kbDir)
    .filter(n => String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL');
```
(Replace the existing `const nodes = readProjectNodes(kbDir);` line.)

- [ ] **Step 4: Run to verify it passes** → task test PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/command-center.js tests/command-center.test.js
git commit -m "feat: Command-Center excludes CONFIDENTIAL nodes (parity with memory-index)"
```

---

## Task 3: Managed-region `MEMORY.md` generator

**Files:**
- Rewrite: `brain-cli/memory-index.js`
- Test: rewrite `brain-cli/tests/memory-index.test.js`

**Interfaces:** `buildMemoryIndex(kbDir, indexPath) → indexPath`. Now splices a marker-delimited projects block (a single Command-Center pointer + CONFIDENTIAL-excluded count) into an existing curated file, preserving everything outside the markers. Exports markers `PROJECTS_START`, `PROJECTS_END`.

- [ ] **Step 1: Write the failing tests** (replace file contents)

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { buildMemoryIndex, PROJECTS_START, PROJECTS_END } from '../memory-index.js';

let kb, memDir, idx;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), 'kb-'));
  memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  idx = join(memDir, 'MEMORY.md');
});
afterEach(() => { rmSync(kb, { recursive: true, force: true }); rmSync(memDir, { recursive: true, force: true }); });

function seedProjects(n) {
  for (let i = 0; i < n; i++) writeProjectNode(kb, { slug: `p${i}`, title: `P${i}`, status: 'active', next_action: 'x', last_touched: '2026-06-28' });
}

it('replaces ONLY the managed block, preserving curated sections', () => {
  seedProjects(3);
  const curated = `# Memory Index\n\n## Projects\n${PROJECTS_START}\nOLD\n${PROJECTS_END}\n\n## Feedback\n- keep me\n\n## Rules\n- keep me too\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('## Feedback\n- keep me');
  expect(out).toContain('## Rules\n- keep me too');
  expect(out).not.toContain('OLD');
  expect(out).toContain('Command-Center.md');
  expect(out).toMatch(/3 projects/);
});

it('is idempotent — second run with no change is byte-identical', () => {
  seedProjects(2);
  const curated = `# Memory Index\n\n## Projects\n${PROJECTS_START}\n\n${PROJECTS_END}\n\n## Rules\n- x\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const a = readFileSync(idx, 'utf8');
  buildMemoryIndex(kb, idx);
  const b = readFileSync(idx, 'utf8');
  expect(b).toBe(a);
});

it('missing markers → inserts under ## Projects, never overwrites the whole file', () => {
  seedProjects(1);
  const curated = `# Memory Index\n\n## Projects\n- stale line\n\n## Feedback\n- keep me\n`;
  writeFileSync(idx, curated);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('## Feedback\n- keep me');     // curated preserved
  expect(out).toContain(PROJECTS_START);                // markers now present
  expect(out).toContain(PROJECTS_END);
});

it('no file → creates a minimal index with the block', () => {
  seedProjects(1);
  buildMemoryIndex(kb, idx);
  const out = readFileSync(idx, 'utf8');
  expect(out).toContain('# Memory Index');
  expect(out).toContain(PROJECTS_START);
  expect(out).toContain('Command-Center.md');
});

it('excludes CONFIDENTIAL nodes from the count', () => {
  seedProjects(2);
  const f = join(kb, 'Projects', 'p0.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('classification: PRIVATE', 'classification: confidential'));
  writeFileSync(idx, `## Projects\n${PROJECTS_START}\n\n${PROJECTS_END}\n`);
  buildMemoryIndex(kb, idx);
  expect(readFileSync(idx, 'utf8')).toMatch(/1 projects/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd brain-cli && npx vitest run tests/memory-index.test.js`
Expected: FAIL — current module has no `PROJECTS_START` export and regenerates the whole file.

- [ ] **Step 3: Implement** (replace `memory-index.js`)

```javascript
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { readProjectNodes } from './projects.js';

export const PROJECTS_START = '<!-- neuron:projects:start -->';
export const PROJECTS_END = '<!-- neuron:projects:end -->';

function notConfidential(n) {
  return String(n.data.classification || 'PRIVATE').toUpperCase() !== 'CONFIDENTIAL';
}

function buildBlock(kbDir, indexPath) {
  const count = readProjectNodes(kbDir).filter(notConfidential).length;
  const rel = relative(dirname(indexPath), join(kbDir, 'Command-Center.md'));
  return [
    PROJECTS_START,
    `- [Command Center — all projects: status + next action](${rel}) — ${count} projects in Projects/`,
    PROJECTS_END,
  ].join('\n');
}

export function buildMemoryIndex(kbDir, indexPath) {
  const block = buildBlock(kbDir, indexPath);
  let out;

  if (existsSync(indexPath)) {
    const cur = readFileSync(indexPath, 'utf8');
    const s = cur.indexOf(PROJECTS_START);
    const e = cur.indexOf(PROJECTS_END);
    if (s !== -1 && e !== -1 && e > s) {
      // Replace ONLY the marked region (inclusive of end marker line).
      out = cur.slice(0, s) + block + cur.slice(e + PROJECTS_END.length);
    } else if (/^##\s+Projects\s*$/m.test(cur)) {
      // Markers missing but a Projects heading exists: insert block right after it.
      out = cur.replace(/^(##\s+Projects\s*)$/m, `$1\n${block}`);
    } else {
      // Fail-safe: never overwrite curated content — append a Projects section.
      out = cur.trimEnd() + `\n\n## Projects\n${block}\n`;
    }
  } else {
    out = `# Memory Index\n\n> Vault \`~/knowledge-base\` is canonical. Projects roll up in Command-Center.md.\n\n## Projects\n${block}\n`;
  }

  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, out);
  const lineCount = out.split('\n').length;
  if (lineCount > 50) console.warn(`[neuron] MEMORY.md is ${lineCount} lines (>50 guideline — trim curated sections).`);
  return indexPath;
}
```

- [ ] **Step 4: Run to verify it passes** → all 5 cases PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add brain-cli/memory-index.js tests/memory-index.test.js
git commit -m "feat: MEMORY.md generator splices a managed projects region (self-sustaining trim)"
```

---

## Task 4: `neuron rollup` command

**Files:**
- Modify: `brain-cli/brain.js` (import + handler + switch case)
- Test: `brain-cli/tests/rollup.test.js` (the orchestration core, extracted)

**Interfaces:** new `runRollup({ kbDir, indexPath }) → { commandCenter, memoryIndex }` exported from a small `brain-cli/rollup.js`; `brain.js` `case 'rollup'` calls it with env-derived paths. (Extracting the core into `rollup.js` keeps it unit-testable without spawning the CLI.)

- [ ] **Step 1: Write the failing test** (`tests/rollup.test.js`)

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectNode } from '../projects.js';
import { runRollup } from '../rollup.js';

let kb, memDir, idx;
beforeEach(() => { kb = mkdtempSync(join(tmpdir(),'kb-')); memDir = mkdtempSync(join(tmpdir(),'mem-')); idx = join(memDir,'MEMORY.md'); });
afterEach(() => { rmSync(kb,{recursive:true,force:true}); rmSync(memDir,{recursive:true,force:true}); });

it('regenerates Command-Center and splices MEMORY.md in one call', () => {
  writeProjectNode(kb, { slug: 'p', title: 'P', status: 'active', next_action: 'x', last_touched: '2026-06-28' });
  writeFileSync(idx, '## Projects\n<!-- neuron:projects:start -->\n\n<!-- neuron:projects:end -->\n');
  const r = runRollup({ kbDir: kb, indexPath: idx });
  expect(existsSync(r.commandCenter)).toBe(true);
  expect(existsSync(r.memoryIndex)).toBe(true);
  expect(readFileSync(join(kb,'Command-Center.md'),'utf8')).toContain('[[p]]');
  expect(readFileSync(idx,'utf8')).toContain('Command-Center.md');
});
```

- [ ] **Step 2: Run to verify it fails** → `Cannot find module '../rollup.js'`.

- [ ] **Step 3: Implement** `brain-cli/rollup.js`

```javascript
import { buildCommandCenter } from './command-center.js';
import { buildMemoryIndex } from './memory-index.js';

// Deterministic, free rollup: refresh the dashboard + splice the MEMORY.md projects region.
// (LLM connect-pass over orphans is a separate opt-in; not invoked here.)
export function runRollup({ kbDir, indexPath }) {
  const commandCenter = buildCommandCenter(kbDir);
  const memoryIndex = buildMemoryIndex(kbDir, indexPath);
  return { commandCenter, memoryIndex };
}
```

- [ ] **Step 4: Wire into `brain.js`** — add import, handler, and case

```javascript
import { runRollup } from './rollup.js';
```
```javascript
function cmdRollup() {
  const kbDir = KB_DIR;
  const indexPath = process.env.NEURON_MEMORY_INDEX
    || join(process.env.HOME, '.claude/projects/-Users-gianibrussich-project-claude/memory/MEMORY.md');
  const r = runRollup({ kbDir, indexPath });
  console.log(`✓ rollup: ${r.commandCenter}`);
  console.log(`✓ rollup: ${r.memoryIndex}`);
}
```
```javascript
      case 'rollup': cmdRollup(); break;
```

- [ ] **Step 5: Verify** — task test PASS; full suite green; manual:
```bash
KB_DIR="$(mktemp -d 2>/dev/null || echo $TMPDIR/kb-$$)" NEURON_MEMORY_INDEX="$TMPDIR/MEM.md" node brain-cli/brain.js rollup
```
Expected: prints two `✓ rollup:` lines; both files exist.

- [ ] **Step 6: Commit**

```bash
git add brain-cli/rollup.js brain-cli/brain.js tests/rollup.test.js
git commit -m "feat: 'neuron rollup' — deterministic dashboard + MEMORY.md refresh (cron target)"
```

---

## Task 5: Seed markers into the live MEMORY.md + verify self-sustaining (operational)

**Files:** none (operates on the real `~/.claude/.../memory/MEMORY.md`).

- [ ] **Step 1: Insert markers around the existing Command-Center pointer**
Edit the live `MEMORY.md`: wrap its current `## Projects` pointer line with `<!-- neuron:projects:start -->` / `<!-- neuron:projects:end -->`. (Hand-edit or a one-off node script.)

- [ ] **Step 2: Run rollup against the real paths**
```bash
NEURON_MEMORY_INDEX="$HOME/.claude/projects/-Users-gianibrussich-project-claude/memory/MEMORY.md" \
  node brain-cli/brain.js rollup
```

- [ ] **Step 3: Verify self-sustaining**
- `wc -l` on MEMORY.md ≤ 50.
- The Feedback/Rules/Preferences sections are unchanged (diff against the prior version).
- Run rollup a second time → `git`/`diff` shows no change (idempotent).
- `Command-Center.md` refreshed with all 15 nodes.

- [ ] **Step 4: Commit the vault** (Command-Center + any node changes), through the armed hook.

---

## Task 6: Nightly launchd schedule

**Files:**
- Create: `scripts/com.giani.neuron-rollup.plist` (template, copied to `~/Library/LaunchAgents/`)

**Interfaces:** a launchd agent that runs `neuron rollup` daily.

- [ ] **Step 1: Model on the existing plist** — read `~/Library/LaunchAgents/com.giani.knowledge-base.plist` for the exact format (label, ProgramArguments, StartCalendarInterval, Standard{Out,Error}Path, EnvironmentVariables).

- [ ] **Step 2: Write the plist** `scripts/com.giani.neuron-rollup.plist`
- `Label`: `com.giani.neuron-rollup`
- `ProgramArguments`: the node binary + absolute path to `brain-cli/brain.js` + `rollup`
- `EnvironmentVariables`: `NEURON_MEMORY_INDEX` (the real path), `KB_DIR` (default `~/knowledge-base`)
- `StartCalendarInterval`: daily at e.g. 06:00
- Log paths under `~/knowledge-base/logs/`

- [ ] **Step 3: Install + verify**
```bash
cp scripts/com.giani.neuron-rollup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.giani.neuron-rollup.plist
launchctl list | grep neuron-rollup     # confirm loaded
launchctl start com.giani.neuron-rollup # one manual fire
```
Expected: appears in `launchctl list`; the manual fire refreshes Command-Center + MEMORY.md and writes a log.

- [ ] **Step 4: Commit** the plist template
```bash
git add scripts/com.giani.neuron-rollup.plist
git commit -m "chore: nightly launchd schedule for 'neuron rollup'"
```

---

## Deferred to Phase 2.5 (explicit, not forgotten)
- **Inbox-watcher auto-link:** running `connections --auto` on notes produced by the existing `processText`/`cmdWatch` pipeline. Deferred — entangles with the route-then-archive flow; needs its own design pass.
- **LLM connect-pass over orphans:** a `neuron rollup --connect` (or `neuron connect-sweep`) that runs `findConnections(file,{auto:true})` over every orphan note. Deferred as opt-in because it incurs per-note model cost; the deterministic rollup above does not.

## Self-Review (author)
- **Spec coverage:** managed-region MEMORY.md (Task 3) ✓; CONFIDENTIAL parity (Task 2) ✓; links parser fix (Task 1) ✓; nightly schedule (Task 6) ✓; rollup target (Task 4) ✓. Inbox watcher + connect-pass explicitly deferred with rationale (spec Phase 2 listed them; cost/risk scoping documented).
- **Placeholders:** none — full code in every code step.
- **Type/name consistency:** `parseLinks` internal to projects.js; `PROJECTS_START`/`PROJECTS_END` exported by memory-index.js and consumed by tests + (optionally) Task 5; `runRollup({kbDir,indexPath})→{commandCenter,memoryIndex}` consumed by brain.js Task 4 and the rollup test.
- **Risk:** Task 1 deliberately does NOT modify the shared `parseFrontmatter` (used by the trust pipeline) — it parses links in `readProjectNodes` only, minimizing blast radius. Task 3's missing-marker path is fail-safe (never full-overwrite), explicitly tested.
