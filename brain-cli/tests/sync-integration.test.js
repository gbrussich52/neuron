// tests/sync-integration.test.js — exercises the VAULT's neuron-sync.sh inside
// disposable git repos. Skips when the vault scripts are not on this machine.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(__dirname, '..', 'brain.js');
const SCRIPTS = process.env.KB_SCRIPTS || join(homedir(), 'knowledge-base', 'scripts');
const HAVE = existsSync(join(SCRIPTS, 'neuron-sync.sh'));

// A well-formed unverified private note — used as the baseline "safe" content.
const UNVERIFIED =
  '---\nclassification: PRIVATE\ntrust: unverified\nauthor: claude\nsource: session\ncaptured_at: 2026-06-09\n---\n\n# Note\nSafe body text.';

/**
 * Run a shell command inside a disposable vault.
 * NEURON_NO_LLM=1 suppresses the llm-run call so tests are hermetic.
 */
function sh(cmd, cwd, env = {}) {
  return execSync(cmd, {
    cwd,
    env: {
      ...process.env,
      ...env,
      KB_DIR: cwd,
      NEURON_BIN: `node ${BRAIN}`,
      NEURON_NO_LLM: '1',
    },
    encoding: 'utf-8',
  });
}

/**
 * Create a minimal but realistic vault: git-init with main branch,
 * copy the three vault scripts that neuron-sync.sh depends on.
 * The initial commit ("init") establishes a HEAD so later `git diff HEAD`
 * comparisons work correctly.
 */
function makeVault() {
  const vault = mkdtempSync(join(tmpdir(), 'neuron-sync-'));

  execSync(
    'git init -q -b main && git config user.email t@t.t && git config user.name t && git config commit.gpgsign false',
    { cwd: vault }
  );

  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(vault, 'scripts'), { recursive: true });

  for (const s of ['neuron-sync.sh', 'classify-check.sh', 'auto-commit.sh']) {
    cpSync(join(SCRIPTS, s), join(vault, 'scripts', s));
  }
  execSync('chmod +x scripts/*.sh', { cwd: vault });

  // .gitignore: mirrors real vault — .neuron/ must be ignored so flags.jsonl
  // and the lock dir never count as untracked files for the "nothing to commit" check.
  writeFileSync(join(vault, '.gitignore'), 'Inbox/\n.neuron/\n');
  execSync('git add -A && git commit -qm init', { cwd: vault });

  return vault;
}

