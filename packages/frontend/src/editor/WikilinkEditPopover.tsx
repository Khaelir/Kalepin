import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { FileEntry } from '@kalepin/shared';
import { filterNotes, filterHeadings, flattenFiles } from './wikilink-autocomplete';
import type { WikilinkSuggestion, HeadingSuggestion } from './wikilink-autocomplete';
import { fetchHeadings, HeadingEntry } from '../api';

interface Props {
  editor: Editor;
  node: PMNode;
  getPos: () => number | undefined;
  anchorRect: DOMRect;
  onClose: () => void;
}

export function WikilinkEditPopover({ editor, node, getPos, anchorRect, onClose }: Props) {
  const [query, setQuery] = useState(node.attrs.target || '');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [headings, setHeadings] = useState<HeadingSuggestion[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const storage = (editor.storage as any).wikilink;
  const files: FileEntry[] = storage?.getFiles?.() ?? [];
  const allPaths = useMemo(() => flattenFiles(files), [files]);

  // Determine phase: note or heading
  const hashIdx = query.indexOf('#');
  const phase = hashIdx >= 0 ? 'heading' : 'note';
  const noteName = phase === 'heading' ? query.substring(0, hashIdx) : '';
  const headingQuery = phase === 'heading' ? query.substring(hashIdx + 1) : '';

  // Fetch headings when note name changes in heading phase
  useEffect(() => {
    if (phase !== 'heading') return;
    if (!noteName) {
      // Same-page headings
      const h: HeadingSuggestion[] = [];
      editor.state.doc.descendants((n) => {
        if (n.type.name === 'heading') {
          h.push({ text: n.textContent, level: n.attrs.level });
        }
      });
      setHeadings(h);
      return;
    }
    const q = noteName.toLowerCase();
    const resolved = allPaths.find(
      (p) => p.replace(/\.md$/, '').split('/').pop()?.toLowerCase() === q,
    );
    if (resolved) {
      fetchHeadings(resolved).then((entries: HeadingEntry[]) => {
        setHeadings(entries.map((e) => ({ text: e.text, level: e.level })));
      });
    }
  }, [phase, noteName, allPaths, editor]);

  const suggestions = phase === 'note'
    ? filterNotes(allPaths, query)
    : [];
  const filteredHeadings = phase === 'heading'
    ? filterHeadings(headings, headingQuery)
    : [];
  const items = phase === 'note' ? suggestions : filteredHeadings;

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Element)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const confirm = useCallback((newTarget: string) => {
    const pos = getPos();
    if (pos == null) { onClose(); return; }
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      target: newTarget,
    });
    editor.view.dispatch(tr);
    onClose();
    editor.view.focus();
  }, [editor, node, getPos, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      editor.view.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items.length > 0 && selectedIndex < items.length) {
        if (phase === 'note') {
          const note = suggestions[selectedIndex];
          confirm(note.label);
        } else {
          const heading = filteredHeadings[selectedIndex];
          confirm(`${noteName}#${heading.text}`);
        }
      } else if (query.trim()) {
        confirm(query.trim());
      }
      return;
    }
  };

  const handleSelect = (index: number) => {
    if (phase === 'note') {
      const note = suggestions[index];
      confirm(note.label);
    } else {
      const heading = filteredHeadings[index];
      confirm(`${noteName}#${heading.text}`);
    }
  };

  // Position below the anchor badge
  const top = anchorRect.bottom + 4;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={containerRef}
      className="wikilink-edit-popover"
      style={{ position: 'fixed', top, left, zIndex: 9999 }}
    >
      <input
        ref={inputRef}
        type="text"
        className="wikilink-edit-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Link target..."
      />
      {items.length > 0 && (
        <div className="wikilink-edit-suggestions">
          {phase === 'note'
            ? suggestions.map((s, i) => (
                <button
                  key={s.path}
                  className={`wikilink-edit-item${i === selectedIndex ? ' selected' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(i); }}
                >
                  <span className="wikilink-edit-item-label">{s.label}</span>
                  {s.dir && <span className="wikilink-edit-item-dir">{s.dir}</span>}
                </button>
              ))
            : filteredHeadings.map((h, i) => (
                <button
                  key={`${h.text}-${i}`}
                  className={`wikilink-edit-item${i === selectedIndex ? ' selected' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(i); }}
                >
                  <span className="wikilink-edit-item-heading-level">H{h.level}</span>
                  <span className="wikilink-edit-item-label">{h.text}</span>
                </button>
              ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
