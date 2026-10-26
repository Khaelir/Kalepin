import type { TemplateInfo } from './api';

/** `YYYY-MM-DD` for the browser's local day — the daily note's date. */
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The browser's IANA timezone; the server falls back to its own when absent. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface TemplateGroups {
  shared: TemplateInfo[];
  personal: TemplateInfo[];
}

/** Split for the picker; each group sorted by name. */
export function groupTemplates(templates: TemplateInfo[]): TemplateGroups {
  const byName = (a: TemplateInfo, b: TemplateInfo) => a.name.localeCompare(b.name);
  return {
    shared: templates.filter((t) => t.scope === 'shared').sort(byName),
    personal: templates.filter((t) => t.scope === 'personal').sort(byName),
  };
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/** ⌘⇧D (macOS) / Ctrl+Shift+D: open today's note. */
export function isTodayNoteShortcut(e: ShortcutEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd';
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

export function todayNoteShortcutLabel(mac: boolean = isMacPlatform()): string {
  return mac ? '⌘⇧D' : 'Ctrl+Shift+D';
}
