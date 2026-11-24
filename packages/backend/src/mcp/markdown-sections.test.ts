import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { findSections, headingOutline, insertIntoSection, readSections } from './markdown-sections';

const NOTE = [
  '---',
  'tags: [plan]',
  '# not a heading: frontmatter',
  '---',
  '# Plan',
  'Intro.',
  '',
  '## TODO',
  '- write spec',
  '- ship',
  '',
  '### Later',
  '- docs',
  '',
  '## Decisions',
  '```sh',
  '# not a heading: code',
  '```',
  'We chose B.',
  '',
].join('\n');

describe('markdown sections', () => {
  it('skips frontmatter and fenced code when finding headings', () => {
    assert.equal(headingOutline(NOTE), '# Plan\n## TODO\n### Later\n## Decisions');
  });

  it('matches a title at any level, or at the level given, ignoring case', () => {
    assert.equal(findSections(NOTE, 'todo').length, 1);
    assert.equal(findSections(NOTE, '## TODO').length, 1);
    assert.equal(findSections(NOTE, '### TODO').length, 0);
  });

  it('reads a section with its sub-sections, up to the next heading of the same level', () => {
    assert.deepEqual(readSections(NOTE, 'TODO'), ['## TODO\n- write spec\n- ship\n\n### Later\n- docs']);
    assert.deepEqual(readSections(NOTE, 'Decisions'), ['## Decisions\n```sh\n# not a heading: code\n```\nWe chose B.']);
  });

  it('adds a list item to a list with a single newline, before any sub-heading', () => {
    const out = insertIntoSection(NOTE, 'TODO', '- test');
    assert.ok(out.includes('## TODO\n- write spec\n- ship\n- test\n\n### Later\n- docs'), out);
  });

  it('separates other content with a blank line and keeps the trailing newline at EOF', () => {
    const out = insertIntoSection(NOTE, 'Decisions', 'Then C.');
    assert.ok(out.endsWith('We chose B.\n\nThen C.\n'), out);
  });

  it('honours an explicit separator', () => {
    const out = insertIntoSection('# A\ntext\n# B\n', 'A', 'more', ' ');
    assert.equal(out, '# A\ntext more\n\n# B\n');
  });

  it('fills an empty section', () => {
    assert.equal(insertIntoSection('# A\n# B', 'A', '- x'), '# A\n\n- x\n\n# B');
  });

  it('refuses a missing heading and lists the headings', () => {
    assert.throws(() => insertIntoSection(NOTE, 'Risks', 'x'), /No section "Risks"[\s\S]*## Decisions/);
  });

  it('refuses an ambiguous heading', () => {
    assert.throws(() => insertIntoSection('# A\n## Notes\n# B\n## Notes\n', 'Notes', 'x'), /2 sections match/);
  });
});
