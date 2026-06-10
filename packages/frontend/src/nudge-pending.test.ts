import { describe, it, expect } from 'vitest';
import { NudgeRegistry } from './nudge-pending';

// The registry is the algebra behind App.tsx's create / save / rename hooks:
// 4.4 — creating a private file in a folder with sibling grants registers the
// nudge but does NOT render it. Typing one character + saving fires the
// nudge once; subsequent saves are silent.

describe('NudgeRegistry', () => {
  it('record + take fires exactly once per path (matches the 4.4 expectation)', () => {
    const reg = new NudgeRegistry();
    reg.record('_users/me/Untitled note.md', { grantee: 'bob@x.com', permission: 'comment' });

    // First save → nudge surfaces.
    const first = reg.take('_users/me/Untitled note.md');
    expect(first).toEqual({ grantee: 'bob@x.com', permission: 'comment' });

    // Subsequent saves → silent.
    expect(reg.take('_users/me/Untitled note.md')).toBeNull();
  });

  it('take with no record returns null (zero toasts on plain create)', () => {
    const reg = new NudgeRegistry();
    expect(reg.take('_users/me/never-recorded.md')).toBeNull();
  });

  it('rekey moves a pending entry from oldPath to newPath (rename takes precedence)', () => {
    const reg = new NudgeRegistry();
    reg.record('_users/me/Untitled note.md', { grantee: 'bob@x.com', permission: 'write' });

    expect(reg.rekey('_users/me/Untitled note.md', '_users/me/Project plan.md')).toBe(true);

    // After rekey, taking by the OLD path is silent — even though the OT 'ack'
    // for the active doc may fire on the old path during the rename race.
    expect(reg.take('_users/me/Untitled note.md')).toBeNull();

    // Trigger by the NEW path renders the toast (rename takes precedence).
    expect(reg.take('_users/me/Project plan.md')).toEqual({
      grantee: 'bob@x.com',
      permission: 'write',
    });

    // Single render — second take on the new path is silent.
    expect(reg.take('_users/me/Project plan.md')).toBeNull();
  });

  it('rekey returns false when nothing is registered at oldPath', () => {
    const reg = new NudgeRegistry();
    expect(reg.rekey('does-not-exist.md', 'something.md')).toBe(false);
    expect(reg.has('something.md')).toBe(false);
  });

  it('record overwrites an existing entry (re-register on second create attempt)', () => {
    const reg = new NudgeRegistry();
    reg.record('a.md', { grantee: 'old@x.com', permission: 'read' });
    reg.record('a.md', { grantee: 'new@x.com', permission: 'write' });
    expect(reg.take('a.md')).toEqual({ grantee: 'new@x.com', permission: 'write' });
  });
});
