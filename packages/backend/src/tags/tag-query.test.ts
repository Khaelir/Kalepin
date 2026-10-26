import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseSearchQuery } from './tag-query';

describe('parseSearchQuery', () => {
  it('leaves plain queries untouched', () => {
    assert.deepEqual(parseSearchQuery('budget review'), { text: 'budget review', tags: [] });
  });

  it('extracts a tag-only query', () => {
    assert.deepEqual(parseSearchQuery('tag:meeting'), { text: '', tags: ['meeting'] });
  });

  it('extracts tags anywhere in the query and keeps the remaining text', () => {
    assert.deepEqual(parseSearchQuery('budget tag:meeting  review tag:q3'), {
      text: 'budget review',
      tags: ['meeting', 'q3'],
    });
  });

  it('normalises case, a leading # and trailing slashes', () => {
    assert.deepEqual(parseSearchQuery('TAG:#Project/Kalepin/').tags, ['project/kalepin']);
  });

  it('deduplicates tags', () => {
    assert.deepEqual(parseSearchQuery('tag:a tag:A tag:#a').tags, ['a']);
  });

  it('drops an empty tag: token', () => {
    assert.deepEqual(parseSearchQuery('tag: notes'), { text: 'notes', tags: [] });
  });

  it('keeps tokens inside double quotes as text', () => {
    assert.deepEqual(parseSearchQuery('"see tag:x here" tag:y'), { text: '"see tag:x here"', tags: ['y'] });
    assert.deepEqual(parseSearchQuery('"tag:x"'), { text: '"tag:x"', tags: [] });
  });

  it('does not treat tag: glued to a word as a token', () => {
    assert.deepEqual(parseSearchQuery('hashtag:x'), { text: 'hashtag:x', tags: [] });
  });

  it('keeps invalid tag values so they match nothing', () => {
    assert.deepEqual(parseSearchQuery('tag:a,b').tags, ['a,b']);
  });
});
