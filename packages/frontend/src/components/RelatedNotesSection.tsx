import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import type { RelatedNote } from '../api';
import { isE2EEncrypted, prettifyPath } from '../crypto/path-predicates';
import {
  RELATED_REFRESH_DELAY_MS,
  readRelatedOpen,
  relatedFolderLabel,
  relatedReasonLabel,
  writeRelatedOpen,
} from './related-notes';

type Status = 'loading' | 'ready' | 'unavailable' | 'encrypted' | 'error';

interface RelatedNotesSectionProps {
  activeFile: string;
  /** Revision of the open note; a change schedules a debounced refetch. */
  revision?: number;
  onNavigate: (path: string) => void;
  /** Appends a wikilink to the open note; omitted when the note is read-only. */
  onInsertLink?: (path: string) => boolean;
}

export function RelatedNotesSection({ activeFile, revision, onNavigate, onInsertLink }: RelatedNotesSectionProps) {
  const [items, setItems] = useState<RelatedNote[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [open, setOpen] = useState(readRelatedOpen);
  // Only the latest request may update state (note switches race refreshes).
  const requestRef = useRef(0);
  const skipRevisionRef = useRef(true);

  const load = useCallback(async (path: string, background: boolean) => {
    const request = ++requestRef.current;
    if (!background) setStatus('loading');
    try {
      const res = await api.fetchRelatedNotes(path);
      if (request !== requestRef.current) return;
      setItems(res.items);
      setStatus(res.available ? 'ready' : 'unavailable');
    } catch {
      if (request !== requestRef.current) return;
      // A failed background refresh keeps the list it already shows.
      if (!background) {
        setItems([]);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    skipRevisionRef.current = true;
    setItems([]);
    if (isE2EEncrypted(activeFile)) {
      requestRef.current++;
      setStatus('encrypted');
      return;
    }
    void load(activeFile, false);
  }, [activeFile, load]);

  // Embeddings are recomputed asynchronously after edits (and only once the
  // editor has been idle for a while), so refresh well after the last change.
  useEffect(() => {
    if (skipRevisionRef.current) {
      skipRevisionRef.current = false;
      return;
    }
    if (revision === undefined || isE2EEncrypted(activeFile)) return;
    const timer = setTimeout(() => void load(activeFile, true), RELATED_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeFile, revision, load]);

  const handleInsertLink = (e: React.MouseEvent, item: RelatedNote) => {
    e.stopPropagation();
    if (!onInsertLink?.(item.path)) return;
    setItems((prev) => prev.map((i) => (i.path === item.path ? { ...i, linked: true } : i)));
  };

  let body: React.ReactNode;
  if (status === 'loading') {
    body = <p className="backlinks-empty">Loading...</p>;
  } else if (status === 'encrypted') {
    body = <p className="backlinks-empty">Not available for encrypted notes.</p>;
  } else if (status === 'unavailable') {
    body = (
      <p className="backlinks-empty" data-testid="related-unavailable">
        Related notes need the semantic index, which isn't available right now.
      </p>
    );
  } else if (status === 'error') {
    body = <p className="backlinks-empty">Couldn't load related notes.</p>;
  } else if (items.length === 0) {
    body = <p className="backlinks-empty" data-testid="related-empty">No related notes found</p>;
  } else {
    body = (
      <div className="backlinks-list">
        {items.map((item) => {
          const folder = relatedFolderLabel(item.path);
          const why = relatedReasonLabel(item.reason);
          return (
            <div
              key={item.path}
              className="backlink-entry related-entry"
              data-testid="related-entry"
              data-path={item.path}
              role="button"
              tabIndex={0}
              title={prettifyPath(item.path)}
              onClick={() => onNavigate(item.path)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate(item.path);
                }
              }}
            >
              <div className="backlink-entry-header">
                <div className="backlink-title">{item.title}</div>
                {!item.linked && (
                  <div className="related-entry-actions">
                    <span className="related-chip" data-testid="related-not-linked">not linked</span>
                    {onInsertLink && (
                      <button
                        type="button"
                        className="backlink-link-btn"
                        data-testid="related-insert-link"
                        onClick={(e) => handleInsertLink(e, item)}
                        title="Append a link to this note"
                      >
                        Link
                      </button>
                    )}
                  </div>
                )}
              </div>
              {folder && <div className="related-folder">{folder}</div>}
              {why && <div className="backlink-context related-reason">{why}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <details
      className="backlinks-section related-section"
      data-testid="related-section"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        writeRelatedOpen(next);
      }}
    >
      <summary className="backlinks-section-header">
        Related {status === 'ready' && <span className="backlinks-count">{items.length}</span>}
      </summary>
      {body}
    </details>
  );
}
