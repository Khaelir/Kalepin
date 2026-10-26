import { describe, it, expect } from 'vitest';
import {
  browserTimeZone,
  groupTemplates,
  isTodayNoteShortcut,
  localDateKey,
  todayNoteShortcutLabel,
} from './templates';
import type { TemplateInfo } from './api';

describe('localDateKey', () => {
  it('formats the local calendar day with padding', () => {
    expect(localDateKey(new Date(2026, 2, 5, 23, 59))).toBe('2026-03-05');
    expect(localDateKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('uses local time, not UTC', () => {
    const d = new Date(2026, 0, 1, 0, 30);
    expect(localDateKey(d)).toBe('2026-01-01');
  });
});

describe('browserTimeZone', () => {
  it('returns an IANA name Intl accepts', () => {
    const tz = browserTimeZone();
    expect(typeof tz).toBe('string');
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow();
  });
});

describe('groupTemplates', () => {
  const t = (name: string, scope: TemplateInfo['scope']): TemplateInfo => ({
    name,
    path: scope === 'shared' ? `Templates/${name}.md` : `_users/me@x/Templates/${name}.md`,
    scope,
  });

  it('splits by scope and sorts each group by name', () => {
    const groups = groupTemplates([t('Weekly', 'shared'), t('Diary', 'personal'), t('Meeting', 'shared'), t('Bullet', 'personal')]);
    expect(groups.shared.map((x) => x.name)).toEqual(['Meeting', 'Weekly']);
    expect(groups.personal.map((x) => x.name)).toEqual(['Bullet', 'Diary']);
  });

  it('returns empty groups for an empty list', () => {
    expect(groupTemplates([])).toEqual({ shared: [], personal: [] });
  });
});

describe('isTodayNoteShortcut', () => {
  const ev = (over: Partial<KeyboardEvent>) =>
    ({ key: 'D', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, ...over }) as KeyboardEvent;

  it('matches Cmd+Shift+D and Ctrl+Shift+D', () => {
    expect(isTodayNoteShortcut(ev({ metaKey: true }))).toBe(true);
    expect(isTodayNoteShortcut(ev({ ctrlKey: true }))).toBe(true);
    expect(isTodayNoteShortcut(ev({ ctrlKey: true, key: 'd' }))).toBe(true);
  });

  it('ignores other combinations', () => {
    expect(isTodayNoteShortcut(ev({}))).toBe(false); // no modifier
    expect(isTodayNoteShortcut(ev({ metaKey: true, shiftKey: false, key: 'd' }))).toBe(false); // ⌘D
    expect(isTodayNoteShortcut(ev({ metaKey: true, altKey: true }))).toBe(false);
    expect(isTodayNoteShortcut(ev({ metaKey: true, key: 'N' }))).toBe(false);
  });
});

describe('todayNoteShortcutLabel', () => {
  it('uses symbols on macOS and words elsewhere', () => {
    expect(todayNoteShortcutLabel(true)).toBe('⌘⇧D');
    expect(todayNoteShortcutLabel(false)).toBe('Ctrl+Shift+D');
  });
});
