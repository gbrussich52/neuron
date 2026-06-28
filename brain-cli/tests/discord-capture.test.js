import { describe, it, expect } from 'vitest';
import { captureFromDiscord } from '../discord-capture.js';

describe('captureFromDiscord', () => {
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
});