describe.skipIf(!HAVE)('neuron-sync chokepoint', () => {
  let vault;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  // -------------------------------------------------------------------
  // Vector 1: CONFIDENTIAL in a mixed batch — safe files commit,
  // CONFIDENTIAL is untracked+gitignored, file is NOT deleted from disk.
  // -------------------------------------------------------------------
  it('vector 1: one CONFIDENTIAL in a batch — safe files commit, CONFIDENTIAL quarantined, never deleted', () => {
    writeFileSync(join(vault, 'wiki/concepts/safe.md'), UNVERIFIED);
    writeFileSync(
      join(vault, 'wiki/concepts/secret.md'),
      '---\nclassification: CONFIDENTIAL\n---\n\n# Secret'
    );

    sh('bash scripts/neuron-sync.sh', vault);

    const tracked = sh('git ls-files', vault);
    expect(tracked).toContain('wiki/concepts/safe.md');
    expect(tracked).not.toContain('wiki/concepts/secret.md');

    // .gitignore must record the quarantine path.
    expect(readFileSync(join(vault, '.gitignore'), 'utf-8')).toContain('wiki/concepts/secret.md');

    // The file must still exist on disk — quarantine ≠ deletion.
    expect(existsSync(join(vault, 'wiki/concepts/secret.md'))).toBe(true);

    // REVIEW.md must surface the flag.
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toContain('wiki/concepts/secret.md');
  });

  // -------------------------------------------------------------------
  // Vector 6: a checked box in REVIEW.md promotes trust on the next sync.
  // -------------------------------------------------------------------
  it('vector 6: a checked box in REVIEW.md promotes on the next sync', () => {
    writeFileSync(
      join(vault, 'wiki/concepts/draft.md'),
      UNVERIFIED.replace('# Note', '# Draft')
    );

    sh('bash scripts/neuron-sync.sh', vault);

    const review = readFileSync(join(vault, 'REVIEW.md'), 'utf-8');
    expect(review).toContain('- [ ] `wiki/concepts/draft.md`');

    // Simulate a human checking the box.
    writeFileSync(
      join(vault, 'REVIEW.md'),
      review.replace('- [ ] `wiki/concepts/draft.md`', '- [x] `wiki/concepts/draft.md`')
    );

    sh('bash scripts/neuron-sync.sh', vault);

    const note = readFileSync(join(vault, 'wiki/concepts/draft.md'), 'utf-8');
    expect(note).toContain('trust: verified');

    expect(readFileSync(join(vault, 'approvals.log'), 'utf-8')).toContain(
      '"slug":"wiki/concepts/draft.md"'
    );
  });

  // -------------------------------------------------------------------
  // Vector 14: raw unstamped write gets swept to unverified + listed in REVIEW.md.
  // -------------------------------------------------------------------
  it('vector 14: a raw unstamped write is swept to unverified and listed in REVIEW.md', () => {
    writeFileSync(join(vault, 'wiki/concepts/raw.md'), '# Raw\njust text');

    sh('bash scripts/neuron-sync.sh', vault, { NEURON_AUTHOR: 'claude' });

    const note = readFileSync(join(vault, 'wiki/concepts/raw.md'), 'utf-8');
    expect(note).toContain('trust: unverified');

    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toContain('wiki/concepts/raw.md');
  });

  // -------------------------------------------------------------------
  // Vector 13: second no-change sync produces NO new commit (idempotent).
  // REVIEW.md regen is idempotent; sweep is idempotent; flags.jsonl is
  // gitignored so it never contributes to a staged diff.
  // -------------------------------------------------------------------
  it('vector 13: a second no-change sync makes NO new commit (idempotent)', () => {
    writeFileSync(join(vault, 'wiki/concepts/n.md'), UNVERIFIED);

    sh('bash scripts/neuron-sync.sh', vault);
    const count1 = sh('git rev-list --count HEAD', vault).trim();

    sh('bash scripts/neuron-sync.sh', vault);
    const count2 = sh('git rev-list --count HEAD', vault).trim();

    expect(count2).toBe(count1);
  });

  // -------------------------------------------------------------------
  // Lock: another live sync holds the lock → exits cleanly, no commit.
  // Uses process.pid as the "live" owner PID — the test process IS alive.
  // -------------------------------------------------------------------
  it('lock: exits cleanly without committing when another live sync holds the lock', () => {
    mkdirSync(join(vault, '.neuron', 'sync.lock'), { recursive: true });
    writeFileSync(join(vault, '.neuron/sync.lock/pid'), String(process.pid));

    writeFileSync(join(vault, 'wiki/concepts/x.md'), UNVERIFIED);
    const out = sh('bash scripts/neuron-sync.sh', vault);

    expect(out).toContain('another sync is running');
    expect(sh('git ls-files', vault)).not.toContain('wiki/concepts/x.md');
  });

  // -------------------------------------------------------------------
  // Lock: stale lock (dead PID 999999) is taken over and sync proceeds.
  // -------------------------------------------------------------------
  it('lock: takes over a stale lock (dead PID)', () => {
    mkdirSync(join(vault, '.neuron', 'sync.lock'), { recursive: true });
    writeFileSync(join(vault, '.neuron/sync.lock/pid'), '999999');

    writeFileSync(join(vault, 'wiki/concepts/x.md'), UNVERIFIED);
    sh('bash scripts/neuron-sync.sh', vault);

    expect(sh('git ls-files', vault)).toContain('wiki/concepts/x.md');
  });

  // -------------------------------------------------------------------
  // No-remote vault: syncs locally, exits 0, makes a real commit.
  // -------------------------------------------------------------------
  it('no-remote vault syncs locally and exits 0', () => {
    writeFileSync(join(vault, 'wiki/concepts/n.md'), UNVERIFIED);

    const out = sh('bash scripts/neuron-sync.sh', vault);
    expect(out).toContain('no remote configured');

    expect(Number(sh('git rev-list --count HEAD', vault).trim())).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------
  // Secret pattern in a tracked skills file: PUSH_OK=0 (push blocked),
  // but the safe-file commit still goes through in the same run.
  // -------------------------------------------------------------------
  it('secret pattern in a tracked skills file blocks push state but commit proceeds', () => {
    mkdirSync(join(vault, 'skills'), { recursive: true });
    // Fake API key — 24 chars, matches sk-[a-zA-Z0-9]{20,}.
    writeFileSync(
      join(vault, 'skills/helper.js'),
      'const k = "sk-aaaaaaaaaaaaaaaaaaaaaaaa";'
    );
    writeFileSync(join(vault, 'wiki/concepts/safe.md'), UNVERIFIED);

    const out = sh('bash scripts/neuron-sync.sh', vault);

    expect(out).toContain('PUSH BLOCKED');

    // The safe wiki file must have committed even though push was withheld.
    expect(sh('git ls-files', vault)).toContain('wiki/concepts/safe.md');

    // The credential flag must appear in REVIEW.md.
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8')).toContain('credential pattern');
  });

  // -------------------------------------------------------------------
  // Regression (found arming the real vault): with the pre-commit hook
  // installed, the stamping step must NOT inject trust frontmatter into
  // REVIEW.md. The generator writes it without frontmatter, so a stamped
  // REVIEW.md oscillates against its generator — every sync staged a real
  // diff the hook immediately reverted, producing tree-identical EMPTY
  // commits on every run.
  // -------------------------------------------------------------------
  it('regression: hook + sync stay idempotent and REVIEW.md never gains frontmatter', () => {
    const hookSrc = join(SCRIPTS, 'hooks', 'pre-commit');
    mkdirSync(join(vault, 'scripts', 'hooks'), { recursive: true });
    cpSync(hookSrc, join(vault, 'scripts/hooks/pre-commit'));
    cpSync(hookSrc, join(vault, '.git/hooks/pre-commit'));
    execSync('chmod +x .git/hooks/pre-commit', { cwd: vault });

    writeFileSync(join(vault, 'wiki/concepts/n.md'), UNVERIFIED);
    sh('bash scripts/neuron-sync.sh', vault);
    const count1 = sh('git rev-list --count HEAD', vault).trim();
    sh('bash scripts/neuron-sync.sh', vault);
    expect(sh('git rev-list --count HEAD', vault).trim()).toBe(count1);
    expect(readFileSync(join(vault, 'REVIEW.md'), 'utf-8').startsWith('# REVIEW')).toBe(true);
  });
});
