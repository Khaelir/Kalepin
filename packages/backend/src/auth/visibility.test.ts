import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  PERSONAL_PREFIX,
  personalRootFor,
  isUnderPersonalRoot,
  isVisibleTo,
  assertReadableBy,
  assertWritableBy,
  isPersonalRootSegment,
  isCanonicalPath,
} from './visibility';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

describe('PERSONAL_PREFIX', () => {
  it('is the literal "_users/"', () => {
    assert.equal(PERSONAL_PREFIX, '_users/');
  });
});

describe('personalRootFor', () => {
  it('joins prefix and email', () => {
    assert.equal(personalRootFor(ALICE), '_users/alice@example.com');
  });

  it('does not append a trailing slash', () => {
    assert.equal(personalRootFor(ALICE).endsWith('/'), false);
  });
});

describe('isUnderPersonalRoot', () => {
  it('true for personal paths', () => {
    assert.equal(isUnderPersonalRoot('_users/alice@x.com/foo.md'), true);
    assert.equal(isUnderPersonalRoot('_users/'), true);
    assert.equal(isUnderPersonalRoot('_users/alice@x.com'), true);
  });

  it('false for shared paths', () => {
    assert.equal(isUnderPersonalRoot(''), false);
    assert.equal(isUnderPersonalRoot('Notes/foo.md'), false);
    assert.equal(isUnderPersonalRoot('_attachments/img.png'), false);
    assert.equal(isUnderPersonalRoot('_users'), false); // missing trailing slash
    assert.equal(isUnderPersonalRoot('Notes/_users/x@y'), false);
  });
});

describe('isVisibleTo', () => {
  it('shared paths visible to everyone', () => {
    assert.equal(isVisibleTo('Notes/foo.md', ALICE), true);
    assert.equal(isVisibleTo('Notes/foo.md', BOB), true);
    assert.equal(isVisibleTo('', ALICE), true);
    assert.equal(isVisibleTo('_attachments/img.png', BOB), true);
  });

  it('owner sees own personal root and children', () => {
    assert.equal(isVisibleTo('_users/alice@example.com', ALICE), true);
    assert.equal(isVisibleTo('_users/alice@example.com/Diary.md', ALICE), true);
    assert.equal(isVisibleTo('_users/alice@example.com/sub/Note.md', ALICE), true);
  });

  it('non-owner does not see foreign personal paths', () => {
    assert.equal(isVisibleTo('_users/alice@example.com', BOB), false);
    assert.equal(isVisibleTo('_users/alice@example.com/Diary.md', BOB), false);
  });

  it('exact-string compare prevents prefix collision', () => {
    // alice2@x.com must not see alice@x.com's data
    assert.equal(isVisibleTo('_users/alice@example.com/Diary.md', 'alice2@example.com'), false);
    // 'al' prefix of 'alice'
    assert.equal(isVisibleTo('_users/alice@example.com/Diary.md', 'al@example.com'), false);
  });

  it('LIKE-injection variant: john_doe vs johnxdoe (JS exact compare)', () => {
    assert.equal(
      isVisibleTo('_users/john_doe@x.com/diary.md', 'johnxdoe@x.com'),
      false,
      'JS string compare must not interpret _ as wildcard',
    );
  });

  it('LIKE-injection variant: a%b vs axyzb', () => {
    assert.equal(isVisibleTo('_users/a%b@x.com/diary.md', 'axyzb@x.com'), false);
  });

  it('handles _users/ exact match (no email)', () => {
    // '_users/' alone is under prefix but matches no user — visible to no one
    assert.equal(isVisibleTo('_users/', ALICE), false);
  });
});

describe('assertReadableBy', () => {
  it('does not throw for visible paths', () => {
    assert.doesNotThrow(() => assertReadableBy('Notes/foo.md', BOB));
    assert.doesNotThrow(() => assertReadableBy('_users/alice@example.com/diary.md', ALICE));
  });

  it('throws NotFoundException for foreign personal paths (never 403)', () => {
    assert.throws(
      () => assertReadableBy('_users/alice@example.com/diary.md', BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });
});

describe('assertWritableBy', () => {
  it('mirrors assertReadableBy for v1', () => {
    assert.doesNotThrow(() => assertWritableBy('Notes/foo.md', ALICE));
    assert.throws(
      () => assertWritableBy('_users/alice@example.com/diary.md', BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });
});

describe('isPersonalRootSegment', () => {
  it('true for exact "_users/{email}" with no trailing slash', () => {
    assert.equal(isPersonalRootSegment('_users/alice@example.com'), true);
    assert.equal(isPersonalRootSegment('_users/x@y'), true);
  });

  it('false for children under the root', () => {
    assert.equal(isPersonalRootSegment('_users/alice@example.com/foo.md'), false);
    assert.equal(isPersonalRootSegment('_users/alice@example.com/'), false); // trailing slash means deeper
  });

  it('false for "_users" (no trailing slash) and "_users/" (no email)', () => {
    assert.equal(isPersonalRootSegment('_users'), false);
    assert.equal(isPersonalRootSegment('_users/'), false);
  });

  it('false for shared paths', () => {
    assert.equal(isPersonalRootSegment('Notes/_users/x@y'), false);
    assert.equal(isPersonalRootSegment('Notes/foo.md'), false);
  });
});

describe('isCanonicalPath', () => {
  it('accepts the vault root and plain relative paths', () => {
    assert.equal(isCanonicalPath(''), true);
    assert.equal(isCanonicalPath('Notes/foo.md'), true);
    assert.equal(isCanonicalPath('_users/alice@example.com/diary.md'), true);
    assert.equal(isCanonicalPath('Notes/..hidden.md'), true);
  });

  it('rejects dot segments, empty segments, slashes at either end, backslash and NUL', () => {
    for (const p of [
      '_users/alice@example.com/../bob@example.com/diary.md',
      '_users/alice@example.com/..',
      './Notes/foo.md',
      'Notes/./foo.md',
      'Notes//foo.md',
      '/Notes/foo.md',
      'Notes/',
      'Notes\\..\\foo.md',
      'Notes/foo.md\0',
    ]) {
      assert.equal(isCanonicalPath(p), false, p);
    }
  });
});

describe('isVisibleTo — traversal', () => {
  it('does not treat a path that climbs out of the viewer root as owned', () => {
    assert.equal(isVisibleTo('_users/alice@example.com/../bob@example.com/diary.md', ALICE), false);
    assert.equal(isVisibleTo('_users/alice@example.com/..', ALICE), false);
  });

  it('rejects non-canonical spellings of shared paths too', () => {
    assert.equal(isVisibleTo('Notes//foo.md', ALICE), false);
    assert.equal(isVisibleTo('Notes/../_users/bob@example.com/diary.md', ALICE), false);
  });
});
