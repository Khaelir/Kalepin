import { describe, it, expect } from 'vitest';
import {
  isSelfOrUnder,
  displayName,
  trashLocationLabel,
  formatDeletedAgo,
  daysUntilPurge,
  deleteConfirmCopy,
  pathAfterRestore,
} from './trash';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const DAY = 86_400_000;

describe('trash helpers', () => {
  it('matches a path and its descendants only', () => {
    expect(isSelfOrUnder('Drafts', 'Drafts')).toBe(true);
    expect(isSelfOrUnder('Drafts/a.md', 'Drafts')).toBe(true);
    expect(isSelfOrUnder('Drafts 2/a.md', 'Drafts')).toBe(false);
    expect(isSelfOrUnder('Draft', 'Drafts')).toBe(false);
  });

  it('shows names without the .md extension', () => {
    expect(displayName('Projects/Plan.md')).toBe('Plan');
    expect(displayName('Projects/Drafts')).toBe('Drafts');
    expect(displayName('v1.2.notes')).toBe('v1.2.notes');
  });

  it('labels the original location', () => {
    expect(trashLocationLabel('')).toBe('Vault');
    expect(trashLocationLabel('Projects/2026')).toBe('Projects/2026');
    expect(trashLocationLabel('_users/alice@x.com')).toBe('Personal');
    expect(trashLocationLabel('_users/alice@x.com/Drafts/old')).toBe('Personal / Drafts/old');
  });

  it('formats the deletion time', () => {
    expect(formatDeletedAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(formatDeletedAgo(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(formatDeletedAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(formatDeletedAgo(NOW - 30 * 3_600_000, NOW)).toBe('yesterday');
    expect(formatDeletedAgo(NOW - 4 * DAY, NOW)).toBe('4 days ago');
    expect(formatDeletedAgo(NOW + 5_000, NOW)).toBe('just now');
  });

  it('counts the days left before automatic purge', () => {
    expect(daysUntilPurge(NOW, 30, NOW)).toBe(30);
    expect(daysUntilPurge(NOW - 29.5 * DAY, 30, NOW)).toBe(1);
    expect(daysUntilPurge(NOW - 40 * DAY, 30, NOW)).toBe(0);
    expect(daysUntilPurge(NOW, 0, NOW)).toBeNull();
  });

  it('words the delete confirmation by destination', () => {
    expect(deleteConfirmCopy({ path: 'Plan.md', type: 'file' })).toMatchObject({
      title: 'Move to trash?',
      confirmLabel: 'Move to trash',
    });
    expect(deleteConfirmCopy({ path: 'Drafts', type: 'directory' }).message).toMatch(/^This folder and everything in it/);
    expect(deleteConfirmCopy({ path: '_users/a@x.com/_secure/diary.md', type: 'file' })).toMatchObject({
      title: 'Delete permanently?',
      confirmLabel: 'Delete permanently',
    });
  });

  it('maps an open doc to its restored path', () => {
    expect(pathAfterRestore('Plan.md', 'Plan.md', 'Plan.md')).toBe('Plan.md');
    expect(pathAfterRestore('Plan.md', 'Plan.md', 'Plan (restored).md')).toBe('Plan (restored).md');
    expect(pathAfterRestore('Drafts/a.md', 'Drafts', 'Drafts (restored)')).toBe('Drafts (restored)/a.md');
    expect(pathAfterRestore('Other.md', 'Drafts', 'Drafts (restored)')).toBe('Other.md');
  });
});
