import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { zoneFor } from './zone-for';

describe('zoneFor', () => {
  const personalCases: string[] = [
    '_users',
    '_users/alice@x.com',
    '_users/alice@x.com/diary.md',
    '_users/alice@x.com/_attachments/foo.png',
    '_users/bob/sub/dir/note.md',
  ];

  for (const p of personalCases) {
    it(`personal: ${p}`, () => assert.equal(zoneFor(p), 'personal'));
  }

  const sharedCases: string[] = [
    '',
    '/',
    'Notes/foo.md',
    'Projects/sub/dir.md',
    '_attachments/img.png',
    'vault/_users/spoof', // literal subdir of shared root, not the personal namespace
    '_users-other', // distinct prefix, not the personal one
    '_userssomething/foo',
    '/just/a/file',
  ];

  for (const p of sharedCases) {
    it(`shared: ${p || '(empty)'}`, () => assert.equal(zoneFor(p), 'shared'));
  }
});
