import React, { useState, useEffect, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

interface TocEntry {
  level: number;
  text: string;
  id: string;
  pos: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function scanHeadings(editor: any): TocEntry[] {
  const entries: TocEntry[] = [];
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'heading') {
      entries.push({
        level: node.attrs.level,
        text: node.textContent,
        id: slugify(node.textContent),
        pos,
      });
    }
  });
  return entries;
}

export function TocNodeView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<TocEntry[]>(() => scanHeadings(editor));

  useEffect(() => {
    const handler = () => setHeadings(scanHeadings(editor));
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor]);

  const handleClick = useCallback((e: React.MouseEvent, entry: TocEntry) => {
    e.preventDefault();
    const el = document.querySelector(`.editor-content .tiptap [id="${CSS.escape(entry.id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Skip the first h1 (title) — the TOC sits right below it
  const minLevel = headings.length > 0 ? headings[0].level : 1;
  const tocHeadings = headings.filter((h) => h.level > minLevel || headings.indexOf(h) > 0);

  if (tocHeadings.length === 0) {
    return (
      <NodeViewWrapper className="toc-block" contentEditable={false}>
        <div className="toc-empty">No headings found</div>
      </NodeViewWrapper>
    );
  }

  const baseLevel = Math.min(...tocHeadings.map((h) => h.level));

  return (
    <NodeViewWrapper className="toc-block" contentEditable={false}>
      <div className="toc-title">Table of contents</div>
      <ul className="toc-list">
        {tocHeadings.map((entry, i) => (
          <li
            key={i}
            className="toc-item"
            style={{ paddingLeft: `${(entry.level - baseLevel) * 16}px` }}
          >
            <a
              href={`#${entry.id}`}
              className="toc-link"
              onClick={(e) => handleClick(e, entry)}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </NodeViewWrapper>
  );
}
