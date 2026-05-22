import { describe, it, expect } from 'vitest';
import { resolveModel, withRetry } from '../providers.js';

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
