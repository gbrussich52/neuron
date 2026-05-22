import { describe, it, expect } from 'vitest';
import { resolveModel } from '../providers.js';

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
});
