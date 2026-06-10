import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractHeadings } from './extract-headings';

describe('extractHeadings', () => {
  it('extracts markdown headings with original prefixes', () => {
    const md = `# Title\n\nSome text.\n\n## Section A\n\nMore text.\n\n### Subsection\n\nDetails.`;
    const headings = extractHeadings(md);
    assert.deepEqual(headings, ['# Title', '## Section A', '### Subsection']);
  });

  it('excludes headings inside fenced code blocks', () => {
    const md = [
      '# Real Heading',
      '',
      '```',
      '# Not a heading',
      '## Also not a heading',
      '```',
      '',
      '## Another Real Heading',
    ].join('\n');
    const headings = extractHeadings(md);
    assert.deepEqual(headings, ['# Real Heading', '## Another Real Heading']);
  });

  it('returns empty array for content with no headings', () => {
    const md = 'Just plain text.\n\nNo headings here.\n\nMore paragraphs.';
    const headings = extractHeadings(md);
    assert.deepEqual(headings, []);
  });

  it('handles all heading levels', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const headings = extractHeadings(md);
    assert.equal(headings.length, 6);
  });

  it('does not match lines without space after #', () => {
    const md = '#hashtag\n## Real Heading';
    const headings = extractHeadings(md);
    assert.deepEqual(headings, ['## Real Heading']);
  });
});
