import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from './files.service';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { ShortLink, DocumentGrant } from '../entities';

// Grants and public links were re-pointed on every move. Bob's public link and
// his write grant for Carol on the shared Plan.md followed the note when Alice
// moved it into her personal folder to make it private.

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';

const predicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as any;

let tmpRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let grants: GrantsService;
let shareLinks: ShareLinksService;
let service: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-namespace-move-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const sharedRoot = path.join(tmpRoot, 'vault');
  const personalRoot = path.join(tmpRoot, 'personal');
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(new LocalFSAdapter(sharedRoot), new LocalFSAdapter(personalRoot));
  await routing.ensurePersonalFolder(ALICE);

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant, ShortLink],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  shareLinks = new ShareLinksService(ds.getRepository(ShortLink), routing as any, predicates);
  service = new FilesService(
    routing as any,
    undefined, undefined, undefined,
    shareLinks,
    undefined,
    new GrantAwareVisibility(grants),
    grants,
  );
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

describe('FilesService.move — grants and public links stay behind across namespaces', () => {
  it('a shared note moved into a personal folder drops other people\'s grants and links', async () => {
    await service.createFile('Plan.md', 'plan', undefined, undefined, BOB);
    const { code } = await shareLinks.mintExplicit({ path: 'Plan.md', createdByEmail: BOB });
    await grants.mint({ grantorEmail: BOB, granteeEmail: CAROL, path: 'Plan.md', permission: 'write' });

    const dest = `_users/${ALICE}/Plan.md`;
    await service.move('Plan.md', dest, ALICE);

    assert.deepEqual(await shareLinks.resolve(code), { kind: 'gone', reason: 'revoked' });
    assert.equal(await grants.findActive(dest, CAROL), null);
    await assert.rejects(() => service.readFile(dest, CAROL));
    assert.equal(await service.readFile(dest, ALICE), 'plan');
  });

  it('the owner\'s own grants and links do not follow her note into the shared vault', async () => {
    const src = `_users/${ALICE}/n.md`;
    await service.createFile(src, 'n', undefined, undefined, ALICE);
    const { code } = await shareLinks.mintExplicit({ path: src, createdByEmail: ALICE });
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: src, permission: 'read' });

    await service.move(src, 'n.md', ALICE);

    assert.deepEqual(await shareLinks.resolve(code), { kind: 'gone', reason: 'revoked' });
    assert.equal(await grants.findActive('n.md', BOB), null);
  });

  it('a rename inside the same folder keeps them', async () => {
    const src = `_users/${ALICE}/old.md`;
    const dest = `_users/${ALICE}/new.md`;
    await service.createFile(src, 'x', undefined, undefined, ALICE);
    const { code } = await shareLinks.mintExplicit({ path: src, createdByEmail: ALICE });
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: src, permission: 'read' });

    await service.move(src, dest, ALICE);

    assert.deepEqual(await shareLinks.resolve(code), { kind: 'ok', path: dest });
    assert.ok(await grants.findActive(dest, BOB));
  });

  it('a move inside the shared vault keeps them', async () => {
    await service.createFile('Plan.md', 'plan', undefined, undefined, BOB);
    const { code } = await shareLinks.mintExplicit({ path: 'Plan.md', createdByEmail: BOB });
    await service.move('Plan.md', 'Archive/Plan.md', ALICE);
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'ok', path: 'Archive/Plan.md' });
  });
});
