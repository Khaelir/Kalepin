import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parsePreregisteredClientIds } from './oauth-preregistration';

describe('parsePreregisteredClientIds', () => {
  it('returns [] when the env var is unset or empty', () => {
    assert.deepEqual(parsePreregisteredClientIds({}), []);
    assert.deepEqual(parsePreregisteredClientIds({ OAUTH_PREREGISTERED_CLIENT_IDS: '' }), []);
    assert.deepEqual(parsePreregisteredClientIds({ OAUTH_PREREGISTERED_CLIENT_IDS: '   ' }), []);
  });

  it('splits on comma, trims whitespace, drops blanks', () => {
    assert.deepEqual(
      parsePreregisteredClientIds({
        OAUTH_PREREGISTERED_CLIENT_IDS: ' a@example.com , b@example.com ,, c ',
      }),
      ['a@example.com', 'b@example.com', 'c'],
    );
  });

  it('deduplicates repeated ids', () => {
    assert.deepEqual(
      parsePreregisteredClientIds({
        OAUTH_PREREGISTERED_CLIENT_IDS: 'same@example.com, same@example.com, other',
      }),
      ['same@example.com', 'other'],
    );
  });
});
