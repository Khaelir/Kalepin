const STORAGE_KEY = 'kalepin-recent';
const MAX_RECENT = 8;
const CHANGE_EVENT = 'kalepin:recent-files-changed';

export interface RecentFile {
  path: string;
  visitedAt: number;
}

export function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentFile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => typeof r?.path === 'string' && typeof r?.visitedAt === 'number');
  } catch {
    return [];
  }
}

export function recordVisit(path: string): void {
  if (!path) return;
  const existing = getRecentFiles().filter((r) => r.path !== path);
  const next = [{ path, visitedAt: Date.now() }, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — silently drop */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function removeRecent(path: string): void {
  const next = getRecentFiles().filter((r) => r.path !== path);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeRecent(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return 'now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
