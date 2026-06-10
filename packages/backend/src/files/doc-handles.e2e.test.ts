import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GoneException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

const ALICE = 'alice@example.com';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let repo: Repository<DocHandle>;
let docHandles: DocHandlesService;
let filesService: FilesService;
let controller: FilesController;

const stubPin = { assertUnlockedForRequest: async () => {} } as any;
const stubAccessLog = { record: () => {} } as any;
const stubVersionHistory = {} as any;
const stubModuleRef = {} as any;
const stubGrants = {} as any;
const stubPredicates = {
  isE2EEncrypted: () => false,
  isEncryptedAtRest: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as any;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-doc-handles-e2e-'));
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

  if (ds?.isInitialized) await ds.destroy();
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocHandle],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(DocHandle);
  docHandles = new DocHandlesService(repo);

  filesService = new FilesService(
    routing as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    docHandles,
  );

  controller = new FilesController(
    filesService,
    stubVersionHistory,
    stubModuleRef,
    routing as any,
    stubPin,
    stubGrants,
    stubAccessLog,
    stubPredicates,
    docHandles,
  );
});

function makeRes() {
  let body: any = null;
  let statusCode = 200;
  return {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(obj: any) { body = obj; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}
function makeReq(): any {
  return { headers: {}, user: { email: ALICE, sub: 1 } };
}
async function flushAsync(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('Doc handles — backend e2e via FilesController', () => {
  it('create file → read returns handle → read by handle returns same content', async () => {
    await controller.createFile({ path: 'Notes/Foo.md', content: 'hello' }, makeReq());
    await flushAsync();

    const res1 = makeRes();
    await controller.readFile('Notes/Foo.md', undefined, makeReq(), res1 as any);
    assert.equal(res1.body.content, 'hello');
    const id = res1.body.handle.id;
    assert.match(id, /^[A-Z2-7]{16}$/);

    const res2 = makeRes();
    await controller.readFile(undefined, id, makeReq(), res2 as any);
    assert.equal(res2.body.content, 'hello');
    assert.equal(res2.body.handle.id, id);
  });

  it('rename → read by handle resolves to the new path', async () => {
    await controller.createFile({ path: 'Notes/Foo.md', content: 'x' }, makeReq());
    await flushAsync();
    const res1 = makeRes();
    await controller.readFile('Notes/Foo.md', undefined, makeReq(), res1 as any);
    const id = res1.body.handle.id;

    await filesService.move('Notes/Foo.md', 'Archive/Foo.md', ALICE);

    const res2 = makeRes();
    await controller.readFile(undefined, id, makeReq(), res2 as any);
    assert.equal(res2.body.content, 'x');
    assert.equal(res2.body.handle.path, 'Archive/Foo.md');
  });

  it('delete → read by handle returns 410 with { tombstoned: true }', async () => {
    await controller.createFile({ path: 'Notes/Foo.md', content: 'x' }, makeReq());
    await flushAsync();
    const res1 = makeRes();
    await controller.readFile('Notes/Foo.md', undefined, makeReq(), res1 as any);
    const id = res1.body.handle.id;

    await filesService.deleteFile('Notes/Foo.md', undefined, ALICE);
    await flushAsync();

    await assert.rejects(
      () => controller.readFile(undefined, id, makeReq(), makeRes() as any),
      (err) => {
        if (!(err instanceof GoneException)) return false;
        const r = (err as any).getResponse();
        return r && r.tombstoned === true;
      },
    );
  });

  it('unknown handle → 404', async () => {
    await assert.rejects(
      () => controller.readFile(undefined, 'NOTAREALHANDLE2X', makeReq(), makeRes() as any),
      (err) => err instanceof NotFoundException,
    );
  });
});
