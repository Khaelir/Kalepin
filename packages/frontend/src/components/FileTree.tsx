import React, { useState, useRef, useCallback, useEffect, DragEvent } from 'react';
import type { FileEntry } from '@kalepin/shared';
import { isE2EEncrypted, ENCRYPTED_FOLDER_LABEL } from '../crypto/path-predicates';
import { SECURE_FOLDER_ENABLED } from '../feature-flags';
import type { StarredItem } from '../api';
import { Icon } from './Icon';

export const PERSONAL_PREFIX = '_users/';
export const SHARED_WITH_ME_ROOT = '_shared_with_me';

/** True if path is exactly `_users/{email}` (no trailing slash, no further segments). */
export function isPersonalRootSegment(p: string): boolean {
  if (!p.startsWith(PERSONAL_PREFIX)) return false;
  const rest = p.slice(PERSONAL_PREFIX.length);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Split the top-level entries returned by /api/files/tree into:
 *  - the requester's own personal subtree (lifted from the `_users` wrapper),
 *  - the `_shared_with_me` virtual root (one node, grouped by grantor), and
 *  - the shared vault roots.
 *
 * Each output is null/empty when the corresponding section has no data.
 */
export function partitionTree(files: FileEntry[]): {
  personalRoot: FileEntry | null;
  sharedWithMeRoot: FileEntry | null;
  sharedFiles: FileEntry[];
} {
  let personalRoot: FileEntry | null = null;
  let sharedWithMeRoot: FileEntry | null = null;
  const sharedFiles: FileEntry[] = [];
  for (const entry of files) {
    if (entry.path === '_users' && entry.children && entry.children.length > 0) {
      personalRoot = entry.children[0];
    } else if (entry.path === SHARED_WITH_ME_ROOT) {
      sharedWithMeRoot = entry;
    } else if (
      !entry.path.startsWith(PERSONAL_PREFIX)
      && entry.path !== '_users'
      && entry.path !== SHARED_WITH_ME_ROOT
    ) {
      sharedFiles.push(entry);
    }
  }
  return { personalRoot, sharedWithMeRoot, sharedFiles };
}

interface FileTreeProps {
  files: FileEntry[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onMove: (src: string, dest: string) => void;
  onRename: (entry: FileEntry, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry | null) => void;
  searchQuery: string;
  stars?: StarredItem[];
  onToggleStar?: (type: 'file' | 'folder', path: string) => void;
  /** Inline create-from-folder affordances. */
  onCreateInFolder?: (kind: 'note' | 'folder', folderPath: string) => void;
  /** Lowercased canonical email of the viewer; used to identify the personal root. */
  currentUserEmail?: string;
  /** Toast for client-side drop-rejection (defense-in-depth — backend rejects too). */
  onToast?: (message: string, kind?: 'info' | 'error') => void;
  /** Which slice of the tree to render. Defaults to 'both' for back-compat. */
  section?: 'personal' | 'shared' | 'shared-with-me' | 'both';
  /** Fired when the viewer clicks the Encrypted Folder under their personal root. */
  onSecureFolderActivate?: () => void;
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onMove: (src: string, dest: string) => void;
  onRename: (entry: FileEntry, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  searchQuery: string;
  stars?: StarredItem[];
  onToggleStar?: (type: 'file' | 'folder', path: string) => void;
  onCreateInFolder?: (kind: 'note' | 'folder', folderPath: string) => void;
  /** Render this node as the locked personal root: hide drag, rename, star; show lock; relabel. */
  personalRoot?: { label: string };
  currentUserEmail?: string;
  onToast?: (message: string, kind?: 'info' | 'error') => void;
  onSecureFolderActivate?: () => void;
}

function matchesSearch(entry: FileEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.children) {
    return entry.children.some((child) => matchesSearch(child, q));
  }
  return false;
}

function FileTreeNode({ entry, depth, activeFile, onFileSelect, onMove, onRename, onContextMenu, searchQuery, stars, onToggleStar, onCreateInFolder, personalRoot, currentUserEmail, onToast, onSecureFolderActivate }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.name);
  const didDrag = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Select name without extension for files
      const dotIdx = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
      if (dotIdx > 0) {
        inputRef.current.setSelectionRange(0, dotIdx);
      } else {
        inputRef.current.select();
      }
    }
  }, [editing]);

  if (entry.name === '_attachments') return null;
  if (!matchesSearch(entry, searchQuery)) return null;

  const handleDragStart = (e: DragEvent) => {
    if (editing || personalRoot) { e.preventDefault(); return; }
    didDrag.current = true;
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const srcPath = e.dataTransfer.getData('text/plain');
    if (!srcPath || srcPath === entry.path || entry.type !== 'directory') return;
    // Reject drops onto another user's personal root or any path inside it.
    if (entry.path.startsWith(PERSONAL_PREFIX)) {
      const ownerSegment = entry.path.slice(PERSONAL_PREFIX.length).split('/')[0];
      if (currentUserEmail && ownerSegment.toLowerCase() !== currentUserEmail.toLowerCase()) {
        onToast?.("You can't move files into another user's personal folder", 'error');
        return;
      }
    }
    const fileName = srcPath.split('/').pop()!;
    onMove(srcPath, `${entry.path}/${fileName}`);
  };

  const handleDragOver = (e: DragEvent) => {
    if (entry.type === 'directory') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleClick = () => {
    if (editing) return;
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    if (isDir) {
      if (isSecureRoot && onSecureFolderActivate) {
        onSecureFolderActivate();
      }
      setExpanded(!expanded);
    } else {
      onFileSelect(entry.path);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (personalRoot) return;
    e.stopPropagation();
    setEditValue(entry.name);
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== entry.name) {
      onRename(entry, trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const isDir = entry.type === 'directory';
  const isActive = entry.path === activeFile;
  const iconName = personalRoot
    ? (expanded ? 'folder_open' : 'folder')
    : isDir ? (expanded ? 'folder_open' : 'folder') : 'description';

  // Star state
  const starType = isDir ? 'folder' : 'file';
  const starPath = isDir ? entry.path + '/' : entry.path;
  const isStarred = stars?.some((s) => s.type === starType && s.path === starPath);

  const isSecureRoot = entry.name === '_secure' && entry.type === 'directory' && isE2EEncrypted(entry.path);
  const displayName = personalRoot
    ? personalRoot.label
    : isSecureRoot
      ? ENCRYPTED_FOLDER_LABEL
      : entry.name;

  return (
    <div>
      <div
        className={`file-tree-node ${isActive ? 'active' : ''} ${personalRoot ? 'personal-root' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, entry); }}
        draggable={!editing && !personalRoot}
        onDragStart={handleDragStart}
        onDragEnd={() => { didDrag.current = false; }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <Icon
          name={iconName}
          size={16}
          fill={isDir}
          className="file-icon"
          style={isDir ? { color: 'var(--luce-primary)' } : undefined}
        />
        {editing ? (
          <input
            ref={inputRef}
            className="file-rename-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="file-name">{displayName}</span>
        )}
        {personalRoot && (
          <Icon
            name="lock"
            size={12}
            className="personal-lock-icon"
            title="Only you can see this folder"
          />
        )}
        {!personalRoot && isE2EEncrypted(entry.path) && (
          <Icon
            name="encrypted"
            size={14}
            className="e2e-lock-badge"
            title="End-to-end encrypted — only your passphrase can unlock the contents"
          />
        )}
        {!personalRoot && onToggleStar && (
          <button
            className={`file-star-btn ${isStarred ? 'starred' : ''}`}
            title={isStarred ? 'Unstar' : 'Star for priority notifications'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(starType, starPath);
            }}
          >
            {isStarred ? '★' : '☆'}
          </button>
        )}
        {isDir && onCreateInFolder && (
          <span className="file-tree-folder-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="file-tree-folder-action"
              title={`New note in ${displayName}`}
              aria-label={`New note in ${displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                onCreateInFolder('note', entry.path);
              }}
            >
              <Icon name="note_add" size={14} />
            </button>
            <button
              type="button"
              className="file-tree-folder-action"
              title={`New folder in ${displayName}`}
              aria-label={`New folder in ${displayName}`}
              onClick={(e) => {
                e.stopPropagation();
                onCreateInFolder('folder', entry.path);
              }}
            >
              <Icon name="create_new_folder" size={14} />
            </button>
          </span>
        )}
      </div>
      {isDir && expanded && entry.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onMove={onMove}
          onRename={onRename}
          onContextMenu={onContextMenu}
          searchQuery={searchQuery}
          stars={stars}
          onToggleStar={onToggleStar}
          onCreateInFolder={onCreateInFolder}
          currentUserEmail={currentUserEmail}
          onToast={onToast}
          onSecureFolderActivate={onSecureFolderActivate}
        />
      ))}
    </div>
  );
}

