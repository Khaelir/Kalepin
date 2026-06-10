import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractDocMentions, extractDocMentionsWithLines } from './extract-doc-mentions';

describe('extractDocMentions', () => {
  it('extracts unique emails from mentions', () => {
    const content = 'Hello @[alice](alice@co.com) and @[bob](bob@co.com)';
    const emails = extractDocMentions(content);
    assert.equal(emails.size, 2);
    assert.ok(emails.has('alice@co.com'));
    assert.ok(emails.has('bob@co.com'));
  });

  it('deduplicates same email mentioned twice', () => {
    const content = '@[alice](alice@co.com) said hi to @[alice](alice@co.com)';
    const emails = extractDocMentions(content);
    assert.equal(emails.size, 1);
  });

  it('returns empty set for no mentions', () => {
    const content = 'No mentions here';
    const emails = extractDocMentions(content);
    assert.equal(emails.size, 0);
  });

  it('does not match regular markdown links', () => {
    const content = '[alice](alice@co.com)';
    const emails = extractDocMentions(content);
    assert.equal(emails.size, 0);
  });
});

describe('extractDocMentionsWithLines', () => {
  it('returns mentions with line numbers', () => {
    const content = 'Line 0\n@[alice](alice@co.com)\nLine 2\n@[bob](bob@co.com)';
    const mentions = extractDocMentionsWithLines(content);
    assert.equal(mentions.length, 2);
    assert.equal(mentions[0].email, 'alice@co.com');
    assert.equal(mentions[0].line, 1);
    assert.equal(mentions[1].email, 'bob@co.com');
    assert.equal(mentions[1].line, 3);
  });
});

describe('doc mention diff on save', () => {
  it('detects new mentions not in old content', () => {
    const oldContent = 'Hello @[alice](alice@co.com)';
    const newContent = 'Hello @[alice](alice@co.com) and @[bob](bob@co.com)';

    const oldMentions = extractDocMentions(oldContent);
    const newMentions = extractDocMentionsWithLines(newContent);

    const newOnly = newMentions.filter((m) => !oldMentions.has(m.email));
    assert.equal(newOnly.length, 1);
    assert.equal(newOnly[0].email, 'bob@co.com');
  });

  it('existing unchanged mentions do not trigger', () => {
    const content = 'Hello @[alice](alice@co.com)';

    const oldMentions = extractDocMentions(content);
    const newMentions = extractDocMentionsWithLines(content);

    const newOnly = newMentions.filter((m) => !oldMentions.has(m.email));
    assert.equal(newOnly.length, 0);
  });

  it('removed mentions are silent', () => {
    const oldContent = 'Hello @[alice](alice@co.com) and @[bob](bob@co.com)';
    const newContent = 'Hello @[alice](alice@co.com)';

    const oldMentions = extractDocMentions(oldContent);
    const newMentions = extractDocMentionsWithLines(newContent);

    const newOnly = newMentions.filter((m) => !oldMentions.has(m.email));
    assert.equal(newOnly.length, 0);
  });
});
