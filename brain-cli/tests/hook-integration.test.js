// tests/hook-integration.test.js — exercises the VAULT's pre-commit hook inside
// a disposable git repo. Skips when the vault scripts are not on this machine.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(__dirname, '..', 'brain.js');
const SCRIPTS = process.env.KB_SCRIPTS || join(homedir(), 'knowledge-base', 'scripts');
const HAVE = existsSync(join(SCRIPTS, 'hooks', 'pre-commit'));

function sh(cmd, cwd, env = {}) {
  return execSync(cmd, { cwd, env: { ...process.env, ...env, KB_DIR: cwd, NEURON_BIN: `node ${BRAIN}` }, encoding: 'utf-8' });
}

describe.skipIf(!HAVE)('pre-commit hook', () => {
  let vault;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'neuron-hook-'));
    sh('git init -q -b main && git config user.email t@t.t && git config user.name t && git config commit.gpgsign false', vault);
    mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
    mkdirSync(join(vault, 'scripts', 'hooks'), { recursive: true });
    mkdirSync(join(vault, 'skills'), { recursive: true });
    cpSync(join(SCRIPTS, 'classify-check.sh'), join(vault, 'scripts/classify-check.sh'));
    cpSync(join(SCRIPTS, 'hooks', 'pre-commit'), join(vault, 'scripts/hooks/pre-commit'));
    writeFileSync(join(vault, '.gitignore'), 'Inbox/\n');
    sh('git add -A && git commit -qm init', vault);
    cpSync(join(vault, 'scripts/hooks/pre-commit'), join(vault, '.git/hooks/pre-commit'));
    sh('chmod +x .git/hooks/pre-commit scripts/classify-check.sh', vault);
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it('blocks a staged CONFIDENTIAL .md, unstages it, gitignores it — and does NOT re-add it via stamping', () => {
    writeFileSync(join(vault, 'wiki/concepts/secret.md'), '---\nclassification: CONFIDENTIAL\n---\n\n# S');
    sh('git add wiki/concepts/secret.md', vault);
    expect(() => sh('git commit -m leak', vault)).toThrow();
    expect(sh('git diff --cached --name-only', vault)).not.toContain('secret.md');
    expect(readFileSync(join(vault, '.gitignore'), 'utf-8')).toContain('wiki/concepts/secret.md');
  });

  it('blocks lowercase classification: confidential too (case games)', () => {
    writeFileSync(join(vault, 'wiki/concepts/sneaky.md'), '---\nclassification: confidential\n---\n\n# S');
    sh('git add wiki/concepts/sneaky.md', vault);
    expect(() => sh('git commit -m leak', vault)).toThrow();
    expect(sh('git diff --cached --name-only', vault)).not.toContain('sneaky.md');
  });

  it('vector 9 (secret half): blocks a skill helper .js with a fake API key', () => {
    writeFileSync(join(vault, 'skills/helper.js'), 'const key = "sk-aaaaaaaaaaaaaaaaaaaaaaaa";');
    sh('git add skills/helper.js', vault);
    expect(() => sh('git commit -m skill', vault)).toThrow();
  });

  it('stamps an unstamped staged .md and lets the commit through', () => {
    writeFileSync(join(vault, 'wiki/concepts/new.md'), '# New\nbody');
    sh('git add wiki/concepts/new.md', vault);
    sh('git commit -m ok', vault, { NEURON_AUTHOR: 'claude' });
    const committed = sh('git show HEAD:wiki/concepts/new.md', vault);
    expect(committed).toContain('trust: unverified');
    expect(committed).toContain('content_hash:');
  });

  it('a mixed batch: safe file commits after re-run, CONFIDENTIAL stays out', () => {
    writeFileSync(join(vault, 'wiki/concepts/safe.md'), '# Safe\nbody');
    writeFileSync(join(vault, 'wiki/concepts/secret2.md'), '---\nclassification: CONFIDENTIAL\n---\n\n# S');
    sh('git add wiki', vault);
    expect(() => sh('git commit -m batch', vault, { NEURON_AUTHOR: 'claude' })).toThrow();
    // re-run: safe file goes through
    sh('git commit -m batch2', vault, { NEURON_AUTHOR: 'claude' });
    const tracked = sh('git ls-files', vault);
    expect(tracked).toContain('wiki/concepts/safe.md');
    expect(tracked).not.toContain('wiki/concepts/secret2.md');
  });
});
