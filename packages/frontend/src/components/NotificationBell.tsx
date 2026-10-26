import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { InboxNotification } from '../api';
import {
  describeNotification,
  formatBadgeCount,
  formatRelativeTime,
  mergeFirstPage,
  notificationSentence,
} from './notification-format';

const PAGE_SIZE = 20;

interface Props {
  /** Bumped by the host when the server says this user's inbox changed. */
  refreshKey: number;
  /** Navigate to the item's note (and thread). Called after it is marked read. */
  onOpen: (item: InboxNotification) => void;
}

export function NotificationBell({ refreshKey, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Bumps when a fresh (replace) load settles; drives focus-on-open. */
  const [loadSeq, setLoadSeq] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnLoadRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const refreshCount = useCallback(() => {
    api.getUnreadNotificationCount().then(setCount).catch(() => { /* keep the last count */ });
  }, []);

  const loadFirstPage = useCallback(async (mode: 'replace' | 'merge') => {
    if (mode === 'replace') setLoading(true);
    try {
      const page = await api.listNotifications({ limit: PAGE_SIZE });
      setFailed(false);
      if (mode === 'replace') {
        setItems(page.items);
        setNextBefore(page.nextBefore);
      } else {
        setItems((prev) => (prev ? mergeFirstPage(prev, page.items) : page.items));
      }
    } catch {
      if (mode === 'replace') setFailed(true);
    } finally {
      if (mode === 'replace') {
        setLoading(false);
        setLoadSeq((n) => n + 1);
      }
    }
  }, []);

  // Unread count: on mount, whenever the server nudges, and on window focus.
  useEffect(() => {
    refreshCount();
    if (openRef.current) void loadFirstPage('merge');
  }, [refreshKey, refreshCount, loadFirstPage]);

  useEffect(() => {
    window.addEventListener('focus', refreshCount);
    return () => window.removeEventListener('focus', refreshCount);
  }, [refreshCount]);

  // Opening loads a fresh list and moves focus into it.
  useEffect(() => {
    if (!open) return;
    focusOnLoadRef.current = true;
    void loadFirstPage('replace');
  }, [open, loadFirstPage]);

  useEffect(() => {
    if (!openRef.current || !focusOnLoadRef.current) return;
    focusOnLoadRef.current = false;
    const first = listRef.current?.querySelector<HTMLButtonElement>('[data-inbox-item]');
    (first ?? panelRef.current)?.focus();
  }, [loadSeq]);

  // Close on outside click and Escape, like the other top-bar popovers.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase + stopPropagation: while the inbox is open, Escape is
    // ours (the editor's selection bubble would otherwise refocus the editor).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const markReadLocally = (id: number) => {
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)) ?? prev);
    setCount((c) => Math.max(0, c - 1));
  };

  const handleSelect = (n: InboxNotification) => {
    if (n.readAt === null) {
      markReadLocally(n.id);
      api.markNotificationRead(n.id).catch(() => refreshCount());
    }
    // Unavailable notes stay in the list (greyed); there is nothing to open.
    if (!n.available) return;
    setOpen(false);
    onOpen(n);
  };

  const handleMarkAll = () => {
    const now = Date.now();
    setItems((prev) => prev?.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)) ?? prev);
    setCount(0);
    api.markAllNotificationsRead().catch(() => refreshCount());
  };

  const handleLoadMore = async () => {
    if (nextBefore === null) return;
    try {
      const page = await api.listNotifications({ limit: PAGE_SIZE, before: nextBefore });
      setItems((prev) => [...(prev ?? []), ...page.items.filter((n) => !prev?.some((p) => p.id === n.id))]);
      setNextBefore(page.nextBefore);
    } catch {
      /* leave the button for a retry */
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-inbox-item]') ?? []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(idx + 1, buttons.length - 1);
    else if (e.key === 'ArrowUp') next = idx <= 0 ? 0 : idx - 1;
    else if (e.key === 'End') next = buttons.length - 1;
    buttons[next].focus();
  };

  const hasUnread = count > 0 || (items?.some((n) => n.readAt === null) ?? false);
  const badge = formatBadgeCount(count);
  const now = Date.now();

  return (
    <div ref={rootRef} className="kp-inbox">
      <button
        ref={buttonRef}
        type="button"
        className={`kp-iconbtn kp-inbox-btn${open ? ' is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'kp-inbox-panel' : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1.25 4.5 1.75 5H2.25C2.75 11 4 9.5 4 6.5z" />
          <path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" />
        </svg>
        {badge && <span className="kp-iconbtn-badge kp-inbox-badge" aria-hidden="true">{badge}</span>}
      </button>

      {open && (
        <div ref={panelRef} id="kp-inbox-panel" className="kp-inbox-panel" role="dialog" aria-label="Notifications" tabIndex={-1}>
          <div className="kp-inbox-header">
            <span className="kp-inbox-title">Notifications</span>
            <button
              type="button"
              className="kp-inbox-markall"
              onClick={handleMarkAll}
              disabled={!hasUnread}
            >
              Mark all as read
            </button>
          </div>

          {loading && items === null ? (
            <div className="kp-inbox-empty">Loading…</div>
          ) : failed && !items?.length ? (
            <div className="kp-inbox-empty">Couldn't load notifications.</div>
          ) : !items || items.length === 0 ? (
            <div className="kp-inbox-empty">
              <span className="kp-inbox-empty-title">You're all caught up</span>
              <span>Mentions, replies and shares will show up here.</span>
            </div>
          ) : (
            <ul ref={listRef} className="kp-inbox-list" onKeyDown={onListKeyDown}>
              {items.map((n) => {
                const d = describeNotification(n);
                const unread = n.readAt === null;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-inbox-item
                      className={`kp-inbox-item${unread ? ' is-unread' : ''}${n.available ? '' : ' is-unavailable'}`}
                      onClick={() => handleSelect(n)}
                      aria-label={`${unread ? 'Unread: ' : ''}${notificationSentence(n)}${n.available ? '' : ' (no longer available)'}`}
                      title={n.available ? n.path : 'This note is no longer available'}
                    >
                      <span className="kp-inbox-dot" aria-hidden="true" />
                      <span className="kp-inbox-item-body">
                        <span className="kp-inbox-item-line">
                          <strong>{d.actor}</strong> {d.lead} <span className="kp-inbox-item-note">{d.note}</span>
                          {d.tail ? ` ${d.tail}` : ''}
                        </span>
                        {n.snippet && <span className="kp-inbox-item-snippet">{n.snippet}</span>}
                        <span className="kp-inbox-item-meta">
                          <time dateTime={new Date(n.createdAt).toISOString()}>{formatRelativeTime(n.createdAt, now)}</time>
                          {!n.available && ' · no longer available'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {nextBefore !== null && items && items.length > 0 && (
            <button type="button" className="kp-inbox-more" onClick={handleLoadMore}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
