import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

interface SelectionBubbleProps {
  editor: Editor;
  container: HTMLElement | null;
  /**
   * Called when the user clicks Comment. The bubble captures the current
   * selection (from, to, quotedText) and hands it back so Editor can wire
   * into the existing FloatingInput + onAddComment flow.
   */
  onComment: (args: {
    from: number;
    to: number;
    quotedText: string;
    anchor: { top: number; left: number };
  }) => void;
}

interface BubblePos {
  top: number;
  left: number;
  /** Whether the bubble was flipped below the selection (selection near top). */
  flipped: boolean;
}

export function SelectionBubble({ editor, container, onComment }: SelectionBubbleProps) {
  const [pos, setPos] = useState<BubblePos | null>(null);
  const [, forceTick] = useState(0);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const recompute = useCallback(() => {
    if (!container || !editor) {
      setPos(null);
      return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      setPos(null);
      return;
    }
    // Gate: selection must be inside the prose (the ProseMirror root).
    // We approximate by checking editor.view has focus or the DOM parent of
    // the selection head is inside the editable — coordsAtPos will throw if
    // the position isn't in the live doc.
    let start, end;
    try {
      start = editor.view.coordsAtPos(from);
      end = editor.view.coordsAtPos(to);
    } catch {
      setPos(null);
      return;
    }
    const rectLeft = Math.min(start.left, end.left);
    const rectRight = Math.max(start.right, end.right);
    const rectTop = Math.min(start.top, end.top);
    const rectBottom = Math.max(start.bottom, end.bottom);
    if (rectRight - rectLeft < 2 && rectBottom - rectTop < 2) {
      setPos(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const bubbleWidth = bubbleRef.current?.offsetWidth ?? 380;
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 36;
    const gap = 8;

    // Default: bubble above the selection. Flip below when the selection top
    // is within 60px of the container top (bubble would clip off-screen).
    let flipped = false;
    let top = rectTop - containerRect.top + container.scrollTop - bubbleHeight - gap;
    if (top < container.scrollTop + 8) {
      flipped = true;
      top = rectBottom - containerRect.top + container.scrollTop + gap;
    }

    const centerX = (rectLeft + rectRight) / 2;
    let left = centerX - containerRect.left - bubbleWidth / 2;
    const maxLeft = container.clientWidth - bubbleWidth - 8;
    left = Math.max(8, Math.min(left, Math.max(8, maxLeft)));

    setPos({ top, left, flipped });
  }, [editor, container]);

  // Subscribe to editor events. selectionUpdate drives show/hide positioning;
  // transaction keeps active-state indicators in sync when the same selection
  // has marks toggled (selectionUpdate doesn't fire in that case).
  useEffect(() => {
    if (!editor) return;
    const onSel = () => recompute();
    const onTx = () => forceTick((n) => n + 1);
    const onBlur = () => {
      // Don't dismiss on blur — clicking a bubble button briefly steals
      // focus and the selection survives. We clamp via selectionUpdate
      // (collapse) and the document mousedown handler below instead.
    };
    editor.on('selectionUpdate', onSel);
    editor.on('transaction', onTx);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', onSel);
      editor.off('transaction', onTx);
      editor.off('blur', onBlur);
    };
  }, [editor, recompute]);

  // Recompute on container resize + scroll so the bubble tracks prose width
  // changes and stays glued to the selection while scrolling.
  useEffect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(container);
    const onScroll = () => recompute();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  }, [container, recompute]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  // Escape dismisses by blurring the editor (which collapses the bubble via
  // selectionUpdate on the next transaction). Click-outside dismisses when
  // the mousedown target is neither the bubble nor inside the editable prose.
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Collapse selection to its head — hides the bubble via selectionUpdate.
      const { to } = editor.state.selection;
      const tr = editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, to),
      );
      editor.view.dispatch(tr);
      editor.commands.focus();
      setPos(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const bubble = bubbleRef.current;
      if (bubble && bubble.contains(target)) return;
      // If the click is inside the editable DOM, selectionUpdate will adjust
      // the bubble naturally — don't preemptively hide.
      const pmDom = editor.view.dom as HTMLElement;
      if (pmDom.contains(target)) return;
      setPos(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [pos, editor]);

  if (!pos) return null;

  // onMouseDown + preventDefault on every button keeps editor focus + the
  // selection intact while the click handler runs.
  const stop = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
  };

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  const isBold = editor.isActive('bold');
  const isItalic = editor.isActive('italic');
  const isStrike = editor.isActive('strike');
  const isUnderline = editor.isActive('underline');
  const isCode = editor.isActive('code');
  const isQuote = editor.isActive('blockquote');
  const isH2 = editor.isActive('heading', { level: 2 });
  const isH3 = editor.isActive('heading', { level: 3 });
  const isLink = editor.isActive('link');

  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleStrike = () => editor.chain().focus().toggleStrike().run();
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run();
  const toggleCode = () => editor.chain().focus().toggleCode().run();
  const toggleQuote = () => editor.chain().focus().toggleBlockquote().run();
  const toggleH2 = () => editor.chain().focus().toggleHeading({ level: 2 }).run();
  const toggleH3 = () => editor.chain().focus().toggleHeading({ level: 3 }).run();

  const makeWikilink = () => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to).trim();
    if (!text) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        { type: 'wikilink', attrs: { target: text, alias: null } },
      )
      .run();
  };

  const makeOrEditLink = () => {
    const existing = editor.getAttributes('link')?.href as string | undefined;
    const url = window.prompt('Link URL', existing ?? 'https://');
    if (url == null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  const handleComment = () => {
    const { from, to } = editor.state.selection;
    const quotedText = editor.state.doc.textBetween(from, to, '\n');
    if (!quotedText.trim()) return;
    // Hand the anchor back to Editor so the FloatingInput lands next to the
    // selection rather than at the bubble itself.
    try {
      const coords = editor.view.coordsAtPos(from);
      onComment({ from, to, quotedText, anchor: { top: coords.bottom + 6, left: coords.left } });
    } catch {
      onComment({ from, to, quotedText, anchor: { top: 120, left: 120 } });
    }
    setPos(null);
  };

  return (
    <div
      ref={bubbleRef}
      className={`kp-bubble${pos.flipped ? ' is-flipped' : ''}`}
      style={{ top: pos.top, left: pos.left }}
      contentEditable={false}
      onMouseDown={stop}
    >
      <button
        type="button"
        className={`kp-bubble-btn${isBold ? ' is-active' : ''}`}
        title="Bold"
        aria-label="Bold"
        onMouseDown={run(toggleBold)}
      >
        <BoldIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isItalic ? ' is-active' : ''}`}
        title="Italic"
        aria-label="Italic"
        onMouseDown={run(toggleItalic)}
      >
        <ItalicIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isStrike ? ' is-active' : ''}`}
        title="Strikethrough"
        aria-label="Strikethrough"
        onMouseDown={run(toggleStrike)}
      >
        <StrikeIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isUnderline ? ' is-active' : ''}`}
        title="Underline"
        aria-label="Underline"
        onMouseDown={run(toggleUnderline)}
      >
        <UnderlineIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isCode ? ' is-active' : ''}`}
        title="Inline code"
        aria-label="Inline code"
        onMouseDown={run(toggleCode)}
      >
        <CodeIcon />
      </button>
      <span className="kp-bubble-sep" />
      <button
        type="button"
        className="kp-bubble-btn"
        title="Wiki link"
        aria-label="Wiki link"
        onMouseDown={run(makeWikilink)}
      >
        <WikilinkIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isLink ? ' is-active' : ''}`}
        title="External link"
        aria-label="External link"
        onMouseDown={run(makeOrEditLink)}
      >
        <LinkIcon />
      </button>
      <span className="kp-bubble-sep" />
      <button
        type="button"
        className={`kp-bubble-btn${isQuote ? ' is-active' : ''}`}
        title="Quote"
        aria-label="Quote"
        onMouseDown={run(toggleQuote)}
      >
        <QuoteIcon />
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isH2 ? ' is-active' : ''}`}
        title="Heading 2"
        aria-label="Heading 2"
        onMouseDown={run(toggleH2)}
      >
        <span className="kp-bubble-heading-label">H2</span>
      </button>
      <button
        type="button"
        className={`kp-bubble-btn${isH3 ? ' is-active' : ''}`}
        title="Heading 3"
        aria-label="Heading 3"
        onMouseDown={run(toggleH3)}
      >
        <span className="kp-bubble-heading-label">H3</span>
      </button>
      <span className="kp-bubble-sep" />
      <button
        type="button"
        className="kp-bubble-btn wide"
        aria-label="Comment"
        onMouseDown={run(handleComment)}
      >
        <CommentIcon />
        <span>Comment</span>
      </button>
      <button
        type="button"
        className="kp-bubble-btn wide kp-bubble-ai"
        title="Ask AI coming soon"
        aria-label="Ask AI coming soon"
        disabled
        onMouseDown={stop}
      >
        <SparkleIcon />
        <span>Ask AI</span>
      </button>
    </div>
  );
}

function BoldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 3h4.5a2.5 2.5 0 010 5H4z" />
      <path d="M4 8h5a2.5 2.5 0 010 5H4z" />
    </svg>
  );
}
function ItalicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M10 3H6M10 13H6M9 3l-3 10" />
    </svg>
  );
}
function StrikeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 8h10" />
      <path d="M12 5c0-1-1-2-3-2H7C5.5 3 4.5 4 4.5 5M4 11c0 1 1 2 3 2h2c2 0 3-1 3-2" />
    </svg>
  );
}
function UnderlineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 3v5a4 4 0 008 0V3" />
      <path d="M3 13h10" />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" />
    </svg>
  );
}
function WikilinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3H3v10h2M11 3h2v10h-2" />
      <path d="M6 6h4M6 10h4" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.7.7" />
      <path d="M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.7-.7" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 5h3v3H5v2H4V5zm5 0h3v3h-2v2H9V5z" />
    </svg>
  );
}
function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H8l-3 3v-3H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" />
    </svg>
  );
}
