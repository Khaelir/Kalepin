import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from '../files/files.service';
import { GrantsService } from './grants.service';
import { GrantsController } from './grants.controller';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { DocumentGrant } from '../entities/document-grant.entity';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';

const passthroughPredicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as const;

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let grants: GrantsService;
let visibility: GrantAwareVisibility;
let files: FilesService;
let grantsCtrl: GrantsController;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-grants-e2e-'));
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
  await routing.ensurePersonalFolder(BOB);

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  visibility = new GrantAwareVisibility(grants);
  files = new FilesService(
    routing as any,
    undefined, undefined, undefined, undefined, undefined,
    visibility,
    grants,
  );
  grantsCtrl = new GrantsController(grants, visibility, passthroughPredicates as any);
});

function makeReq(email: string): any {
  return { user: { email, sub: 1 } };
}

describe('e2e: 8.2 — grant lifecycle (read, then revoke)', () => {
  it('Alice grants read; Bob can read; Bob cannot write; Alice revokes; Bob 404s', async () => {
    const filePath = `_users/${ALICE}/foo.md`;
    await files.createFile(filePath, 'shared body', undefined, undefined, ALICE);

    // Alice mints a read grant for Bob
    const r = await grantsCtrl.mint(
      { grantee_email: BOB, path: filePath, permission: 'read' },
      makeReq(ALICE),
    );

    // Bob can read
    const body = await files.readFile(filePath, BOB);
    assert.equal(body, 'shared body');

    // Bob cannot write (read grant only)
    await assert.rejects(
      () => files.createFile(filePath, 'modified by bob', undefined, undefined, BOB),
      (e: any) => e instanceof ForbiddenException,
    );

    // Alice revokes
    await grantsCtrl.revoke(String(r.id), makeReq(ALICE));

    // Bob's next read returns 404 (existence non-observable)
    await assert.rejects(
      () => files.readFile(filePath, BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });

  it('write grant: Bob can read AND write', async () => {
    const filePath = `_users/${ALICE}/collab.md`;
    await files.createFile(filePath, 'v1', undefined, undefined, ALICE);
    await grantsCtrl.mint(
      { grantee_email: BOB, path: filePath, permission: 'write' },
      makeReq(ALICE),
    );
    const body = await files.readFile(filePath, BOB);
    assert.equal(body, 'v1');
    await files.createFile(filePath, 'v2', undefined, undefined, BOB);
    assert.equal(await files.readFile(filePath, BOB), 'v2');
  });
});

describe('e2e: 8.3 — bulk folder share', () => {
  it('minting N grants in sequence behaves consistently', async () => {
    const folder = `_users/${ALICE}/projet`;
    const paths = [
      `${folder}/a.md`,
      `${folder}/b.md`,
      `${folder}/c.md`,
    ];
    for (const p of paths) {
      await files.createFile(p, 'x', undefined, undefined, ALICE);
    }
    // Bulk-mint via the controller
    const ids: number[] = [];
    for (const p of paths) {
      const r = await grantsCtrl.mint(
        { grantee_email: BOB, path: p, permission: 'read' },
        makeReq(ALICE),
      );
      ids.push(r.id);
    }
    assert.equal(ids.length, 3);
    const list = await grantsCtrl.list('grantee', undefined, makeReq(BOB));
    assert.equal(list.grants.length, 3);
    for (const p of paths) {
      assert.ok(list.grants.some((g) => g.path === p), `${p} should be in Bob's grants`);
    }
  });
});

describe('e2e: 8.4 — sidebar shared-with-me', () => {
  it('Bob\'s tree shows _shared_with_me grouped by grantor', async () => {
    const aliceFile = `_users/${ALICE}/from-alice.md`;
    const carolFile = `_users/${CAROL}/from-carol.md`;
    await routing.ensurePersonalFolder(CAROL);
    await files.createFile(aliceFile, 'a', undefined, undefined, ALICE);
    await files.createFile(carolFile, 'c', undefined, undefined, CAROL);
    await grantsCtrl.mint(
      { grantee_email: BOB, path: aliceFile, permission: 'read' },
      makeReq(ALICE),
    );
    await grantsCtrl.mint(
      { grantee_email: BOB, path: carolFile, permission: 'write' },
      makeReq(CAROL),
    );

    const tree = await files.listTree('', BOB);
    const swm = tree.find((e) => e.path === '_shared_with_me');
    assert.ok(swm, '_shared_with_me virtual root must be present');
    assert.equal(swm!.children!.length, 2, 'two grantor groups');
    const grantors = swm!.children!.map((c) => c.path).sort();
    assert.deepEqual(grantors, [
      `_shared_with_me/${ALICE}`,
      `_shared_with_me/${CAROL}`,
    ]);
  });
});

describe('e2e: 8.5 — leak sweep across authenticated read paths', () => {
  it('foreign personal path with NO grant returns 404 from readFile', async () => {
    const aliceSecret = `_users/${ALICE}/secret.md`;
    await files.createFile(aliceSecret, 'top secret', undefined, undefined, ALICE);

    // Bob has no grant → 404 (never 403)
    await assert.rejects(
      () => files.readFile(aliceSecret, BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });

  it('foreign personal path with NO grant is absent from listTree', async () => {
    await files.createFile(`_users/${ALICE}/secret.md`, 'x', undefined, undefined, ALICE);
    const bobTree = await files.listTree('', BOB);
    const flat = (es: any[]): string[] => es.flatMap((e) => [e.path, ...(e.children ? flat(e.children) : [])]);
    const allPaths = flat(bobTree);
    assert.ok(
      !allPaths.some((p) => p.startsWith(`_users/${ALICE}`)),
      `Bob must never see Alice's personal subtree (got: ${allPaths.join(', ')})`,
    );
    // _shared_with_me is allowed (it's a virtual root, not a real personal path)
  });

  it('listTree on foreign personal subtree returns 404', async () => {
    await files.createFile(`_users/${ALICE}/secret.md`, 'x', undefined, undefined, ALICE);
    await assert.rejects(
      () => files.listTree(`_users/${ALICE}`, BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });

  it('granted path appears in listTree under _shared_with_me but the original location remains hidden in foreign subtree access', async () => {
    const filePath = `_users/${ALICE}/granted.md`;
    await files.createFile(filePath, 'x', undefined, undefined, ALICE);
    await grantsCtrl.mint(
      { grantee_email: BOB, path: filePath, permission: 'read' },
      makeReq(ALICE),
    );
    // listTree(`_users/alice`) is still 404 even though Bob has a grant on a child
    await assert.rejects(
      () => files.listTree(`_users/${ALICE}`, BOB),
      (e: any) => e instanceof NotFoundException,
    );
    // But readFile() succeeds for the granted path
    assert.equal(await files.readFile(filePath, BOB), 'x');
  });

  it('expired grant: Bob\'s read returns 404', async () => {
    const filePath = `_users/${ALICE}/expiring.md`;
    await files.createFile(filePath, 'x', undefined, undefined, ALICE);
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: filePath, permission: 'read',
      expiresAt: Date.now() - 1000,
    });
    await assert.rejects(
      () => files.readFile(filePath, BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });

  it('non-grantee CAROL: foreign path with grant for Bob remains 404 for her', async () => {
    const filePath = `_users/${ALICE}/foo.md`;
    await files.createFile(filePath, 'x', undefined, undefined, ALICE);
    await grantsCtrl.mint(
      { grantee_email: BOB, path: filePath, permission: 'read' },
      makeReq(ALICE),
    );
    await assert.rejects(
      () => files.readFile(filePath, CAROL),
      (e: any) => e instanceof NotFoundException,
    );
  });
});
