import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '@kalepin/shared';
import { Icon } from '../Icon';
import { ENCRYPTED_FOLDER_LABEL } from '../../crypto/path-predicates';

export type CreateKind = 'note' | 'folder';

const PERSONAL_PREFIX = '_users/';
const SHARED_WITH_ME_ROOT = '_shared_with_me';

interface Props {
  kind: CreateKind;
  files: FileEntry[];
  /** Currently-suggested folder. Empty string = vault root. */
  defaultFolder: string;
  /** Lowercased email of the viewer; used to lift the personal subtree out of `_users/`. */
  currentUserEmail: string;
  anchorRef: React.RefObject<HTMLElement>;
  onConfirm: (folderPath: string) => void;
  onClose: () => void;
}

interface FolderRow {
  path: string;
  label: string;
  /** Display path: human-readable (no `_users/` prefix, `_secure` → "Encrypted Folder"). */
  display: string;
}

/** Strip the `_users/{email}/` wrapper and prettify `_secure` segments for display. */
function prettifyDisplay(path: string, currentUserEmail: string): string {
  const ownPrefix = `${PERSONAL_PREFIX}${currentUserEmail}`;
  let display = path;
  if (path === ownPrefix) {
    display = currentUserEmail;
  } else if (path.startsWith(`${ownPrefix}/`)) {
    display = `${currentUserEmail}/${path.slice(ownPrefix.length + 1)}`;
  }
  return display
    .replace(/\/_secure$/, `/${ENCRYPTED_FOLDER_LABEL}`)
    .replace(/\/_secure\//g, `/${ENCRYPTED_FOLDER_LABEL}/`);
}

function flattenFolders(
  entries: FileEntry[],
  currentUserEmail: string,
  out: FolderRow[] = [],
): FolderRow[] {
  for (const e of entries) {
    if (e.type !== 'directory') continue;
    if (e.name === '_attachments') continue;
    // Hide the bare `_users` wrapper and the `_shared_with_me` virtual root —
    // they are scaffolding, not real create destinations.
    if (e.path === '_users' || e.path === SHARED_WITH_ME_ROOT) {
      if (e.children) flattenFolders(e.children, currentUserEmail, out);
      continue;
    }
    // Defensively skip other users' personal subtrees if the API ever returns them.
    if (e.path.startsWith(PERSONAL_PREFIX)) {
      const ownerSegment = e.path.slice(PERSONAL_PREFIX.length).split('/')[0];
      if (currentUserEmail && ownerSegment !== currentUserEmail) continue;
    }
    out.push({
      path: e.path,
      label: e.name,
      display: prettifyDisplay(e.path, currentUserEmail),
    });
    if (e.children) flattenFolders(e.children, currentUserEmail, out);
  }
  return out;
}

export function CreatePopover({ kind, files, defaultFolder, currentUserEmail, anchorRef, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<string>(defaultFolder);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Anchor the popover under the trigger element.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const popoverWidth = 288;
    const left = Math.min(window.innerWidth - popoverWidth - 8, Math.max(8, r.left));
    setPos({ top: r.bottom + 6, left });
  }, [anchorRef]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Build the list: vault root first, then all folders.
  const allRows = useMemo<FolderRow[]>(() => {
    const root: FolderRow = { path: '', label: 'Vault root', display: 'Vault root' };
    return [root, ...flattenFolders(files, currentUserEmail)];
  }, [files, currentUserEmail]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      r.display.toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
    );
  }, [allRows, query]);

  // Keep highlightIdx within bounds when filtered changes.
  useEffect(() => {
    setHighlightIdx((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Close on outside click / Esc
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const selectedRow = allRows.find((r) => r.path === selected) ?? allRows[0];

  const handleListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[highlightIdx]?.path ?? selected;
      onConfirm(target ?? '');
    }
  };

  if (!pos) return null;

  return (
    <>
      <div className="kp-popover-overlay" onClick={onClose} />
      <div
        ref={popRef}
        className="kp-create-popover"
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-label={kind === 'note' ? 'Create new note' : 'Create new folder'}
      >
        <div className="kp-create-popover__head">
          <span>{kind === 'note' ? 'New note' : 'New folder'}</span>
        </div>
        <button
          type="button"
          className="kp-create-popover__chip"
          title={selectedRow?.path ? selectedRow.display : 'Vault root'}
          onClick={() => {
            setSelected('');
            setHighlightIdx(0);
            searchRef.current?.focus();
          }}
        >
          <Icon name={selectedRow?.path ? 'folder' : 'home'} size={14} />
          <span>{selectedRow?.display ?? 'Vault root'}</span>
          <Icon name="close" size={12} />
        </button>
        <div className="kp-create-popover__search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Find folder…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
            onKeyDown={handleListKey}
          />
        </div>
        <div ref={listRef} className="kp-create-popover__list" onKeyDown={handleListKey} tabIndex={-1}>
          {filtered.length === 0 ? (
            <div className="kp-create-popover__empty">No folders match "{query}"</div>
          ) : filtered.map((row, i) => {
            const isSelected = row.path === selected;
            const isHi = i === highlightIdx;
            return (
              <button
                key={row.path || '__root__'}
                type="button"
                className={`kp-create-popover__row${isSelected ? ' is-selected' : ''}${isHi ? ' is-highlight' : ''}`}
                onClick={() => { setSelected(row.path); setHighlightIdx(i); }}
                onDoubleClick={() => onConfirm(row.path)}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                <Icon name={row.path ? 'folder' : 'home'} size={14} />
                <span className="kp-create-popover__row-label">{row.display}</span>
                {isSelected && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>
        <div className="kp-create-popover__foot">
          <button type="button" className="kp-create-popover__cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="kp-create-popover__confirm"
            onClick={() => onConfirm(selected)}
          >
            Create {kind === 'note' ? 'note' : 'folder'}
          </button>
        </div>
      </div>
    </>
  );
}
