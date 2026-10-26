import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { EncryptionZone } from '../entities/encryption-zone.entity';
import { EncryptionZonesService } from './encryption-zones.service';
import { MigrationSweepService } from './migration-sweep.service';
import { skipSweepEntry } from './sweep-entry-filter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { hasEnvelopeMagic, decrypt } from '../crypto/envelope';
import { EncryptionPredicates } from '../crypto/encryption-predicates';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';
import { FilesService } from '../files/files.service';

class TestPredicates implements EncryptionPredicates {
  zoneEnabled = { personal: false, shared: false };
  isEncryptedAtRest(p: string): boolean {
    return p.startsWith('_users/') ? this.zoneEnabled.personal : this.zoneEnabled.shared;
  }
  isE2EEncrypted(): boolean { return false; }
  shouldIndexPlaintext(): boolean { return true; }
  canCollab(): boolean { return true; }
  commentBodiesEncrypted(): boolean { return false; }
  shareLinkMintable(): boolean { return true; }
}

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let kek: MemoryKEKSource;
let predicates: TestPredicates;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-trash-enc-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  kek = new MemoryKEKSource(crypto.randomBytes(32));
  predicates = new TestPredicates();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writePlain(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, 'utf-8');
}

async function isEnvelope(root: string, rel: string): Promise<boolean> {
  return hasEnvelopeMagic(await fs.readFile(path.join(root, rel)));
}

describe('skipSweepEntry', () => {
  it('walks only the zone trash folders among dot entries', () => {
    assert.equal(skipSweepEntry('notes', true, '', 'shared'), false);
    assert.equal(skipSweepEntry('a.md', false, 'notes', 'shared'), false);
    assert.equal(skipSweepEntry('.trash', true, '', 'shared'), false);
    assert.equal(skipSweepEntry('.trash', true, 'alice@x.com', 'personal'), false);
    // Everything else that starts with a dot stays skipped.
    assert.equal(skipSweepEntry('.deleted', true, '', 'personal'), true);
    assert.equal(skipSweepEntry('.obsidian', true, '', 'shared'), true);
    assert.equal(skipSweepEntry('.a.md.collab', false, 'notes', 'shared'), true);
    assert.equal(skipSweepEntry('.trash', false, '', 'shared'), true);
    assert.equal(skipSweepEntry('.trash', true, '_attachments', 'shared'), true);
    assert.equal(skipSweepEntry('.trash', true, 'notes', 'shared'), true);
    assert.equal(skipSweepEntry('.trash', true, '', 'personal'), true);
    assert.equal(skipSweepEntry('.trash', true, 'alice@x.com/notes', 'personal'), true);
  });
});

describe('MigrationSweepService — trash folders', () => {
  let ds: DataSource;
  let sweep: MigrationSweepService;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EncryptionZone], synchronize: true });
    await ds.initialize();
    const zones = new EncryptionZonesService(ds.getRepository(EncryptionZone));
    await zones.initForTests();
    sweep = new MigrationSweepService(zones, predicates, kek);
    sweep.configure({ roots: { shared: sharedRoot, personal: personalRoot }, persistEvery: 5 });
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('encrypts trashed notes in the shared zone with their trash path as AAD', async () => {
    await writePlain(sharedRoot, 'live.md', 'live');
    await writePlain(sharedRoot, '.trash/abc/Plan.md', 'trashed');
    await writePlain(sharedRoot, '.obsidian/app.json', '{}');
    await writePlain(sharedRoot, '_attachments/.trash/2026-01-01T00:00:00.000Z_x.png', 'png');

    await sweep.start('shared', 'encrypt');
    await sweep.whenIdle('shared');

    assert.equal(await isEnvelope(sharedRoot, 'live.md'), true);
    assert.equal(await isEnvelope(sharedRoot, '.trash/abc/Plan.md'), true);
    const raw = await fs.readFile(path.join(sharedRoot, '.trash/abc/Plan.md'));
    assert.equal((await decrypt(raw, '.trash/abc/Plan.md', kek)).toString(), 'trashed');
    assert.equal(await isEnvelope(sharedRoot, '.obsidian/app.json'), false);
    assert.equal(await isEnvelope(sharedRoot, '_attachments/.trash/2026-01-01T00:00:00.000Z_x.png'), false);
  });

  it('encrypts the personal trash and leaves .deleted alone', async () => {
    await writePlain(personalRoot, 'alice@x.com/.trash/abc/Drafts/a.md', 'a');
    await writePlain(personalRoot, '.deleted/bob@x.com-2026/b.md', 'b');

    await sweep.start('personal', 'encrypt');
    await sweep.whenIdle('personal');

    assert.equal(await isEnvelope(personalRoot, 'alice@x.com/.trash/abc/Drafts/a.md'), true);
    assert.equal(await isEnvelope(personalRoot, '.deleted/bob@x.com-2026/b.md'), false);
  });
});

describe('EncryptingStorageAdapter — moves into and out of the trash', () => {
  let adapter: EncryptingStorageAdapter;

  beforeEach(() => {
    predicates.zoneEnabled.shared = true;
    adapter = new EncryptingStorageAdapter(new LocalFSAdapter(sharedRoot), kek, predicates);
  });

  it('re-binds the envelope to the trash path and back (with the sidecar)', async () => {
    await adapter.write('Projects/Plan.md', 'body');
    await adapter.write('Projects/.Plan.md.collab', '{"comments":{}}');
    const files = new FilesService(adapter);

    await files.relocateForTrash('Projects/Plan.md', '.trash/abc/Plan.md', 'abc');
    assert.equal(await isEnvelope(sharedRoot, '.trash/abc/Plan.md'), true);
    assert.equal(await adapter.read('.trash/abc/Plan.md'), 'body');
    assert.equal(await adapter.read('.trash/abc/.Plan.md.collab'), '{"comments":{}}');

    await files.relocateFromTrash('.trash/abc/Plan.md', 'Projects/Plan.md');
    assert.equal(await adapter.read('Projects/Plan.md'), 'body');
    assert.equal(await adapter.read('Projects/.Plan.md.collab'), '{"comments":{}}');
  });

  it('carries comment sidecars when a folder is re-encrypted on move', async () => {
    await adapter.write('Drafts/a.md', 'A');
    await adapter.write('Drafts/.a.md.collab', '{"a":1}');
    await adapter.write('Drafts/sub/b.md', 'B');
    await adapter.write('Drafts/sub/.b.md.collab', '{"b":1}');

    await adapter.move('Drafts', '.trash/def/Drafts');

    assert.equal(await adapter.read('.trash/def/Drafts/a.md'), 'A');
    assert.equal(await adapter.read('.trash/def/Drafts/.a.md.collab'), '{"a":1}');
    assert.equal(await adapter.read('.trash/def/Drafts/sub/.b.md.collab'), '{"b":1}');
    assert.equal(await adapter.exists('Drafts'), false);
  });
});
