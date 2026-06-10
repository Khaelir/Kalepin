import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseScopeString,
  formatScopeString,
  isScopeSubset,
  oauthScopesToApiKeyScope,
  apiKeyScopeToOAuthScopes,
  isOAuthScope,
} from './oauth-scope';

describe('OAuth scope helpers', () => {
  it('parses space-separated scope strings', () => {
    assert.deepEqual(parseScopeString('notes.read'), ['notes.read']);
    assert.deepEqual(parseScopeString('notes.read notes.write'), ['notes.read', 'notes.write']);
    assert.deepEqual(parseScopeString('  notes.read   notes.comment  '), ['notes.read', 'notes.comment']);
    assert.deepEqual(parseScopeString(''), []);
    assert.deepEqual(parseScopeString(undefined), []);
  });

  it('rejects unknown scopes', () => {
    assert.throws(() => parseScopeString('notes.unknown'));
    assert.throws(() => parseScopeString('notes.admin'));
  });

  it('formatScopeString produces canonical space-separated', () => {
    assert.equal(formatScopeString(['notes.read', 'notes.comment']), 'notes.read notes.comment');
  });

  it('isScopeSubset enforces granted ⊆ requested', () => {
    assert.equal(isScopeSubset(['notes.read'], ['notes.read', 'notes.write']), true);
    assert.equal(isScopeSubset(['notes.read', 'notes.write'], ['notes.read']), false);
    assert.equal(isScopeSubset([], ['notes.read']), true); // empty is trivially a subset
  });

  it('oauthScopesToApiKeyScope maps to highest-equivalent', () => {
    assert.equal(oauthScopesToApiKeyScope(['notes.read']), 'ro');
    assert.equal(oauthScopesToApiKeyScope(['notes.read', 'notes.comment']), 'rc');
    assert.equal(oauthScopesToApiKeyScope(['notes.read', 'notes.comment', 'notes.write']), 'rw');
    // Picks the highest tier when only the highest is present.
    assert.equal(oauthScopesToApiKeyScope(['notes.write']), 'rw');
  });

  it('apiKeyScopeToOAuthScopes is inverse-friendly', () => {
    assert.deepEqual(apiKeyScopeToOAuthScopes('ro'), ['notes.read']);
    assert.deepEqual(apiKeyScopeToOAuthScopes('rc'), ['notes.read', 'notes.comment']);
    assert.deepEqual(apiKeyScopeToOAuthScopes('rw'), ['notes.read', 'notes.comment', 'notes.write']);
    // admin is never exposed via OAuth — fall back to rw scopes for display.
    assert.deepEqual(apiKeyScopeToOAuthScopes('admin'), ['notes.read', 'notes.comment', 'notes.write']);
  });

  it('isOAuthScope guards the type', () => {
    assert.equal(isOAuthScope('notes.read'), true);
    assert.equal(isOAuthScope('notes.admin'), false);
    assert.equal(isOAuthScope('garbage'), false);
  });
});
