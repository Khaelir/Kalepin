import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from './local-fs.adapter';
import { RoutingStorageAdapter, CrossPersonalMoveError } from './routing-fs.adapter';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let shared: LocalFSAdapter;
let personal: LocalFSAdapter;
let routing: RoutingStorageAdapter;

async function makeFreshDirs() {
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-routing-test-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await makeFreshDirs();
  shared = new LocalFSAdapter(sharedRoot);
  personal = new LocalFSAdapter(personalRoot);
  routing = new RoutingStorageAdapter(shared, personal);
});

describe('RoutingStorageAdapter — routing', () => {
  it('routes shared paths to the shared adapter', async () => {
    await routing.write('Notes/foo.md', 'shared-body');
    const onDisk = await fs.readFile(path.join(sharedRoot, 'Notes/foo.md'), 'utf-8');
    assert.equal(onDisk, 'shared-body');
    assert.equal(await routing.read('Notes/foo.md'), 'shared-body');
  });

  it('routes _users/{email}/... to the personal adapter (strips prefix)', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'personal-body');
    const onDisk = await fs.readFile(path.join(personalRoot, 'alice@x.com/diary.md'), 'utf-8');
    assert.equal(onDisk, 'personal-body');
    assert.equal(await routing.read('_users/alice@x.com/diary.md'), 'personal-body');
  });

  it('refuses to route the bare "_users" path', async () => {
    await assert.rejects(routing.read('_users'), (err: any) => err instanceof CrossPersonalMoveError);
    await assert.rejects(routing.read('_users/'), (err: any) => err instanceof CrossPersonalMoveError);
  });

  it('refuses to route into .deleted', async () => {
    await assert.rejects(
      routing.read('_users/.deleted/old@x.com'),
      (err: any) => err instanceof CrossPersonalMoveError,
    );
  });
});

describe('RoutingStorageAdapter — exists / delete', () => {
  it('exists returns false for a foreign-shape path that fails to route', async () => {
    assert.equal(await routing.exists('_users/'), false);
  });

  it('delete works on personal paths', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'x');
    await routing.delete('_users/alice@x.com/diary.md');
    assert.equal(await routing.exists('_users/alice@x.com/diary.md'), false);
  });
});

describe('RoutingStorageAdapter — list', () => {
  it('listing root returns shared-only entries (no _users entry from personal)', async () => {
    await routing.write('Notes/foo.md', 'a');
    await routing.write('_users/alice@x.com/diary.md', 'b');

    const root = await routing.list('');
    const names = root.map((e) => e.name).sort();
    assert.ok(names.includes('Notes'));
    assert.ok(!names.includes('_users'));
    assert.ok(!names.includes('alice@x.com'));
  });

  it('listing _users returns []', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'b');
    const entries = await routing.list('_users');
    assert.deepEqual(entries, []);
  });

  it('listing _users/{email} prefixes entries with _users/', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'b');
    await routing.write('_users/alice@x.com/sub/note.md', 'c');
    const entries = await routing.list('_users/alice@x.com');

    const flatten = (es: any[], acc: string[] = []): string[] => {
      for (const e of es) {
        acc.push(e.path);
        if (e.children) flatten(e.children, acc);
      }
      return acc;
    };
    const paths = flatten(entries).sort();
    assert.ok(paths.every((p) => p.startsWith('_users/alice@x.com/')), `paths: ${paths.join(', ')}`);
    assert.ok(paths.includes('_users/alice@x.com/diary.md'));
    assert.ok(paths.includes('_users/alice@x.com/sub/note.md'));
  });
});

describe('RoutingStorageAdapter — move', () => {
  it('rejects moving the personal root segment', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'x');
    await assert.rejects(
      routing.move('_users/alice@x.com', '_users/renamed@x.com'),
      (err: any) => err instanceof CrossPersonalMoveError,
    );
  });

  it('rejects move into _users or another user root as dest', async () => {
    await routing.write('Notes/foo.md', 'x');
    await assert.rejects(
      routing.move('Notes/foo.md', '_users'),
      (err: any) => err instanceof CrossPersonalMoveError,
    );
    await assert.rejects(
      routing.move('Notes/foo.md', '_users/bob@x.com'),
      (err: any) => err instanceof CrossPersonalMoveError,
    );
  });

  it('rejects moving between two distinct personal roots', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'a');
    await assert.rejects(
      routing.move('_users/alice@x.com/diary.md', '_users/bob@x.com/diary.md'),
      (err: any) => err instanceof CrossPersonalMoveError,
    );
  });

  it('renames within shared (atomic via underlying adapter)', async () => {
    await routing.write('Notes/foo.md', 'x');
    await routing.move('Notes/foo.md', 'Notes/bar.md');
    assert.equal(await routing.exists('Notes/foo.md'), false);
    assert.equal(await routing.read('Notes/bar.md'), 'x');
  });

  it('renames within a single personal root', async () => {
    await routing.write('_users/alice@x.com/diary.md', 'x');
    await routing.move('_users/alice@x.com/diary.md', '_users/alice@x.com/journal.md');
    assert.equal(await routing.exists('_users/alice@x.com/diary.md'), false);
    assert.equal(await routing.read('_users/alice@x.com/journal.md'), 'x');
  });

  it('promotes shared → personal (cross-namespace copy+delete)', async () => {
    await routing.write('Notes/foo.md', 'promote-me');
    await routing.move('Notes/foo.md', '_users/alice@x.com/foo.md');
    assert.equal(await routing.exists('Notes/foo.md'), false);
    assert.equal(await routing.read('_users/alice@x.com/foo.md'), 'promote-me');
    // Physical assertion: file is on the personal disk, not the shared disk.
    const sharedExists = await fs
      .access(path.join(sharedRoot, 'Notes/foo.md'))
      .then(() => true)
      .catch(() => false);
    assert.equal(sharedExists, false);
    const personalExists = await fs
      .access(path.join(personalRoot, 'alice@x.com/foo.md'))
      .then(() => true)
      .catch(() => false);
    assert.equal(personalExists, true);
  });

  it('demotes personal → shared (cross-namespace copy+delete)', async () => {
    await routing.write('_users/alice@x.com/foo.md', 'demote-me');
    await routing.move('_users/alice@x.com/foo.md', 'Notes/foo.md');
    assert.equal(await routing.exists('_users/alice@x.com/foo.md'), false);
    assert.equal(await routing.read('Notes/foo.md'), 'demote-me');
  });
});

