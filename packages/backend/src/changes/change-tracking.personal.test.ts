import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ChangeTrackingService } from './change-tracking.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

interface FakeChange {
  id: number;
  path: string;
  action: 'created' | 'modified' | 'deleted';
  userId: number | null;
  diff: string | null;
  createdAt: Date;
}

function chainable<T>(rows: T[]): any {
  // A QueryBuilder fake: every chain method returns the same proxy, getMany / getCount resolve.
  const qb: any = {};
  for (const m of [
    'where', 'andWhere', 'orWhere',
    'orderBy', 'addOrderBy',
    'innerJoin', 'leftJoin', 'select', 'addSelect',
    'limit', 'offset', 'groupBy', 'from',
  ]) {
    qb[m] = () => qb;
  }
  qb.getMany = async () => rows;
  qb.getCount = async () => rows.length;
  return qb;
}

function makeService(changes: FakeChange[]) {
  const changeRepo = { createQueryBuilder: () => chainable(changes) };
  const userRepo = { createQueryBuilder: () => chainable<any>([]) };
  const snapshotRepo = {} as any;
  return new ChangeTrackingService(
    changeRepo as any,
    snapshotRepo,
    userRepo as any,
  );
}

describe('ChangeTrackingService — getChangesSince', () => {
  it('drops rows whose path is not visible to the viewer', async () => {
    const changes: FakeChange[] = [
      { id: 1, path: 'Notes/shared.md', action: 'modified', userId: 1, diff: 'shared diff', createdAt: new Date('2026-04-01') },
      { id: 2, path: '_users/alice@example.com/secret.md', action: 'modified', userId: 1, diff: 'secret diff', createdAt: new Date('2026-04-02') },
    ];
    const svc = makeService(changes);

    const aliceResp = await svc.getChangesSince(null, undefined, undefined, ALICE);
    const allAlicePaths = [...aliceResp.starred, ...aliceResp.other].flatMap((g) => g.files.map((f) => f.path));
    assert.ok(allAlicePaths.includes('_users/alice@example.com/secret.md'));
    assert.ok(allAlicePaths.includes('Notes/shared.md'));

    const bobResp = await svc.getChangesSince(null, undefined, undefined, BOB);
    const allBobPaths = [...bobResp.starred, ...bobResp.other].flatMap((g) => g.files.map((f) => f.path));
    assert.deepEqual(allBobPaths.sort(), ['Notes/shared.md']);

    // Stats also exclude the suppressed row.
    assert.equal(bobResp.stats.modified, 1);
  });

  it('system caller (no viewerEmail) sees everything', async () => {
    const changes: FakeChange[] = [
      { id: 1, path: 'Notes/shared.md', action: 'modified', userId: 1, diff: 'd', createdAt: new Date() },
      { id: 2, path: '_users/alice@example.com/secret.md', action: 'created', userId: 1, diff: 'd', createdAt: new Date() },
    ];
    const svc = makeService(changes);
    const resp = await svc.getChangesSince(null);
    const allPaths = [...resp.starred, ...resp.other].flatMap((g) => g.files.map((f) => f.path));
    assert.equal(allPaths.length, 2);
  });
});

describe('ChangeTrackingService — getRecentlyEdited', () => {
  it('drops foreign personal rows for non-owner', async () => {
    const changes: FakeChange[] = [
      { id: 1, path: 'Notes/shared.md', action: 'modified', userId: 1, diff: null, createdAt: new Date() },
      { id: 2, path: '_users/alice@example.com/secret.md', action: 'modified', userId: 1, diff: null, createdAt: new Date() },
    ];
    const svc = makeService(changes);
    const items = await svc.getRecentlyEdited(50, BOB);
    assert.deepEqual(items.map((i) => i.path).sort(), ['Notes/shared.md']);
  });
});
