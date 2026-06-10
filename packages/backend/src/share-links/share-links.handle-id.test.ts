import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { ShortLink } from '../entities/short-link.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { ShareLinksService } from './share-links.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import type { StorageAdapter } from '../storage';

function mockStorage(existingFiles: Set<string>): StorageAdapter {
  return {
    exists: async (p: string) => existingFiles.has(p),
    read: async () => '',
    write: async () => {},
    delete: async () => {},
    move: async () => {},
    list: async () => [],
    watch: () => {},
  } as unknown as StorageAdapter;
}

const predicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as any;

let ds: DataSource;
let shortLinkRepo: Repository<ShortLink>;
let docHandleRepo: Repository<DocHandle>;
let docHandles: DocHandlesService;
let shareLinks: ShareLinksService;

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [ShortLink, DocHandle],
    synchronize: true,
  });
  await ds.initialize();
  shortLinkRepo = ds.getRepository(ShortLink);
  docHandleRepo = ds.getRepository(DocHandle);
  docHandles = new DocHandlesService(docHandleRepo);
  const files = new Set<string>(['notes/meeting.md']);
  shareLinks = new ShareLinksService(
    shortLinkRepo,
    mockStorage(files),
    predicates,
    docHandles,
  );
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

describe('ShareLinksService.infoForCodeIncludingGone — handleId', () => {
  it('returns handleId=null when no handle row exists yet (lazy-mint at resolve time)', async () => {
    const { code } = await shareLinks.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const info = await shareLinks.infoForCodeIncludingGone(code);
    assert.notEqual(info, null);
    assert.equal(info!.path, 'notes/meeting.md');
    assert.equal(info!.handleId, null);
  });

  it('returns the existing handleId when one already exists', async () => {
    const id = await docHandles.findOrCreateForPath('notes/meeting.md');
    const { code } = await shareLinks.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const info = await shareLinks.infoForCodeIncludingGone(code);
    assert.equal(info!.handleId, id);
  });

  it('still surfaces handleId after the link has been revoked (gone path)', async () => {
    const id = await docHandles.findOrCreateForPath('notes/meeting.md');
    const { code } = await shareLinks.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await shareLinks.revoke(code);
    const info = await shareLinks.infoForCodeIncludingGone(code);
    assert.notEqual(info, null);
    assert.equal(info!.handleId, id);
  });
});
