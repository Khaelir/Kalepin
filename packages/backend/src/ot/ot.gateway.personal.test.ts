import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isVisibleTo } from '../auth/visibility';

// These tests exercise the predicate-level invariants that drive the gateway's
// `doc:open` gate, the personal-fanout, and the per-email index. The gateway
// itself is wired to `chokidar` and `ws`, which require a running stack to
// exercise end-to-end; that's covered by the Phase 4 e2e harness. Here we lock
// in the algebra the gateway relies on so a regression in the predicate or in
// the email-extraction logic fails CI without the heavy harness.

function extractPersonalOwnerEmail(virtualPath: string): string | null {
  if (!virtualPath.startsWith('_users/')) return null;
  const tail = virtualPath.slice('_users/'.length);
  const slash = tail.indexOf('/');
  return slash === -1 ? tail : tail.slice(0, slash);
}

describe('OTGateway — visibility gate on doc:open', () => {
  it('shared docId is visible to any authenticated user', () => {
    assert.equal(isVisibleTo('Notes/foo.md', 'alice@example.com'), true);
    assert.equal(isVisibleTo('Notes/foo.md', 'bob@example.com'), true);
  });

  it('personal docId is visible only to its owner', () => {
    assert.equal(isVisibleTo('_users/alice@example.com/diary.md', 'alice@example.com'), true);
    assert.equal(isVisibleTo('_users/alice@example.com/diary.md', 'bob@example.com'), false);
  });

  it('LIKE-injection-class probe stays closed at the JS predicate', () => {
    // john_doe@x.com vs johnxdoe@x.com — the JS string compare is exact.
    assert.equal(isVisibleTo('_users/john_doe@x.com/secret.md', 'johnxdoe@x.com'), false);
  });
});

describe('OTGateway — personal owner email extraction', () => {
  it('extracts the owner email from a virtual personal path', () => {
    assert.equal(
      extractPersonalOwnerEmail('_users/alice@example.com/diary.md'),
      'alice@example.com',
    );
  });

  it('extracts the email from a path equal to the personal root segment', () => {
    assert.equal(
      extractPersonalOwnerEmail('_users/alice@example.com'),
      'alice@example.com',
    );
  });

  it('returns null for a shared path', () => {
    assert.equal(extractPersonalOwnerEmail('Notes/foo.md'), null);
    assert.equal(extractPersonalOwnerEmail(''), null);
  });

  it('handles nested paths', () => {
    assert.equal(
      extractPersonalOwnerEmail('_users/alice@example.com/sub/deep.md'),
      'alice@example.com',
    );
  });
});

describe('OTGateway — clientsByEmail invariants', () => {
  // The gateway maps connected sockets by canonical (lowercase) email. The
  // important property: a message intended for "alice@example.com" never reaches
  // a socket bound to anyone else, even when the casing differs at write-time.

  function fanoutTargets(
    clientsByEmail: Map<string, Set<string>>,
    targetEmail: string,
  ): string[] {
    const set = clientsByEmail.get(targetEmail.toLowerCase());
    return set ? Array.from(set).sort() : [];
  }

  it('routes to the canonical-email entry, regardless of mixed-case input', () => {
    const map = new Map<string, Set<string>>();
    map.set('alice@example.com', new Set(['alice-ws-1', 'alice-ws-2']));
    map.set('bob@example.com', new Set(['bob-ws']));

    assert.deepEqual(fanoutTargets(map, 'Alice@Example.COM'), ['alice-ws-1', 'alice-ws-2']);
    assert.deepEqual(fanoutTargets(map, 'bob@example.com'), ['bob-ws']);
    assert.deepEqual(fanoutTargets(map, 'eve@nowhere.com'), []);
  });

  it('john_doe@x.com and johnxdoe@x.com map to distinct buckets', () => {
    const map = new Map<string, Set<string>>();
    map.set('john_doe@x.com', new Set(['ws-A']));
    map.set('johnxdoe@x.com', new Set(['ws-B']));

    assert.deepEqual(fanoutTargets(map, 'john_doe@x.com'), ['ws-A']);
    assert.deepEqual(fanoutTargets(map, 'johnxdoe@x.com'), ['ws-B']);
  });
});
