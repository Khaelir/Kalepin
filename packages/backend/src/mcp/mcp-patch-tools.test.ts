import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FilesService } from '../files/files.service';

// --- In-memory storage adapter ---

function createMemoryStorage() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path: string) => {
      if (!files.has(path)) throw new Error('Not found');
      return files.get(path)!;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    exists: async (path: string) => files.has(path),
    list: async () => [],
    move: async () => {},
  };
}

function createService(storage: ReturnType<typeof createMemoryStorage>) {
  const service = new FilesService(storage as any);
  return service;
}

// ── computeContentHash ──────────────────────────────────────────────

describe('computeContentHash', () => {
  it('returns an 8-char hex string', () => {
    const svc = createService(createMemoryStorage());
    const hash = svc.computeContentHash('Hello world');
    assert.equal(hash.length, 8);
    assert.match(hash, /^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    const svc = createService(createMemoryStorage());
    const a = svc.computeContentHash('test content');
    const b = svc.computeContentHash('test content');
    assert.equal(a, b);
  });

  it('changes when content changes', () => {
    const svc = createService(createMemoryStorage());
    const a = svc.computeContentHash('version 1');
    const b = svc.computeContentHash('version 2');
    assert.notEqual(a, b);
  });
});

// ── validateBaseHash ────────────────────────────────────────────────

describe('validateBaseHash', () => {
  it('passes when hash matches', () => {
    const svc = createService(createMemoryStorage());
    const hash = svc.computeContentHash('content');
    assert.doesNotThrow(() => svc.validateBaseHash('content', hash));
  });

  it('throws ConflictException on mismatch', () => {
    const svc = createService(createMemoryStorage());
    assert.throws(
      () => svc.validateBaseHash('content', 'deadbeef'),
      ConflictException,
    );
  });

  it('does nothing when baseHash is omitted', () => {
    const svc = createService(createMemoryStorage());
    assert.doesNotThrow(() => svc.validateBaseHash('content', undefined));
  });
});

// ── patchFile ───────────────────────────────────────────────────────

describe('patchFile', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let svc: FilesService;

  beforeEach(() => {
    storage = createMemoryStorage();
    svc = createService(storage);
  });

  it('replaces a single match', async () => {
    storage.files.set('note.md', 'Hello world, this is a test.');
    await svc.patchFile('note.md', 'Hello world', 'Hello universe');
    assert.equal(storage.files.get('note.md'), 'Hello universe, this is a test.');
  });

  it('deletes text when new_text is empty', async () => {
    storage.files.set('note.md', 'keep this remove this keep that');
    await svc.patchFile('note.md', ' remove this', '');
    assert.equal(storage.files.get('note.md'), 'keep this keep that');
  });

  it('throws NotFoundException when old_text not found', async () => {
    storage.files.set('note.md', 'Hello world');
    await assert.rejects(
      () => svc.patchFile('note.md', 'Goodbye world', 'Hi'),
      NotFoundException,
    );
    assert.equal(storage.files.get('note.md'), 'Hello world');
  });

  it('throws ConflictException on multiple matches', async () => {
    storage.files.set('note.md', 'foo bar foo baz foo');
    await assert.rejects(
      () => svc.patchFile('note.md', 'foo', 'qux'),
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.ok(err.message.includes('3'));
        return true;
      },
    );
    assert.equal(storage.files.get('note.md'), 'foo bar foo baz foo');
  });

  it('succeeds with matching base_hash', async () => {
    storage.files.set('note.md', 'Hello world');
    const hash = svc.computeContentHash('Hello world');
    await svc.patchFile('note.md', 'Hello', 'Hi', hash);
    assert.equal(storage.files.get('note.md'), 'Hi world');
  });

  it('throws ConflictException on base_hash mismatch', async () => {
    storage.files.set('note.md', 'Hello world');
    await assert.rejects(
      () => svc.patchFile('note.md', 'Hello', 'Hi', 'deadbeef'),
      ConflictException,
    );
    assert.equal(storage.files.get('note.md'), 'Hello world');
  });

  it('skips hash check when base_hash is omitted', async () => {
    storage.files.set('note.md', 'Hello world');
    await svc.patchFile('note.md', 'Hello', 'Hi');
    assert.equal(storage.files.get('note.md'), 'Hi world');
  });
});

// ── appendToFile ────────────────────────────────────────────────────

describe('appendToFile', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let svc: FilesService;

  beforeEach(() => {
    storage = createMemoryStorage();
    svc = createService(storage);
  });

  it('appends with default separator (\\n\\n)', async () => {
    storage.files.set('note.md', 'existing content');
    await svc.appendToFile('note.md', '## New Section');
    assert.equal(storage.files.get('note.md'), 'existing content\n\n## New Section');
  });

  it('appends with custom separator', async () => {
    storage.files.set('note.md', '- item 1');
    await svc.appendToFile('note.md', '- item 2', '\n');
    assert.equal(storage.files.get('note.md'), '- item 1\n- item 2');
  });

  it('throws ConflictException on base_hash mismatch', async () => {
    storage.files.set('note.md', 'content');
    await assert.rejects(
      () => svc.appendToFile('note.md', 'more', '\n\n', 'deadbeef'),
      ConflictException,
    );
    assert.equal(storage.files.get('note.md'), 'content');
  });

  it('throws NotFoundException for non-existent note', async () => {
    await assert.rejects(
      () => svc.appendToFile('missing.md', 'content'),
      NotFoundException,
    );
  });
});

// ── createFile with baseHash ────────────────────────────────────────

describe('createFile with baseHash', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let svc: FilesService;

  beforeEach(() => {
    storage = createMemoryStorage();
    svc = createService(storage);
  });

  it('throws ConflictException when base_hash does not match existing content', async () => {
    storage.files.set('note.md', 'old content');
    await assert.rejects(
      () => svc.createFile('note.md', 'new content', undefined, 'deadbeef'),
      ConflictException,
    );
    assert.equal(storage.files.get('note.md'), 'old content');
  });

  it('succeeds when base_hash matches', async () => {
    storage.files.set('note.md', 'old content');
    const hash = svc.computeContentHash('old content');
    await svc.createFile('note.md', 'new content', undefined, hash);
    assert.equal(storage.files.get('note.md'), 'new content');
  });

  it('proceeds without validation when base_hash is omitted', async () => {
    storage.files.set('note.md', 'old content');
    await svc.createFile('note.md', 'new content');
    assert.equal(storage.files.get('note.md'), 'new content');
  });
});

// ── read_note contentHash integration ───────────────────────────────

describe('read_note contentHash', () => {
  it('computeContentHash produces consistent hashes for read_note', () => {
    const svc = createService(createMemoryStorage());
    const content = '# My Note\n\nSome content here.';
    const hash1 = svc.computeContentHash(content);
    const hash2 = svc.computeContentHash(content);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 8);
    assert.match(hash1, /^[0-9a-f]{8}$/);
  });
});
