import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '@kalepin/shared';
import { Icon } from '../Icon';
import { ENCRYPTED_FOLDER_LABEL, isE2EEncrypted } from '../../crypto/path-predicates';
import { createSampleTemplate, listTemplates, type TemplateInfo, type TemplateList } from '../../api';
import { groupTemplates, todayNoteShortcutLabel } from '../../templates';

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
  /** Note mode: create from a template in `folderPath`. Enables "From template…". */
  onCreateFromTemplate?: (folderPath: string, templatePath: string, name: string | undefined) => void;
  /** Note mode: open (creating if needed) today's daily note. */
  onOpenTodayNote?: () => void;
}

type PopoverView = 'folders' | 'templates';

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

export function CreatePopover({
  kind,
  files,
  defaultFolder,
  currentUserEmail,
  anchorRef,
  onConfirm,
  onClose,
  onCreateFromTemplate,
  onOpenTodayNote,
}: Props) {
  const [selected, setSelected] = useState<string>(defaultFolder);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [view, setView] = useState<PopoverView>('folders');
  const [templateList, setTemplateList] = useState<TemplateList | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [creatingSample, setCreatingSample] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [templateHi, setTemplateHi] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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

  // `positioned` is in the deps because nothing renders until the anchor is measured.
  const positioned = pos !== null;
  useEffect(() => {
    if (view === 'folders') searchRef.current?.focus();
    else nameRef.current?.focus();
  }, [view, positioned]);

  // Templates are fetched when the template view opens, not for every create.
  const loadTemplates = useCallback(async () => {
    setTemplatesError(null);
    try {
      setTemplateList(await listTemplates());
    } catch {
      setTemplatesError("Couldn't load templates");
    }
  }, []);

  useEffect(() => {
    if (view === 'templates') void loadTemplates();
  }, [view, loadTemplates]);

  const templateGroups = useMemo(() => groupTemplates(templateList?.templates ?? []), [templateList]);
  const orderedTemplates = useMemo(
    () => [...templateGroups.shared, ...templateGroups.personal],
    [templateGroups],
  );

  useEffect(() => {
    setTemplateHi((i) => Math.min(Math.max(0, i), Math.max(0, orderedTemplates.length - 1)));
  }, [orderedTemplates.length]);

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

  // The server cannot render into end-to-end encrypted folders.
  const templatesBlocked = isE2EEncrypted(selected);
  const showNoteActions = kind === 'note' && (!!onCreateFromTemplate || !!onOpenTodayNote);

  const pickTemplate = (t: TemplateInfo) => {
    onCreateFromTemplate?.(selected, t.path, noteName.trim() || undefined);
  };

  const handleTemplateKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTemplateHi((i) => Math.min(orderedTemplates.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTemplateHi((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = orderedTemplates[templateHi];
      if (target) pickTemplate(target);
    }
  };

  const handleCreateSample = async () => {
    setCreatingSample(true);
    try {
      await createSampleTemplate();
      await loadTemplates();
    } catch (err) {
      setTemplatesError((err as Error).message || "Couldn't create the sample template");
    } finally {
      setCreatingSample(false);
    }
  };

  if (!pos) return null;

  if (view === 'templates') {
    const folderName = templateList?.folder ?? 'Templates';
    const renderGroup = (label: string, items: TemplateInfo[], offset: number) => items.length > 0 && (
      <div className="kp-template-group" role="group" aria-label={label}>
        <div className="kp-template-group__label">{label}</div>
        {items.map((t, j) => {
          const i = offset + j;
          return (
            <button
              key={t.path}
              type="button"
              className={`kp-create-popover__row kp-template-row${i === templateHi ? ' is-highlight' : ''}`}
              title={t.path}
              onClick={() => pickTemplate(t)}
              onMouseEnter={() => setTemplateHi(i)}
            >
              <Icon name="description" size={14} />
              <span className="kp-create-popover__row-label">{t.name}</span>
            </button>
          );
        })}
      </div>
    );

    return (
      <>
        <div className="kp-popover-overlay" onClick={onClose} />
        <div
          ref={popRef}
          className="kp-create-popover"
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label="New note from template"
        >
          <div className="kp-create-popover__head kp-template-head">
            <button
              type="button"
              className="kp-template-back"
              aria-label="Back to folders"
              onClick={() => setView('folders')}
            >
              <Icon name="arrow_back" size={14} />
            </button>
            <span>New from template</span>
          </div>
          <button
            type="button"
            className="kp-create-popover__chip"
            title="Change folder"
            onClick={() => setView('folders')}
          >
            <Icon name={selectedRow?.path ? 'folder' : 'home'} size={14} />
            <span>{selectedRow?.display ?? 'Vault root'}</span>
          </button>
          <div className="kp-create-popover__search">
            <Icon name="edit" size={14} />
            <input
              ref={nameRef}
              type="text"
              className="kp-template-name"
              placeholder="Note name (optional)"
              aria-label="Note name"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              onKeyDown={handleTemplateKey}
            />
          </div>
          <div className="kp-create-popover__list kp-template-list" onKeyDown={handleTemplateKey} tabIndex={-1}>
            {templatesError ? (
              <div className="kp-create-popover__empty">{templatesError}</div>
            ) : !templateList ? (
              <div className="kp-create-popover__empty">Loading templates…</div>
            ) : orderedTemplates.length === 0 ? (
              <div className="kp-template-empty">
                <p>Add notes to a {folderName} folder to use them here.</p>
                <button
                  type="button"
                  className="kp-template-empty__action"
                  disabled={creatingSample}
                  onClick={() => { void handleCreateSample(); }}
                >
                  <Icon name="note_add" size={14} />
                  <span>{creatingSample ? 'Creating…' : 'Create a sample template'}</span>
                </button>
              </div>
            ) : (
              <>
                {renderGroup('Shared', templateGroups.shared, 0)}
                {renderGroup('Personal', templateGroups.personal, templateGroups.shared.length)}
              </>
            )}
          </div>
          <div className="kp-create-popover__foot">
            <button type="button" className="kp-create-popover__cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </>
    );
  }

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
        {showNoteActions && (
          <div className="kp-template-actions">
            {onCreateFromTemplate && (
              <button
                type="button"
                className="kp-template-action"
                data-action="from-template"
                disabled={templatesBlocked}
                title={templatesBlocked ? `Templates aren't available in the ${ENCRYPTED_FOLDER_LABEL}` : 'Create the note from a template'}
                onClick={() => { setTemplateHi(0); setView('templates'); }}
              >
                <Icon name="description" size={14} />
                <span>From template…</span>
              </button>
            )}
            {onOpenTodayNote && (
              <button
                type="button"
                className="kp-template-action"
                data-action="today-note"
                title="Open today's daily note"
                onClick={onOpenTodayNote}
              >
                <Icon name="today" size={14} />
                <span>Today's note</span>
                <kbd className="kp-kbd">{todayNoteShortcutLabel()}</kbd>
              </button>
            )}
          </div>
        )}
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
