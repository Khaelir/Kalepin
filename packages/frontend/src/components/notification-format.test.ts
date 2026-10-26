import { describe, it, expect } from 'vitest';
import type { InboxNotification } from '../api';
import {
  noteTitle,
  actorLabel,
  describeNotification,
  notificationSentence,
  formatRelativeTime,
  formatBadgeCount,
  mergeFirstPage,
} from './notification-format';

function item(overrides: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: 1,
    type: 'comment_mention',
    actorEmail: 'alice.smith@example.com',
    actorName: null,
    path: 'Projects/Q3 Plan.md',
    threadId: 't1',
    commentId: 'c1',
    heading: null,
    snippet: 'Hey @bob',
    createdAt: 0,
    readAt: null,
    available: true,
    ...overrides,
  };
}

describe('noteTitle', () => {
  it('uses the last segment without extension', () => {
    expect(noteTitle('Projects/Q3 Plan.md')).toBe('Q3 Plan');
    expect(noteTitle('_users/bob@example.com/Diary.md')).toBe('Diary');
    expect(noteTitle('README')).toBe('README');
    expect(noteTitle('a/b.v2.md')).toBe('b.v2');
  });
});

describe('actorLabel', () => {
  it('prefers the display name, else the email local part', () => {
    expect(actorLabel({ actorName: 'Alice S.', actorEmail: 'alice@example.com' })).toBe('Alice S.');
    expect(actorLabel({ actorName: null, actorEmail: 'alice.smith@example.com' })).toBe('alice.smith');
    expect(actorLabel({ actorName: '  ', actorEmail: 'bob@example.com' })).toBe('bob');
  });
});

describe('describeNotification', () => {
  it('phrases each type', () => {
    expect(notificationSentence(item({ type: 'comment_mention' }))).toBe('alice.smith mentioned you in Q3 Plan');
    expect(notificationSentence(item({ type: 'doc_mention' }))).toBe('alice.smith mentioned you in Q3 Plan');
    expect(notificationSentence(item({ type: 'thread_reply' }))).toBe('alice.smith replied in Q3 Plan');
    expect(notificationSentence(item({ type: 'share' }))).toBe('alice.smith shared Q3 Plan with you');
  });

  it('splits the note title out for styling', () => {
    expect(describeNotification(item({ type: 'share' }))).toEqual({
      actor: 'alice.smith',
      lead: 'shared',
      note: 'Q3 Plan',
      tail: 'with you',
    });
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 9, 26, 12, 0, 0);
  it('buckets by minute, hour and day', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86400_000, now)).toBe('2d ago');
  });

  it('falls back to a date after a week', () => {
    const s = formatRelativeTime(now - 30 * 86400_000, now);
    expect(s).not.toMatch(/ago/);
    expect(s.length).toBeGreaterThan(0);
  });
});

describe('formatBadgeCount', () => {
  it('hides zero and caps at 99+', () => {
    expect(formatBadgeCount(0)).toBe('');
    expect(formatBadgeCount(-1)).toBe('');
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});

describe('mergeFirstPage', () => {
  it('adds new items on top and updates known ones in place', () => {
    const current = [item({ id: 3 }), item({ id: 2 }), item({ id: 1 })];
    const fresh = [item({ id: 4 }), item({ id: 3, readAt: 99 })];
    const merged = mergeFirstPage(current, fresh);
    expect(merged.map((n) => n.id)).toEqual([4, 3, 2, 1]);
    expect(merged[1].readAt).toBe(99);
    expect(merged[2].readAt).toBeNull();
  });
});
