import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Editor } from '@tiptap/core';

interface TableControlsProps {
  editor: Editor;
}

export function TableControls({ editor }: TableControlsProps) {
  const [hoveredTable, setHoveredTable] = useState<HTMLTableElement | null>(null);
  const [btnPositions, setBtnPositions] = useState<{
    row: { top: number; left: number } | null;
    col: { top: number; left: number } | null;
  }>({ row: null, col: null });
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    hideTimeout.current = setTimeout(() => {
      setHoveredTable(null);
      setBtnPositions({ row: null, col: null });
    }, 150);
  }, [clearHideTimeout]);

  useEffect(() => {
    // In TipTap v3, editor.view.dom may throw if the view hasn't been mounted yet
    // (race between React 18's async useEffect and TipTap's internal setTimeout).
    // The component will remount with a valid editor when TipTap recreates it.
    let editorDom: HTMLElement;
    try {
      editorDom = editor.view.dom;
    } catch {
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const table = (e.target as HTMLElement).closest('table') as HTMLTableElement | null;
      if (table && editorDom.contains(table)) {
        clearHideTimeout();
        setHoveredTable(table);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || (!related.closest('table') && !related.closest('.table-controls-wrapper'))) {
        scheduleHide();
      }
    };

    editorDom.addEventListener('mouseover', handleMouseOver);
    editorDom.addEventListener('mouseout', handleMouseOut);

    return () => {
      editorDom.removeEventListener('mouseover', handleMouseOver);
      editorDom.removeEventListener('mouseout', handleMouseOut);
      clearHideTimeout();
    };
  }, [editor, clearHideTimeout, scheduleHide]);

  // Compute absolute positions relative to .editor-container (the scroll container)
  useEffect(() => {
    if (!hoveredTable) return;

    const scrollContainer = hoveredTable.closest('.editor-container') as HTMLElement | null;
    if (!scrollContainer) return;

    const updatePositions = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const tableRect = hoveredTable.getBoundingClientRect();
      // Convert viewport-relative coords to scroll-container-relative (accounts for scroll)
      const top = tableRect.top - containerRect.top + scrollContainer.scrollTop;
      const left = tableRect.left - containerRect.left + scrollContainer.scrollLeft;
      const width = tableRect.width;
      const height = tableRect.height;

      setBtnPositions({
        row: { top: top + height + 4, left: left + width / 2 },
        col: { top: top + height / 2, left: left + width + 4 },
      });
    };

    updatePositions();

    // Only need to recompute on resize (layout change), not scroll
    window.addEventListener('resize', updatePositions, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePositions);
    };
  }, [hoveredTable]);

  const addRow = useCallback(() => {
    if (!hoveredTable) return;
    const lastRow = hoveredTable.querySelector('tbody tr:last-child td:last-child, tr:last-child td:last-child');
    if (lastRow) {
      const pos = editor.view.posAtDOM(lastRow, 0);
      editor.chain().focus(pos).addRowAfter().run();
    }
  }, [editor, hoveredTable]);

  const addColumn = useCallback(() => {
    if (!hoveredTable) return;
    const firstRowLastCell = hoveredTable.querySelector('th:last-child, tr:first-child td:last-child');
    if (firstRowLastCell) {
      const pos = editor.view.posAtDOM(firstRowLastCell, 0);
      editor.chain().focus(pos).addColumnAfter().run();
    }
  }, [editor, hoveredTable]);

  if (!hoveredTable || !btnPositions.row || !btnPositions.col) return null;

  return (
    <div
      className="table-controls-wrapper"
      onMouseEnter={clearHideTimeout}
      onMouseLeave={scheduleHide}
    >
      <button
        className="table-add-btn table-add-row-btn"
        style={{ position: 'absolute', top: btnPositions.row.top, left: btnPositions.row.left, transform: 'translateX(-50%)' }}
        onClick={addRow}
        title="Add row"
      >
        +
      </button>
      <button
        className="table-add-btn table-add-col-btn"
        style={{ position: 'absolute', top: btnPositions.col.top, left: btnPositions.col.left, transform: 'translateY(-50%)' }}
        onClick={addColumn}
        title="Add column"
      >
        +
      </button>
    </div>
  );
}
