import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseFrontmatter } from '../utils/frontmatter';
import { TagPill } from '../components/TagPill';

interface PresenceUser {
  userId: string;
  email: string;
  color: string;
}

interface Props {
  filePath: string;
  authorEmail: string | null;
  updatedAt: string | null;
  wordCount: number;
  backlinkCount: number;
  content: string | null | undefined;
  presenceUsers: PresenceUser[];
  onRename: (newName: string) => Promise<boolean> | boolean;
  onRenameError?: (msg: string) => void;
  /** Bumped from outside to put the title into rename mode (focus + select all). */
  renameRequestKey?: number;
  /** Opens the search modal on `tag:<tag>`. */
  onTagClick?: (tag: string) => void;
}

const STATUS_STYLES: Record<string, 'draft' | 'approved' | 'warning'> = {
  draft: 'draft',
  'in-review': 'warning',
  review: 'warning',
  approved: 'approved',
  done: 'approved',
};

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const delta = (Date.now() - then) / 1000;
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function titleFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

export function DocHeader({
  filePath,
  authorEmail,
  updatedAt,
  wordCount,
  backlinkCount,
  content,
  presenceUsers,
  onRename,
  onRenameError,
  renameRequestKey,
  onTagClick,
}: Props) {
  const title = titleFromPath(filePath);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [tick, setTick] = useState(0);

  // Keep the contenteditable title in sync with filePath changes (e.g. rename,
  // navigation) without tripping over in-flight edits.
  useEffect(() => {
    if (titleRef.current && titleRef.current.textContent !== title) {
      titleRef.current.textContent = title;
    }
  }, [title]);

  // Refresh relative "updated N ago" every 60s
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // External rename trigger — when bumped, focus the title and select-all.
  useEffect(() => {
    if (!renameRequestKey) return;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [renameRequestKey]);

  const handleTitleBlur = useCallback(async (e: React.FocusEvent<HTMLHeadingElement>) => {
    const raw = (e.currentTarget.textContent ?? '').trim();
    if (raw === title) return;
    if (!raw) {
      e.currentTarget.textContent = title;
      onRenameError?.('Title cannot be empty');
      return;
    }
    const ok = await onRename(raw);
    if (!ok) {
      e.currentTarget.textContent = title;
    }
  }, [title, onRename, onRenameError]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLHeadingElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (titleRef.current) titleRef.current.textContent = title;
      (e.currentTarget as HTMLElement).blur();
    }
  }, [title]);

  const { tags, status } = useMemo(() => parseFrontmatter(content), [content]);

  const readMinutes = Math.max(1, Math.ceil(wordCount / 200));
  const updated = relativeTime(updatedAt);
  // bind tick so the relativeTime call re-runs every minute
  void tick;

  const visiblePresence = presenceUsers.slice(0, 4);
  const extraPresence = Math.max(0, presenceUsers.length - visiblePresence.length);

  return (
    <div className="kp-dochead">
      {visiblePresence.length > 0 && (
        <div className="kp-presence-gutter" aria-label="collaborators on this doc">
          {visiblePresence.map((u) => (
            <span
              key={u.userId}
              className="kp-presence-avatar"
              style={{ background: u.color, boxShadow: `0 0 0 2px ${u.color}` }}
              title={u.email}
            >
              {u.email[0]?.toUpperCase() ?? '?'}
            </span>
          ))}
          {extraPresence > 0 && (
            <span className="kp-presence-overflow" title={`${extraPresence} more`}>+{extraPresence}</span>
          )}
        </div>
      )}

      {(tags.length > 0 || status) && (
        <div className="kp-doc-tags">
          {tags.map((tag) => (
            <TagPill key={tag} tag={tag} onClick={onTagClick} />
          ))}
          {status && (
            <span className={`kp-tag kp-status-pill kp-status-${STATUS_STYLES[status] ?? 'draft'}`}>
              {status}
            </span>
          )}
        </div>
      )}

      <h1
        ref={titleRef}
        className="kp-doc-title"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={handleTitleBlur}
        onKeyDown={handleTitleKeyDown}
      >
        {title}
      </h1>

      <div className="kp-doc-meta">
        {authorEmail && (
          <span className="kp-doc-meta-item">
            <span
              className="kp-doc-meta-avatar"
              style={{ background: authorColor(authorEmail) }}
              aria-hidden
            >
              {authorEmail[0]?.toUpperCase() ?? '?'}
            </span>
            <span>{authorEmail.split('@')[0]}</span>
          </span>
        )}
        {updated && <span className="kp-doc-meta-item">Updated {updated}</span>}
        <span className="kp-doc-meta-item">
          {readMinutes} min read · {wordCount.toLocaleString()} word{wordCount === 1 ? '' : 's'}
        </span>
        {backlinkCount > 0 && (
          <span className="kp-doc-meta-item">
            {backlinkCount} backlink{backlinkCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
}

function authorColor(email: string): string {
  // Simple hash-to-hue for the small meta avatar so it stays stable per user
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 58%)`;
}