describe('RoutingStorageAdapter — ensurePersonalFolder', () => {
  it('creates personal/{email}/ on first call', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    const stat = await fs.stat(path.join(personalRoot, 'alice@x.com'));
    assert.equal(stat.isDirectory(), true);
  });

  it('is idempotent — second call does not throw', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.ensurePersonalFolder('alice@x.com');
    const stat = await fs.stat(path.join(personalRoot, 'alice@x.com'));
    assert.equal(stat.isDirectory(), true);
  });

  it('preserves existing content on second call', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.write('_users/alice@x.com/diary.md', 'keep');
    await routing.ensurePersonalFolder('alice@x.com');
    assert.equal(await routing.read('_users/alice@x.com/diary.md'), 'keep');
  });
});

describe('RoutingStorageAdapter — softDeletePersonalFolder', () => {
  it('moves personal/{email}/ to .deleted/{email}-{ts}/ and returns the dest path', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.write('_users/alice@x.com/diary.md', 'secret');

    const dest = await routing.softDeletePersonalFolder('alice@x.com');
    assert.ok(dest, 'soft-delete should return the destination path');
    assert.match(dest!, /^\.deleted\/alice@x\.com-\d{4}-\d{2}-\d{2}T/);

    // Personal folder is gone from the routable namespace
    assert.equal(await routing.exists('_users/alice@x.com'), false);
    assert.equal(await routing.exists('_users/alice@x.com/diary.md'), false);

    // Content survives at the .deleted location on disk
    const physical = path.join(personalRoot, dest!, 'diary.md');
    const content = await fs.readFile(physical, 'utf-8');
    assert.equal(content, 'secret');
  });

  it('returns null when the user folder does not exist', async () => {
    const dest = await routing.softDeletePersonalFolder('ghost@x.com');
    assert.equal(dest, null);
  });

  it('soft-deleted content is unreachable through the routing adapter', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.write('_users/alice@x.com/diary.md', 'secret');
    const dest = await routing.softDeletePersonalFolder('alice@x.com');

    // Routing rejects any path under _users/.deleted/...
    await assert.rejects(
      () => routing.read(`_users/${dest}/diary.md`),
      { name: 'CrossPersonalMoveError' },
    );
  });

  it('re-registering with the same email creates a fresh empty personal folder', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.write('_users/alice@x.com/diary.md', 'secret');
    await routing.softDeletePersonalFolder('alice@x.com');

    // Fresh registration
    await routing.ensurePersonalFolder('alice@x.com');
    assert.equal(await routing.exists('_users/alice@x.com'), true);
    assert.equal(await routing.exists('_users/alice@x.com/diary.md'), false);
  });

  it('lowercases email before computing destination', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.write('_users/alice@x.com/diary.md', 'secret');

    const dest = await routing.softDeletePersonalFolder('Alice@X.com');
    assert.ok(dest);
    assert.match(dest!, /^\.deleted\/alice@x\.com-/);
  });
});

describe('RoutingStorageAdapter — dot segments', () => {
  it('refuses personal paths that would climb into another user folder', async () => {
    await routing.ensurePersonalFolder('alice@x.com');
    await routing.ensurePersonalFolder('bob@x.com');
    await routing.write('_users/bob@x.com/secret.md', 'bob only');
    const traversal = '_users/alice@x.com/../bob@x.com/secret.md';

    await assert.rejects(routing.read(traversal), CrossPersonalMoveError);
    await assert.rejects(routing.write(traversal, 'overwritten'), CrossPersonalMoveError);
    await assert.rejects(routing.delete('_users/alice@x.com/..'), CrossPersonalMoveError);
    await assert.rejects(routing.list('_users/alice@x.com/..'), CrossPersonalMoveError);
    await assert.rejects(
      routing.move('_users/alice@x.com/a.md', '_users/alice@x.com/../bob@x.com/a.md'),
      CrossPersonalMoveError,
    );
    assert.equal(await routing.exists(traversal), false);
    assert.equal(await routing.read('_users/bob@x.com/secret.md'), 'bob only');
  });
});

