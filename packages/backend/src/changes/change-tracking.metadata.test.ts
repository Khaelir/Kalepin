import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ChangeTrackingService } from './change-tracking.service';
import { EncryptionPredicates } from '../crypto/encryption-predicates';

class StubPredicates implements EncryptionPredicates {
  e2ePaths = new Set<string>();
  isEncryptedAtRest(): boolean { return false; }
  isE2EEncrypted(p: string): boolean { return this.e2ePaths.has(p); }
  shouldIndexPlaintext(p: string): boolean { return !this.isE2EEncrypted(p); }
  canCollab(p: string): boolean { return !this.isE2EEncrypted(p); }
  commentBodiesEncrypted(p: string): boolean { return this.isE2EEncrypted(p); }
  shareLinkMintable(p: string): boolean { return !this.isE2EEncrypted(p); }
}

interface SavedRow {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  diff: string | null;
  userId: number | null;
  metadataOnly?: number;
  oldHash?: string | null;
  newHash?: string | null;
  opType?: string | null;
}

function makeRepos() {
  const saved: SavedRow[] = [];
  function chainable(): any {
    const qb: any = {};
    for (const m of ['where', 'andWhere', 'orderBy']) qb[m] = () => qb;
    qb.getCount = async () => 0;
    qb.getMany = async () => [];
    return qb;
  }
  const changeRepo = {
    create: (row: SavedRow) => row,
    save: async (row: SavedRow) => {
      saved.push(row);
      return { ...row, id: saved.length };
    },
    createQueryBuilder: () => chainable(),
  };
  const snapshotRepo = {
    create: (row: any) => row,
    save: async (row: any) => row,
    findOne: async () => null,
  };
  const userRepo = {} as any;
  return { changeRepo, snapshotRepo, userRepo, saved };
}

describe('ChangeTrackingService — metadata-only branch (6.2)', () => {
  it('stores full diff when shouldIndexPlaintext is true', async () => {
    const { changeRepo, snapshotRepo, userRepo, saved } = makeRepos();
    const predicates = new StubPredicates();
    const svc = new ChangeTrackingService(
      changeRepo as any,
      snapshotRepo as any,
      userRepo,
      predicates,
    );

    await svc.trackChange('Notes/foo.md', 'modified', 'old', 'new', 1);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].path, 'Notes/foo.md');
    assert.equal(typeof saved[0].diff, 'string');
    assert.notEqual(saved[0].diff, null);
    assert.equal(saved[0].metadataOnly, undefined);
  });

  it('stores hashes/op_type only when shouldIndexPlaintext is false', async () => {
    const { changeRepo, snapshotRepo, userRepo, saved } = makeRepos();
    const predicates = new StubPredicates();
    predicates.e2ePaths.add('_users/alice/_secure/diary.md');

    const svc = new ChangeTrackingService(
      changeRepo as any,
      snapshotRepo as any,
      userRepo,
      predicates,
    );

    await svc.trackChange(
      '_users/alice/_secure/diary.md',
      'modified',
      'old body',
      'new body',
      1,
    );

    assert.equal(saved.length, 1);
    const row = saved[0];
    assert.equal(row.metadataOnly, 1);
    assert.equal(row.diff, null);
    assert.equal(row.opType, 'replace');
    // SHA-256 hex output: 64 chars
    assert.equal(row.oldHash?.length, 64);
    assert.equal(row.newHash?.length, 64);
    assert.notEqual(row.oldHash, row.newHash);
  });

  it('classifies create as insert and delete as delete in op_type', async () => {
    const { changeRepo, snapshotRepo, userRepo, saved } = makeRepos();
    const predicates = new StubPredicates();
    predicates.e2ePaths.add('_users/alice/_secure/x.md');
    predicates.e2ePaths.add('_users/alice/_secure/y.md');

    const svc = new ChangeTrackingService(
      changeRepo as any,
      snapshotRepo as any,
      userRepo,
      predicates,
    );

    await svc.trackChange('_users/alice/_secure/x.md', 'created', null, 'hi', 1);
    await svc.trackChange('_users/alice/_secure/y.md', 'deleted', 'bye', null, 1);

    assert.equal(saved[0].opType, 'insert');
    assert.equal(saved[0].oldHash, null);
    assert.equal(saved[0].newHash?.length, 64);
    assert.equal(saved[1].opType, 'delete');
    assert.equal(saved[1].oldHash?.length, 64);
    assert.equal(saved[1].newHash, null);
  });

  it('falls back to plaintext indexing when no predicates are injected', async () => {
    const { changeRepo, snapshotRepo, userRepo, saved } = makeRepos();
    const svc = new ChangeTrackingService(
      changeRepo as any,
      snapshotRepo as any,
      userRepo,
      // no predicates argument
    );

    await svc.trackChange('Notes/foo.md', 'created', null, '# new', 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].metadataOnly, undefined);
    assert.notEqual(saved[0].diff, null);
  });
});
