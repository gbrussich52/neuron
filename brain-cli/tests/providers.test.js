import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { resolveModel, withRetry, claudeCliCall, __resetMaxTokensWarning } from '../providers.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => 'mock-response'),
}));

describe('resolveModel', () => {
  it('resolves the synthesize tier to the current Opus for anthropic-api', () => {
    expect(resolveModel('synthesize', 'anthropic-api')).toBe('claude-opus-4-7');
  });
  it('resolves the compile tier to Sonnet 4.6 for anthropic-api', () => {
    expect(resolveModel('compile', 'anthropic-api')).toBe('claude-sonnet-4-6');
  });
  it('resolves aliases straight through for claude-cli', () => {
    expect(resolveModel('classify', 'claude-cli')).toBe('haiku');
  });
  it('throws on an unknown tier', () => {
    expect(() => resolveModel('bogus', 'claude-cli')).toThrow(/Unknown tier/);
  });
  it('resolves the embed tier to the configured embed model', () => {
    expect(resolveModel('embed', 'claude-cli')).toBe('nomic-embed-text');
  });
  it('throws on a provider missing from the registry', () => {
    expect(() => resolveModel('compile', 'nonexistent-provider')).toThrow(/missing from models registry/);
  });
});

describe('withRetry', () => {
  it('returns the result when the call succeeds first try', async () => {
    const result = await withRetry(async () => 'ok', { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
  });
  it('retries then succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'recovered';
    }, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });
  it('throws after exhausting retries', async () => {
    await expect(
      withRetry(async () => { throw new Error('always fails'); }, { retries: 2, baseDelayMs: 1 })
    ).rejects.toThrow(/always fails/);
  });
});

describe('claudeCliCall — maxTokens cost-control (regression for silent-ignore bug)', () => {
  beforeEach(() => {
    execFileSync.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __resetMaxTokensWarning();
  });
  afterEach(() => {
    console.warn.mockRestore();
  });

  it('never forwards a --max-tokens flag to the claude CLI (it does not support one)', () => {
    claudeCliCall({ prompt: 'hi', maxTokens: 4000 });
    const args = execFileSync.mock.calls[0][1];
    expect(args).not.toContain('--max-tokens');
    expect(args.join(' ')).not.toMatch(/max-tokens/);
  });

  it('warns on stderr when maxTokens is set, so the cap is no longer silently ignored', () => {
    claudeCliCall({ prompt: 'hi', maxTokens: 4000 });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toMatch(/maxTokens/i);
  });

  it('does not warn when maxTokens is not provided at all', () => {
    claudeCliCall({ prompt: 'hi' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('only warns once per process even across many calls (no log spam)', () => {
    claudeCliCall({ prompt: 'one', maxTokens: 1000 });
    claudeCliCall({ prompt: 'two', maxTokens: 2000 });
    claudeCliCall({ prompt: 'three', maxTokens: 3000 });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('still passes prompt, model, and tools through to execFileSync correctly', () => {
    claudeCliCall({ prompt: 'do the thing', model: 'sonnet', tools: ['Read', 'Write'], maxTokens: 4000 });
    const [bin, args] = execFileSync.mock.calls[0];
    expect(bin).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('do the thing');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('Read,Write');
  });
});
