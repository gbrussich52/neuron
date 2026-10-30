// Claude Opus 5.5, 2026-10-29: cover the embed prompt formats added for the embeddinggemma-2 switch.
import { describe, it, expect } from 'vitest';
import { docText, queryText } from '../semantic.js';

const chunk = { heading: 'Septic permit', text: 'BP-26-00636 status.' };

describe('docText', () => {
  it('keeps the old heading: text form with no template', () => {
    expect(docText(chunk, { embed: {} })).toBe('Septic permit: BP-26-00636 status.');
  });
  it('fills the model template', () => {
    expect(docText(chunk, { embed: { doc_template: 'title: {title} | text: {text}' } }))
      .toBe('title: Septic permit | text: BP-26-00636 status.');
  });
  it('uses title none when a chunk has no heading', () => {
    expect(docText({ heading: '', text: 'x' }, { embed: { doc_template: 'title: {title} | text: {text}' } }))
      .toBe('title: none | text: x');
  });
  it('does not expand $ patterns in note text', () => {
    expect(docText({ heading: 'h', text: 'cost $& and $1' }, { embed: { doc_template: '{title}|{text}' } }))
      .toBe('h|cost $& and $1');
  });
});

describe('queryText', () => {
  it('adds the configured prefix', () => {
    expect(queryText('septic?', { embed: { query_prefix: 'task: search result | query: ' } }))
      .toBe('task: search result | query: septic?');
  });
  it('passes the query through with no prefix', () => {
    expect(queryText('septic?', { embed: {} })).toBe('septic?');
  });
});
