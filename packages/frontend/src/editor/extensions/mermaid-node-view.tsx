import { useState, useEffect, useRef, useCallback } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { renderMermaid } from './mermaid-loader';

/**
 * Decide whether the editor's current selection sits inside this node.
 * Pure function so it can be unit-tested without a DOM.
 */
export function isSelectionInsideNode(
  selFrom: number,
  selTo: number,
  nodePos: number,
  nodeSize: number,
): boolean {
  const start = nodePos;
  const end = nodePos + nodeSize;
  return selFrom >= start && selTo <= end;
}

export function MermaidNodeView({ node, editor, getPos }: NodeViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastValidSvg = useRef<string | null>(null);
  const source = node.textContent;

  const doRender = useCallback(async (text: string) => {
    if (!text.trim()) {
      setSvg(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const result = await renderMermaid(text);
      lastValidSvg.current = result;
      setSvg(result);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Invalid mermaid syntax');
    } finally {
      setLoading(false);
    }
  }, []);

  // Render on mount
  useEffect(() => {
    doRender(source);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Move the editor's cursor to the END of this node so the user can
   * immediately type to extend the source — and so the selectionUpdate
   * listener below sees a cursor INSIDE the block (otherwise it would
   * exit edit mode immediately).
   */
  const focusInsideNode = useCallback(() => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        editor.commands.focus(pos + node.nodeSize - 1);
      }
    } catch {
      // Best-effort; ignore failures.
    }
  }, [editor, getPos, node]);

  const handleToggleEdit = useCallback(() => {
    if (isEditing) {
      doRender(source);
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  }, [isEditing, source, doRender]);

  const handleEnterEditFromPlaceholder = useCallback(() => {
    setIsEditing(true);
  }, []);

  // When edit mode is entered (toggle or placeholder), move the cursor inside
  // the block. Running this in a layout effect guarantees the edit branch is
  // mounted before we focus, so the contentEditable receiving the cursor is
  // the visible <pre>, not the hidden NodeViewContent of the rendered branch.
  useEffect(() => {
    if (isEditing) {
      focusInsideNode();
    }
    // We intentionally only depend on isEditing — re-focusing whenever
    // focusInsideNode changes identity would steal the cursor on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Drive edit-mode lifecycle from PM's selection rather than DOM blur:
  // when the cursor leaves this node, exit edit mode. This avoids relying on
  // the toggle button retaining focus (which it doesn't reliably in TipTap
  // node views) and naturally handles "click outside the block" without
  // false-exits when focus moves between nested editable regions.
  useEffect(() => {
    if (!isEditing) return;
    const handler = () => {
      try {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos !== 'number') return;
        const sel = editor.state.selection;
        if (isSelectionInsideNode(sel.from, sel.to, pos, node.nodeSize)) return;
        doRender(source);
        setIsEditing(false);
      } catch {
        // Defensive: don't crash the editor if our handler throws.
      }
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [isEditing, editor, getPos, node, source, doRender]);

  // Rendered view
  if (!isEditing) {
    return (
      <NodeViewWrapper className="mermaid-wrapper" data-type="mermaid">
        <div className="mermaid-toolbar">
          <button
            className="mermaid-toggle-btn"
            onClick={handleToggleEdit}
            title="Edit source"
            contentEditable={false}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {loading && !lastValidSvg.current && (
          <div className="mermaid-loading" contentEditable={false}>
            <div className="mermaid-spinner" />
          </div>
        )}

        {error && !lastValidSvg.current && (
          <div className="mermaid-error" contentEditable={false}>
            <span className="mermaid-error-icon">&#x26A0;</span>
            <span className="mermaid-error-text">{error}</span>
          </div>
        )}

        {error && lastValidSvg.current && (
          <div className="mermaid-stale" contentEditable={false}>
            <div
              className="mermaid-rendered mermaid-rendered--dimmed"
              dangerouslySetInnerHTML={{ __html: lastValidSvg.current }}
            />
            <div className="mermaid-error-badge" title={error}>&#x26A0;</div>
          </div>
        )}

        {svg && !error && (
          <div
            className="mermaid-rendered"
            contentEditable={false}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}

        {!source.trim() && !loading && !error && !svg && (
          <div
            className="mermaid-empty"
            contentEditable={false}
            onClick={handleEnterEditFromPlaceholder}
            role="button"
            tabIndex={0}
          >
            Empty Mermaid diagram — click to edit
          </div>
        )}

        {/* Hidden content to keep ProseMirror happy */}
        <div style={{ display: 'none' }}>
          <NodeViewContent />
        </div>
      </NodeViewWrapper>
    );
  }

  // Edit view
  return (
    <NodeViewWrapper className="mermaid-wrapper mermaid-wrapper--editing" data-type="mermaid">
      <div className="mermaid-toolbar">
        <button
          className="mermaid-toggle-btn"
          onClick={handleToggleEdit}
          title="Preview diagram"
          contentEditable={false}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>
      </div>
      <pre className="mermaid-source">
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
