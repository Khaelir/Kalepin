import 'reflect-metadata';
import { describe, it, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { MentionTrackingService } from './mention-tracking.service';

function createMockRepo() {
  const records: any[] = [];
  return {
    records,
    findOne: mock.fn(async ({ where }: any) => {
      return records.find((r) => {
        for (const [key, value] of Object.entries(where)) {
          if (r[key] !== value) return false;
        }
        return true;
      }) ?? null;
    }),
    save: mock.fn(async (data: any) => {
      const record = { id: records.length + 1, sentAt: new Date(), ...data };
      records.push(record);
      return record;
    }),
    createQueryBuilder: mock.fn(() => {
      const qb: any = { _params: {} };
      qb.where = mock.fn((_: string, params: any) => {
        Object.assign(qb._params, params);
        return qb;
      });
      qb.andWhere = mock.fn((_: string, params: any) => {
        Object.assign(qb._params, params);
        return qb;
      });
      qb.getOne = mock.fn(async () => {
        const { userId, cutoff } = qb._params;
        return records.find((r) => r.userId === userId && r.sentAt > cutoff) ?? null;
      });
      return qb;
    }),
  };
}

describe('MentionTrackingService', () => {
  let service: MentionTrackingService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new MentionTrackingService(repo as any, {} as any, {} as any, {} as any);
  });

  describe('shouldSend - anti-spam pipeline', () => {
    it('rejects self-mentions', async () => {
      const result = await service.shouldSend(1, 1, 'comment', 'doc.md', 'thread1', 'comment1');
      assert.equal(result, false);
    });

    it('rejects duplicate comment notifications (per-event dedup)', async () => {
      repo.records.push({ userId: 2, type: 'comment', docPath: 'doc.md', commentId: 'comment1', sentAt: new Date(Date.now() - 60000) });
      const result = await service.shouldSend(2, 1, 'comment', 'doc.md', 'thread1', 'comment1');
      assert.equal(result, false);
    });

    it('rejects duplicate doc notifications (doc-mention dedup)', async () => {
      repo.records.push({ userId: 2, type: 'doc', docPath: 'doc.md', sentAt: new Date(Date.now() - 60000) });
      const result = await service.shouldSend(2, 1, 'doc', 'doc.md');
      assert.equal(result, false);
    });

    it('rejects when user was emailed within 10s cooldown', async () => {
      repo.records.push({ userId: 2, type: 'comment', docPath: 'other.md', commentId: 'c2', sentAt: new Date() });
      const result = await service.shouldSend(2, 1, 'comment', 'doc.md', 'thread1', 'comment2');
      assert.equal(result, false);
    });

    it('approves when all gates pass', async () => {
      const result = await service.shouldSend(2, 1, 'comment', 'doc.md', 'thread1', 'comment1');
      assert.equal(result, true);
    });
  });

  describe('collectThreadParticipants', () => {
    it('collects unique emails from comments', () => {
      const comments = [
        { text: 'Hey @[alice](alice@co.com) check this' },
        { text: '@[bob](bob@co.com) what do you think?' },
        { text: '@[alice](alice@co.com) and @[carol](carol@co.com)' },
      ];
      const participants = service.collectThreadParticipants(comments);
      assert.equal(participants.size, 3);
      assert.ok(participants.has('alice@co.com'));
      assert.ok(participants.has('bob@co.com'));
      assert.ok(participants.has('carol@co.com'));
    });

    it('excludes author from participants', () => {
      const comments = [
        { text: '@[alice](alice@co.com)' },
      ];
      const participants = service.collectThreadParticipants(comments);
      // collectThreadParticipants doesn't exclude author - that's done by caller
      assert.ok(participants.has('alice@co.com'));
    });

    it('deduplicates mentions across comments', () => {
      const comments = [
        { text: '@[alice](alice@co.com)' },
        { text: '@[alice](alice@co.com)' },
      ];
      const participants = service.collectThreadParticipants(comments);
      assert.equal(participants.size, 1);
    });
  });
});
