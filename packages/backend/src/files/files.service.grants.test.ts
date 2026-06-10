import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
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
import { DocumentGrant } from '../entities/document-grant.entity';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let grants: GrantsService;
let visibility: GrantAwareVisibility;
let service: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-grants-cascade-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(
    new LocalFSAdapter(sharedRoot),
    new LocalFSAdapter(personalRoot),
  );
  await routing.ensurePersonalFolder(ALICE);

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  visibility = new GrantAwareVisibility(grants);
  service = new FilesService(
    routing as any,
    undefined, undefined, undefined, undefined, undefined,
    visibility,
    grants,
  );
});

describe('FilesService — grant cascade on rename', () => {
  it('renaming a granted note updates the grant path and Bob can still read at the new path', async () => {
    const oldPath = `_users/${ALICE}/old.md`;
    const newPath = `_users/${ALICE}/new.md`;
    await service.createFile(oldPath, 'shared content', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: oldPath, permission: 'read' });

    await service.move(oldPath, newPath, ALICE);

    const found = await grants.findActive(newPath, BOB);
    assert.ok(found, 'grant should follow the rename');
    assert.equal(found!.path, newPath);
    const body = await service.readFile(newPath, BOB);
    assert.equal(body, 'shared content');
  });

  it('renaming a shared folder cascades grants to descendants', async () => {
    const oldFolder = `_users/${ALICE}/folder`;
    const newFolder = `_users/${ALICE}/renamed`;
    await service.createFile(`${oldFolder}/a.md`, 'a', undefined, undefined, ALICE);
    await service.createFile(`${oldFolder}/b.md`, 'b', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: `${oldFolder}/a.md`, permission: 'read' });
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: `${oldFolder}/b.md`, permission: 'write' });

    await service.move(oldFolder, newFolder, ALICE);

    assert.ok(await grants.findActive(`${newFolder}/a.md`, BOB));
    assert.ok(await grants.findActive(`${newFolder}/b.md`, BOB));
    // Old paths no longer have active grants
    assert.equal(await grants.findActive(`${oldFolder}/a.md`, BOB), null);
  });
});

describe('FilesService — grant cascade on delete', () => {
  it('deleting a granted note revokes the grant and Bob\'s read returns 404', async () => {
    const filePath = `_users/${ALICE}/foo.md`;
    await service.createFile(filePath, 'x', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: filePath, permission: 'read' });

    await service.deleteFile(filePath, undefined, ALICE);

    const found = await grants.findActive(filePath, BOB);
    assert.equal(found, null);
    await assert.rejects(
      () => service.readFile(filePath, BOB),
    );
  });

  it('deleting a folder revokes grants on all descendants', async () => {
    const folder = `_users/${ALICE}/projet`;
    await service.createFile(`${folder}/a.md`, 'a', undefined, undefined, ALICE);
    await service.createFile(`${folder}/sub/b.md`, 'b', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: `${folder}/a.md`, permission: 'read' });
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: `${folder}/sub/b.md`, permission: 'read' });

    await service.deleteDirectory(folder, ALICE);

    assert.equal(await grants.findActive(`${folder}/a.md`, BOB), null);
    assert.equal(await grants.findActive(`${folder}/sub/b.md`, BOB), null);
  });
});

describe('FilesService — _shared_with_me dangling-grant safety net', () => {
  it('grant pointing at a non-existent path is filtered from the tree and revoked on next read', async () => {
    const ghost = `_users/${ALICE}/ghost.md`;
    // Mint a grant whose target was never created on disk (simulates a legacy
    // dangling row from before the rename/delete hooks shipped).
    const minted = await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: ghost, permission: 'read',
    });

    const tree = await service.listTree('', BOB);
    const swm = tree.find((e) => e.path === '_shared_with_me');
    assert.equal(swm, undefined, 'tree must not list a dangling grant');

    // Async GC fires-and-forgets — give it a tick to flush.
    await new Promise((r) => setTimeout(r, 30));
    const fresh = await grants.findById(minted.id);
    assert.ok(fresh!.revokedAt !== null, 'dangling grant should be revoked after one tree read');
  });

  it('mixes live and dangling grants — only live ones surface in the tree', async () => {
    const live = `_users/${ALICE}/live.md`;
    const ghost = `_users/${ALICE}/ghost.md`;
    await service.createFile(live, 'hi', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: live, permission: 'read' });
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: ghost, permission: 'read' });

    const tree = await service.listTree('', BOB);
    const swm = tree.find((e) => e.path === '_shared_with_me');
    assert.ok(swm);
    const grantorGroup = swm!.children![0];
    assert.equal(grantorGroup.children!.length, 1);
    assert.equal(grantorGroup.children![0].path, live);
  });
});

describe('FilesService — listTree includes _shared_with_me', () => {
  it('Bob sees Alice\'s granted note grouped by grantor in his root tree', async () => {
    const filePath = `_users/${ALICE}/shared.md`;
    await service.createFile(filePath, 'hello', undefined, undefined, ALICE);
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: filePath, permission: 'read' });

    // Bob's tree
    const tree = await service.listTree('', BOB);
    const swm = tree.find((e) => e.path === '_shared_with_me');
    assert.ok(swm, 'should include _shared_with_me virtual root');
    assert.equal(swm!.type, 'directory');
    assert.equal(swm!.children!.length, 1);
    const grantorGroup = swm!.children![0];
    assert.equal(grantorGroup.path, `_shared_with_me/${ALICE}`);
    assert.equal(grantorGroup.children!.length, 1);
    assert.equal(grantorGroup.children![0].path, filePath);
  });

  it('omits _shared_with_me when there are no active grants', async () => {
    const tree = await service.listTree('', BOB);
    const swm = tree.find((e) => e.path === '_shared_with_me');
    assert.equal(swm, undefined);
  });
});
