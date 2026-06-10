import React, { useMemo } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { resolveWikilink, flattenFiles, parseWikilinkDisplay } from './wikilink-utils';
import type { WikilinkResolution } from './wikilink-utils';

export function WikilinkNodeView({ node, editor, selected, getPos }: NodeViewProps) {
  const target: string = node.attrs.target || '';
  const alias: string | null = node.attrs.alias || null;

  const storage = (editor.storage as any).wikilink;
  const files = storage?.getFiles?.() ?? [];
  const activeFile = storage?.getActiveFile?.() ?? '';

  const allPaths = useMemo(() => flattenFiles(files), [files]);

  const resolution: WikilinkResolution = useMemo(
    () => resolveWikilink(target, activeFile, allPaths),
    [target, activeFile, allPaths],
  );

  const { label, dirHint, heading } = parseWikilinkDisplay(target, alias);

  const tooltipText = resolution.status === 'valid'
    ? resolution.resolvedPath?.replace(/\.md$/, '') ?? target
    : resolution.status === 'broken'
      ? 'Note does not exist'
      : `Ambiguous: ${resolution.candidates?.length ?? 0} matches`;

  const openEditPopover = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    storage?.onOpenEditPopover?.(node, getPos, rect);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (resolution.status === 'broken') return;

    if (resolution.status === 'ambiguous') {
      openEditPopover(e.currentTarget as HTMLElement);
      return;
    }

    // Navigate using the resolved path (full vault path like "folder/file.md")
    const hashIdx = target.indexOf('#');
    const headingText = hashIdx >= 0 ? target.substring(hashIdx + 1).trim() : undefined;
    const headingSlug = headingText ? slugify(headingText) : undefined;
    const resolvedPath = resolution.resolvedPath ?? '';

    if (!resolvedPath || resolvedPath === activeFile) {
      // Same-page heading link
      if (headingSlug) {
        const editorContainer = document.querySelector('.editor-container');
        const el = editorContainer?.querySelector(`[id="${CSS.escape(headingSlug)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${headingSlug}`);
        }
      }
    } else {
      storage?.onNavigate?.(resolvedPath, headingSlug);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openEditPopover(e.currentTarget as HTMLElement);
  };

  const statusClass = `wikilink-badge--${resolution.status}`;

  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink-badge ${statusClass}${selected ? ' wikilink-badge--selected' : ''}`}
      contentEditable={false}
      draggable={false}
      title={tooltipText}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <span className="wikilink-badge-icon">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 1.5h6a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2v-9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 5h4M5 7.5h4M5 10h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </span>
      {dirHint && <span className="wikilink-badge-dir">{dirHint}</span>}
      <span className="wikilink-badge-label">{label}</span>
      {heading && (
        <>
          <span className="wikilink-badge-sep"> &rsaquo; </span>
          <span className="wikilink-badge-heading">{heading}</span>
        </>
      )}
    </NodeViewWrapper>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}
