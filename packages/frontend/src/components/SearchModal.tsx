import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { searchNotes, getRecentlyEdited, type SearchResult, type RecentlyEditedItem } from '../api';
import { formatRelativeTime } from '../utils/recent-files';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function editorName(displayName: string | null, email: string | null): string {
  if (displayName && displayName.trim()) return displayName.trim();
  if (!email) return 'Unknown';
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function colorForEmail(email: string | null): string {
  if (!email) return 'var(--kalepin-text-light)';
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 55%)`;
}

type Bucket = 'today' | 'yesterday' | 'week' | 'earlier';

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  earlier: 'Earlier',
};

// FTS5 emits snippets with literal `<mark>...</mark>` markers around matched
// terms (see backend search.service.ts). We split on those markers and render
// each piece as React text — React escapes children, so any HTML in the note
// content (`<img onerror=...>`, `<script>`, etc.) is rendered as a literal
// string rather than executed.
function Snippet({ text }: { text: string }): React.ReactElement {
  const parts = text.split(/(<mark>|<\/mark>)/g);
  let inMark = false;
  return (
    <>
      {parts.map((part, i) => {
        if (part === '<mark>') {
          inMark = true;
          return null;
        }
        if (part === '</mark>') {
          inMark = false;
          return null;
        }
        return inMark ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>;
      })}
    </>
  );
}

function bucketOf(modifiedAt: number, now: number): Bucket {
  const d = new Date(modifiedAt);
  const n = new Date(now);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(n) - startOfDay(d)) / 86_400_000);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  const dow = (n.getDay() + 6) % 7; // Monday = 0
  if (dayDiff <= dow) return 'week';
  return 'earlier';
}

interface SearchModalProps {
  onSelect: (path: string, heading?: string, threadId?: string) => void;
  onClose: () => void;
}

export function SearchModal({ onSelect, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentEdits, setRecentEdits] = useState<RecentlyEditedItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);

  const isEmpty = !query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Recently-edited fetch (once on mount; cheap, server limits to 200).
  useEffect(() => {
    let cancelled = false;
    getRecentlyEdited()
      .then((items) => {
        if (!cancelled) setRecentEdits(items);
      })
      .catch(() => {
        /* silent — empty state will just be blank */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced search with stale-request guard
  useEffect(() => {
    if (isEmpty) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      setSelected(0);
      return;
    }

    setLoading(true);
    const id = ++counterRef.current;
    const timer = setTimeout(async () => {
      try {
        const data = await searchNotes(query);
        if (id === counterRef.current) {
          setResults(data.filter((r) => !r.path.includes('_attachments')));
          setSelected(0);
          setSearched(true);
          setLoading(false);
        }
      } catch {
        if (id === counterRef.current) {
          setResults([]);
          setSearched(true);
          setLoading(false);
        }
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isEmpty]);

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const formatPath = (path: string) => {
    const parts = path.replace(/\.md$/, '').split('/');
    const name = parts.pop()!;
    const dir = parts.join('/');
    return { name, dir };
  };

  const openResult = useCallback(
    (r: SearchResult) => {
      const isComment = r.type === 'comment';
      onSelect(
        r.path,
        r.heading ? slugify(r.heading) : undefined,
        isComment ? r.threadId : undefined,
      );
      onClose();
    },
    [onSelect, onClose],
  );

  const openPath = useCallback(
    (path: string) => {
      onSelect(path);
      onClose();
    },
    [onSelect, onClose],
  );

  // Empty-state buckets
  const now = useMemo(() => Date.now(), []);
  const bucketed = useMemo(() => {
    const map: Record<Bucket, RecentlyEditedItem[]> = {
      today: [],
      yesterday: [],
      week: [],
      earlier: [],
    };
    for (const item of recentEdits) {
      const ts = new Date(item.modifiedAt).getTime();
      map[bucketOf(ts, now)].push(item);
    }
    const order: Bucket[] = ['today', 'yesterday', 'week', 'earlier'];
    return order
      .map((bucket) => ({ bucket, items: map[bucket] }))
      .filter((g) => g.items.length > 0);
  }, [recentEdits, now]);

  const flatEmpty = useMemo(
    () => bucketed.flatMap((g) => g.items),
    [bucketed],
  );

  const collaboratorCount = useMemo(() => {
    const ids = new Set<string>();
    for (const e of recentEdits) ids.add(String(e.editorId ?? e.editorEmail ?? ''));
    ids.delete('');
    return ids.size;
  }, [recentEdits]);

  // Group results by type (query mode) — falls back to "Notes" for uncategorised hits
  const grouped = useMemo(() => {
    const groups: { label: string; items: SearchResult[] }[] = [];
    const byKey = new Map<string, SearchResult[]>();
    for (const r of results) {
      const key = r.type === 'comment' ? 'Comments' : 'Notes';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    for (const key of ['Notes', 'Comments']) {
      const items = byKey.get(key);
      if (items && items.length) groups.push({ label: key, items });
    }
    return groups;
  }, [results]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const list = isEmpty ? flatEmpty : results;
      if (list.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => (s + 1) % list.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => (s - 1 + list.length) % list.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isEmpty) {
          const item = flatEmpty[selected];
          if (item) openPath(item.path);
        } else {
          const r = results[selected];
          if (r) openResult(r);
        }
      }
    },
    [isEmpty, flatEmpty, results, selected, openPath, openResult, onClose],
  );

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-input-wrap">
          <svg className="search-modal-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Search your vault — content, titles, comments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="search-modal-spinner" />}
        </div>

        <div className="search-modal-results" ref={listRef}>
          {isEmpty ? (
            bucketed.length === 0 ? (
              <div className="search-modal-empty">No recent activity yet</div>
            ) : (
              <>
                {bucketed.map((group) => (
                  <React.Fragment key={group.bucket}>
                    <div className="search-modal-group-title">{BUCKET_LABEL[group.bucket]}</div>
                    {group.items.map((item) => {
                      const idx = flatEmpty.indexOf(item);
                      const { name, dir } = formatPath(item.path);
                      const ts = new Date(item.modifiedAt).getTime();
                      return (
                        <button
                          key={`recent::${item.path}`}
                          data-idx={idx}
                          className={`search-modal-result search-modal-result--recent${idx === selected ? ' selected' : ''}`}
                          onClick={() => openPath(item.path)}
                          onMouseEnter={() => setSelected(idx)}
                        >
                          <span className="search-modal-result-icon">
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 2h7l3 3v9H3z" />
                              <path d="M10 2v3h3" />
                            </svg>
                          </span>
                          <div className="search-modal-result-body">
                            <div className="search-modal-result-title">
                              <span className="search-modal-result-name">{item.name || name}</span>
                              {dir && <span className="search-modal-result-dir kp-mono">{dir}</span>}
                            </div>
                          </div>
                          <div className="search-modal-result-meta search-modal-recent-meta">
                            <span
                              className="search-modal-recent-avatar"
                              style={{ background: colorForEmail(item.editorEmail) }}
                              title={item.editorEmail ?? 'Unknown'}
                              aria-hidden
                            >
                              {(item.editorEmail?.[0] ?? '?').toUpperCase()}
                            </span>
                            <span className="search-modal-recent-editor">{editorName(item.editorDisplayName, item.editorEmail)}</span>
                            <span className="search-modal-recent-time">{formatRelativeTime(ts)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </>
            )
          ) : (
            <>
              {grouped.map((group) => (
                <React.Fragment key={group.label}>
                  <div className="search-modal-group-title">{group.label}</div>
                  {group.items.map((r) => {
                    const idx = results.indexOf(r);
                    const { name, dir } = formatPath(r.path);
                    const isComment = r.type === 'comment';
                    return (
                      <button
                        key={isComment ? `${r.path}::${r.threadId}` : `${r.path}::${idx}`}
                        data-idx={idx}
                        className={`search-modal-result${isComment ? ' search-modal-result--comment' : ''}${idx === selected ? ' selected' : ''}`}
                        onClick={() => openResult(r)}
                        onMouseEnter={() => setSelected(idx)}
                      >
                        <span className="search-modal-result-icon">
                          {isComment ? (
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 3h12v8H5l-3 3V3z" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 2h7l3 3v9H3z" />
                              <path d="M10 2v3h3" />
                            </svg>
                          )}
                        </span>
                        <div className="search-modal-result-body">
                          <div className="search-modal-result-title">
                            <span className="search-modal-result-name">{name}</span>
                            {dir && <span className="search-modal-result-dir">{dir}</span>}
                            {isComment && r.commentAuthor && (
                              <span className="search-modal-result-author">{r.commentAuthor}</span>
                            )}
                          </div>
                          {r.snippet && (
                            <div className="search-modal-result-snippet">
                              <Snippet text={r.snippet} />
                            </div>
                          )}
                        </div>
                        <div className="search-modal-result-meta">
                          {typeof r.score === 'number' && !Number.isNaN(r.score) && (
                            <span className="search-modal-score" title="Relevance score">
                              {Math.round(Math.max(0, Math.min(r.score, 1)) * 100)}
                            </span>
                          )}
                          <svg className="search-modal-result-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3l5 5-5 5" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
              {searched && results.length === 0 && (
                <div className="search-modal-empty">No results found</div>
              )}
            </>
          )}
        </div>

        <div className="search-modal-footer">
          {isEmpty ? (
            <span className="search-modal-foot-item">
              {recentEdits.length} edit{recentEdits.length === 1 ? '' : 's'} across {collaboratorCount} collaborator{collaboratorCount === 1 ? '' : 's'}
            </span>
          ) : (
            <>
              <span className="search-modal-foot-item"><kbd className="kp-kbd">↑</kbd><kbd className="kp-kbd">↓</kbd> Navigate</span>
              <span className="search-modal-foot-item"><kbd className="kp-kbd">↵</kbd> Open</span>
              <span className="search-modal-foot-item"><kbd className="kp-kbd">esc</kbd> Close</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
