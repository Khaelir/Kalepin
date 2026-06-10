import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { NoteAccessLog } from '../entities/note-access-log.entity';
import { AccessLogService } from './access-log.service';
import { FilesController } from '../files/files.controller';
import { CommentsController } from '../comments/comments.controller';
import { ShareLinksController } from '../share-links/share-links.controller';

let ds: DataSource;
let repo: Repository<NoteAccessLog>;
let svc: AccessLogService;

before(() => {
  process.env.ACCESS_LOG_IP_SALT = 'a'.repeat(64);
});

after(() => {
  delete process.env.ACCESS_LOG_IP_SALT;
});

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [NoteAccessLog],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(NoteAccessLog);
  svc = new AccessLogService(repo);
});

afterEach(async () => {
  await ds.destroy();
});

const filesServiceStub = {
  readFile: async () => 'file body',
  createFile: async () => undefined,
} as any;

const versionHistoryStub = {} as any;
const moduleRefStub = { get: () => null } as any;
const storageStub = { exists: async () => false } as any;
const pinServiceStub = { assertUnlockedForRequest: async () => undefined, hasPin: async () => false } as any;
const grantsStub = {} as any;
const docHandlesStub = {
  findOrCreateForPath: async () => 'AAAAAAAAAAAAAAAA',
  forPath: async () => null,
  resolve: async () => ({ path: 'Notes/foo.md', tombstoned: false }),
  updatePath: async () => undefined,
  updatePathByPath: async () => undefined,
  updatePathPrefix: async () => undefined,
  tombstone: async () => undefined,
  tombstoneByPath: async () => undefined,
  untombstone: async () => undefined,
} as any;

const visibilityStub = {
  assertReadableBy: async () => undefined,
  assertCommentableBy: async () => undefined,
} as any;

function makeReq(email: string): any {
  return { user: { email, sub: 1 }, ip: '203.0.113.4', headers: {} };
}

function makeRes(): any {
  const res = {
    setHeader: () => res,
    status: () => res,
    json: () => res,
    end: () => res,
  };
  return res;
}

describe('Route hook 5.1 — FilesController.readFile records "view"', () => {
  it('writes a row with the expected shape', async () => {
    const predicates = {
      isE2EEncrypted: () => false,
      isEncryptedAtRest: () => false,
      shouldIndexPlaintext: () => true,
      canCollab: () => true,
      commentBodiesEncrypted: () => false,
      shareLinkMintable: () => true,
    } as any;
    const ctrl = new FilesController(
      filesServiceStub,
      versionHistoryStub,
      moduleRefStub,
      storageStub,
      pinServiceStub,
      grantsStub,
      svc,
      predicates,
      docHandlesStub,
    );
    await ctrl.readFile('Notes/foo.md', undefined, makeReq('alice@example.com'), makeRes());
    // record() runs as a fire-and-forget promise; await a tick to let it resolve.
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, 'Notes/foo.md');
    assert.equal(rows[0].viewerEmail, 'alice@example.com');
    assert.equal(rows[0].action, 'view');
    assert.match(rows[0].ipHash!, /^[0-9a-f]{16}$/);
  });
});

describe('Route hook 5.1 — FilesController.createFile records "edit"', () => {
  it('writes a row with action=edit', async () => {
    const predicates = { isE2EEncrypted: () => false } as any;
    const ctrl = new FilesController(
      filesServiceStub,
      versionHistoryStub,
      moduleRefStub,
      storageStub,
      pinServiceStub,
      grantsStub,
      svc,
      predicates,
      docHandlesStub,
    );
    await ctrl.createFile({ path: 'Notes/foo.md', content: '' }, makeReq('alice@example.com'));
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'edit');
  });
});

describe('Route hook 5.1 — CommentsController.addComment records "comment"', () => {
  it('writes a row with action=comment', async () => {
    const commentsServiceStub = {
      addComment: async () => ({ id: 'c1' }),
    } as any;
    const predicates = { commentBodiesEncrypted: () => false } as any;
    const ctrl = new CommentsController(
      commentsServiceStub,
      pinServiceStub,
      visibilityStub,
      predicates,
      svc,
    );
    await ctrl.addComment(
      { path: 'Notes/foo.md', blockId: 'b1', text: 'hi' },
      makeReq('alice@example.com'),
    );
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'comment');
    assert.equal(rows[0].viewerEmail, 'alice@example.com');
  });
});

describe('Route hook 5.1 — ShareLinksController.resolve records anonymous "share-link-resolved"', () => {
  it('writes a row with viewer=anonymous', async () => {
    const shareLinksServiceStub = {
      resolve: async () => ({ kind: 'ok', path: 'Notes/foo.md' }),
      infoForCodeIncludingGone: async () => ({
        path: 'Notes/foo.md',
        createdByEmail: 'alice@example.com',
      }),
    } as any;
    const tokenStub = {
      mintAccessToken: () => ({ token: 'STUB.TOKEN', expiresAt: Date.now() + 60000 }),
      mintAssetToken: () => ({ token: 'STUB.ASSET', expiresAt: Date.now() + 60000 }),
      verifyAccessToken: () => null,
      verifyAssetToken: () => null,
    } as any;
    const storageStub = {
      exists: async () => true, read: async () => '', write: async () => {},
      delete: async () => {}, move: async () => {}, list: async () => [], watch: () => {},
    } as any;
    const attachmentsStub = {
      serveForShareLink: async () => ({ buffer: Buffer.alloc(0), contentType: '' }),
    } as any;
    const commentsStub = {
      addGuestComment: async () => ({ thread: { id: 'T', blockId: 'B', comments: [], resolved: false }, comment: { id: 'C', author: '', text: '', createdAt: '' } }),
      replyToGuestThread: async () => ({ id: 'C', author: '', text: '', createdAt: '' }),
    } as any;
    const ctrl = new ShareLinksController(
      shareLinksServiceStub,
      pinServiceStub,
      visibilityStub,
      svc,
      tokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    await ctrl.resolve('SOMECODE', { user: { email: 'alice@example.com' }, ip: '203.0.113.4', headers: {} } as any);
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'share-link-resolved');
    assert.equal(rows[0].viewerEmail, 'anonymous');
  });
});

describe('Route hook 5.5 — stage-2 contract: E2E reads log as "fetched"', () => {
  it('records action=fetched when isE2EEncrypted(path) is true', async () => {
    const predicates = {
      isE2EEncrypted: (p: string) => p === '_users/alice@example.com/_secure/journal.md',
    } as any;
    const ctrl = new FilesController(
      filesServiceStub,
      versionHistoryStub,
      moduleRefStub,
      storageStub,
      pinServiceStub,
      grantsStub,
      svc,
      predicates,
      docHandlesStub,
    );
    await ctrl.readFile(
      '_users/alice@example.com/_secure/journal.md',
      undefined,
      makeReq('alice@example.com'),
      makeRes(),
    );
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'fetched');
  });

  it('still records action=view when isE2EEncrypted(path) is false', async () => {
    const predicates = { isE2EEncrypted: () => false } as any;
    const ctrl = new FilesController(
      filesServiceStub,
      versionHistoryStub,
      moduleRefStub,
      storageStub,
      pinServiceStub,
      grantsStub,
      svc,
      predicates,
      docHandlesStub,
    );
    await ctrl.readFile('_users/alice@example.com/_secure/journal.md', undefined, makeReq('alice@example.com'), makeRes());
    await new Promise((r) => setImmediate(r));
    const rows = await repo.find();
    assert.equal(rows[0].action, 'view');
  });
});
