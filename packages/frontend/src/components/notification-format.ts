import type { InboxNotification, InboxNotificationType } from '../api';

/** Note name shown in the inbox: last path segment without its extension. */
export function noteTitle(path: string): string {
  const leaf = path.split('/').pop() || path;
  return leaf.replace(/\.[^.]+$/, '') || leaf;
}

/** Display name, else the email's local part (as comment authors are shown). */
export function actorLabel(n: Pick<InboxNotification, 'actorName' | 'actorEmail'>): string {
  return n.actorName?.trim() || n.actorEmail.split('@')[0] || n.actorEmail;
}

const PHRASES: Record<InboxNotificationType, { lead: string; tail: string }> = {
  comment_mention: { lead: 'mentioned you in', tail: '' },
  doc_mention: { lead: 'mentioned you in', tail: '' },
  thread_reply: { lead: 'replied in', tail: '' },
  share: { lead: 'shared', tail: 'with you' },
};

/** "{actor} {lead} {note} {tail}" — split so the note title can be styled. */
export function describeNotification(n: InboxNotification): { actor: string; lead: string; note: string; tail: string } {
  const phrase = PHRASES[n.type] ?? PHRASES.comment_mention;
  return { actor: actorLabel(n), lead: phrase.lead, note: noteTitle(n.path), tail: phrase.tail };
}

/** Plain sentence for accessible names. */
export function notificationSentence(n: InboxNotification): string {
  const d = describeNotification(n);
  return [d.actor, d.lead, d.note, d.tail].filter(Boolean).join(' ');
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Badge text: empty when nothing is unread, capped at 99+. */
export function formatBadgeCount(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

/** Merge a freshly fetched first page into the list already on screen:
 * new items on top, known items updated in place, newest first. */
export function mergeFirstPage(current: InboxNotification[], fresh: InboxNotification[]): InboxNotification[] {
  const byId = new Map(fresh.map((n) => [n.id, n]));
  const known = new Set(current.map((n) => n.id));
  const merged = current.map((n) => byId.get(n.id) ?? n);
  const added = fresh.filter((n) => !known.has(n.id));
  return [...added, ...merged].sort((a, b) => b.id - a.id);
}
