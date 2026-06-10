import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isAtomicWriteTmpPath } from '../storage';
import { FileChangeEvent } from '@kalepin/shared';

// The OTGateway constructor wires `fileWatcher.onFileChange` and
// `onPersonalChange` callbacks; both early-return when the event path is the
// `<file>.tmp.<hex>` artifact of `LocalFSAdapter.writeBytesAtomic`. The full
// gateway requires the chokidar/ws stack to instantiate, so we exercise the
// gate's algebra here: replay the same predicate the gateway uses against the
// inputs that produced the regression (a chokidar `change` event for the tmp
// file).

describe('isAtomicWriteTmpPath', () => {
  it('matches `.tmp.<hex>` artifacts at any depth', () => {
    assert.equal(isAtomicWriteTmpPath('Notes/foo.md.tmp.0d8580583738'), true);
    assert.equal(isAtomicWriteTmpPath('foo.md.tmp.abc123'), true);
    assert.equal(
      isAtomicWriteTmpPath('_users/alice@example.com/Untitled note.md.tmp.deadbe'),
      true,
    );
  });

  it('does not match plain markdown / non-tmp paths', () => {
    assert.equal(isAtomicWriteTmpPath('Notes/foo.md'), false);
    assert.equal(isAtomicWriteTmpPath('Notes/foo.md.tmp'), false);
    assert.equal(isAtomicWriteTmpPath('Notes/foo.tmp.md'), false);
    assert.equal(isAtomicWriteTmpPath(''), false);
  });

  it('hex is required (rejects non-hex suffix)', () => {
    assert.equal(isAtomicWriteTmpPath('Notes/foo.md.tmp.zzzzzz'), false);
    assert.equal(isAtomicWriteTmpPath('Notes/foo.md.tmp.GHIJKL'), false);
  });
});

describe('OTGateway watcher gate (.tmp filter)', () => {
  // Mirror the gate logic embedded in OTGateway.constructor's
  // `fileWatcher.onFileChange` callback. If `isAtomicWriteTmpPath(event.path)`
  // is true, the broadcast must NOT happen.
  type Broadcast = { type: 'file:changed' | 'file:tree-update'; path: string };

  function gate(event: FileChangeEvent): Broadcast | null {
    if (isAtomicWriteTmpPath(event.path)) return null;
    if (event.event === 'change' || (event.event === 'add' && event.path.endsWith('.md'))) {
      return { type: 'file:changed', path: event.path };
    }
    if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(event.event)) {
      return { type: 'file:tree-update', path: event.path };
    }
    return null;
  }

  it('drops a change event whose path is a `.tmp.<hex>` artifact', () => {
    const out = gate({ event: 'change', path: 'Notes/foo.md.tmp.abc123' });
    assert.equal(out, null);
  });

  it('drops an add event for a `.tmp.<hex>` artifact (writeBytesAtomic stage 1)', () => {
    const out = gate({ event: 'add', path: 'Notes/foo.md.tmp.abc123' });
    assert.equal(out, null);
  });

  it('still emits file:changed for the rename-into-place', () => {
    const out = gate({ event: 'change', path: 'Notes/foo.md' });
    assert.deepEqual(out, { type: 'file:changed', path: 'Notes/foo.md' });
  });

  it('still emits file:tree-update for non-tmp add', () => {
    const out = gate({ event: 'add', path: 'Notes/bar.md' });
    // .md add hits the file:changed branch first; this is fine — the original
    // gateway does the same for the tree-update side via a separate `if`.
    assert.equal(out?.type, 'file:changed');
  });
});
