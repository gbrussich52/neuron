import { captureNote } from './capture.js';

export async function captureFromDiscord(msg, deps = {}) {
  const capture = deps.capture || captureNote;
  const { file, links = [] } = await capture(msg.text, { source: 'discord' });
  const reply = links.length
    ? `✓ captured → ${links.map(t => `[[${t}]]`).join(' ')}`
    : '✓ captured → (no links yet)';
  return { reply, file, links };
}
