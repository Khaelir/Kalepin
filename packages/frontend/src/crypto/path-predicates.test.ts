import { describe, it, expect } from 'vitest';
import { isE2EEncrypted } from './path-predicates';

describe('isE2EEncrypted', () => {
  it('matches files directly under a personal _secure folder', () => {
    expect(isE2EEncrypted('_users/alice/_secure/foo.md')).toBe(true);
    expect(isE2EEncrypted('_users/alice/_secure/sub/foo.md')).toBe(true);
  });

  it('matches the _secure folder itself', () => {
    expect(isE2EEncrypted('_users/alice/_secure')).toBe(true);
  });

  it('rejects non-_secure personal paths', () => {
    expect(isE2EEncrypted('_users/alice/notes/foo.md')).toBe(false);
  });

  it('rejects shared-root _secure paths', () => {
    expect(isE2EEncrypted('vault/_secure/foo.md')).toBe(false);
  });

  it('rejects nested _secure under a non-root segment', () => {
    expect(isE2EEncrypted('_users/alice/foo/_secure/bar.md')).toBe(false);
  });

  it('rejects empty and non-_users paths', () => {
    expect(isE2EEncrypted('')).toBe(false);
    expect(isE2EEncrypted('_users')).toBe(false);
    expect(isE2EEncrypted('_users/alice')).toBe(false);
  });
});
