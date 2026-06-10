import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { findNearestHeading } from './find-nearest-heading';

describe('findNearestHeading', () => {
  it('finds nearest heading above mention line', () => {
    const content = '# Title\n\nSome text\n\n## Design Review\n\n@[alice](alice@co.com)';
    const slug = findNearestHeading(content, 6);
    assert.equal(slug, 'design-review');
  });

  it('returns undefined when no heading above', () => {
    const content = '@[alice](alice@co.com)\n\n# Title after';
    const slug = findNearestHeading(content, 0);
    assert.equal(slug, undefined);
  });

  it('handles special characters in headings', () => {
    const content = '## What\'s New?\n\n@[bob](bob@co.com)';
    const slug = findNearestHeading(content, 2);
    assert.equal(slug, 'whats-new');
  });

  it('picks the closest heading', () => {
    const content = '# Title\n\n## Section A\n\n## Section B\n\n@[alice](alice@co.com)';
    const slug = findNearestHeading(content, 6);
    assert.equal(slug, 'section-b');
  });
});