export function FileTree({ files, activeFile, onFileSelect, onMove, onRename, onContextMenu, searchQuery, stars, onToggleStar, onCreateInFolder, currentUserEmail, onToast, section = 'both', onSecureFolderActivate }: FileTreeProps) {
  const { personalRoot, sharedWithMeRoot, sharedFiles } = partitionTree(files);
  // Always surface an Encrypted Folder placeholder under the viewer's personal
  // root, even before the on-disk folder exists. The click handler in App.tsx
  // walks the user through setup or unlock. Gated by SECURE_FOLDER_ENABLED:
  // when off, any physical `_secure/` left over from earlier testing is also
  // hidden so the unfinished feature isn't exposed to end users.
  const personalRootWithPlaceholder = (() => {
    if (!personalRoot) return personalRoot;
    const securePath = `${personalRoot.path}/_secure`;
    if (!SECURE_FOLDER_ENABLED) {
      const filtered = (personalRoot.children ?? []).filter((c) => c.path !== securePath);
      if (filtered.length === (personalRoot.children?.length ?? 0)) return personalRoot;
      return { ...personalRoot, children: filtered };
    }
    const hasSecure = personalRoot.children?.some((c) => c.path === securePath);
    if (hasSecure) return personalRoot;
    const placeholder: FileEntry = {
      name: '_secure',
      path: securePath,
      type: 'directory',
      children: [],
    };
    return { ...personalRoot, children: [...(personalRoot.children ?? []), placeholder] };
  })();
  const showPersonal = (section === 'both' || section === 'personal') && !!personalRootWithPlaceholder;
  const showShared = section === 'both' || section === 'shared';
  const showSharedWithMe = (section === 'both' || section === 'shared-with-me') && !!sharedWithMeRoot;

  return (
    <div
      className="file-tree"
      data-section={section}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, null);
      }}
    >
      {showPersonal && personalRootWithPlaceholder && (
        <FileTreeNode
          key={personalRootWithPlaceholder.path}
          entry={personalRootWithPlaceholder}
          depth={0}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onMove={onMove}
          onRename={onRename}
          onContextMenu={onContextMenu}
          searchQuery={searchQuery}
          stars={stars}
          onToggleStar={onToggleStar}
          onCreateInFolder={onCreateInFolder}
          personalRoot={{ label: personalRootWithPlaceholder.name }}
          currentUserEmail={currentUserEmail}
          onToast={onToast}
          onSecureFolderActivate={onSecureFolderActivate}
        />
      )}
      {showSharedWithMe && sharedWithMeRoot && sharedWithMeRoot.children?.map((grantorGroup) => (
        <FileTreeNode
          key={grantorGroup.path}
          entry={{
            ...grantorGroup,
            name: `from ${grantorGroup.name}`,
          }}
          depth={0}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onMove={() => {}}
          onRename={() => {}}
          onContextMenu={onContextMenu}
          searchQuery={searchQuery}
          currentUserEmail={currentUserEmail}
          onToast={onToast}
        />
      ))}
      {showShared && sharedFiles.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onMove={onMove}
          onRename={onRename}
          onContextMenu={onContextMenu}
          searchQuery={searchQuery}
          stars={stars}
          onToggleStar={onToggleStar}
          onCreateInFolder={onCreateInFolder}
          currentUserEmail={currentUserEmail}
          onToast={onToast}
        />
      ))}
    </div>
  );
}
