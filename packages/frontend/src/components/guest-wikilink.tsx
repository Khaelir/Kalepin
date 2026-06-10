import React from 'react';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { WikilinkNode } from '../editor/extensions/wikilink-node';
import { parseWikilinkDisplay } from '../editor/extensions/wikilink-utils';

/**
 * Read-only chip shown to public-share-link viewers. Same visual shape as the
 * authenticated `WikilinkNodeView` but without the file-resolution machinery
 * (guests can't navigate cross-note targets) and without the broken/ambiguous
 * status colors (we'd flag every link as "broken" since the file list is
 * empty, which would be misleading).
 */
function GuestWikilinkNodeView({ node }: NodeViewProps) {
  const target: string = node.attrs.target || '';
  const alias: string | null = node.attrs.alias || null;
  const { label, dirHint, heading } = parseWikilinkDisplay(target, alias);

  return (
    <NodeViewWrapper
      as="span"
      className="wikilink-badge wikilink-badge--guest"
      contentEditable={false}
      draggable={false}
      title={target}
    >
      <span className="wikilink-badge-icon">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 1.5h6a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2v-9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5h4M5 7.5h4M5 10h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
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

/**
 * Guest-mode wikilink node. Inherits the markdown parse/serialize hooks from
 * `WikilinkNode` (so `[[Note]]` and `[[Note|alias]]` round-trip correctly),
 * but swaps in a non-interactive React node-view.
 */
export const GuestWikilinkNode = WikilinkNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(GuestWikilinkNodeView);
  },
});
