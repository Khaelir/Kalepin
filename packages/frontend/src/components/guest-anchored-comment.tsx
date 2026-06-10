import React, { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import * as api from '../api';

/**
 * Floating selection-driven comment affordance for guest viewers.
 *
 * When a guest selects text inside the article, a small "Comment" pill
 * appears near the selection. Clicking it expands into an inline composer
 * pre-filled with the quoted text. On submit we POST with `positionHint`
 * (PM positions) and `quotedText` so the owner sees the anchor on their
 * authenticated side.
 *
 * Implementation notes:
 *  - We watch `window.getSelection()` rather than tiptap's `selectionUpdate`,
 *    because in `editable: false` editors PM doesn't reliably track user
 *    selections — but the browser still does.
 *  - PM positions are derived via `view.posAtCoords` from the selection's
 *    bounding rect. Approximate but sufficient for an anchor hint; the
 *    owner's editor uses `quotedText` as a secondary locator anyway.
 *  - A single bubble handles both states (collapsed pill / expanded form)
 *    so the UI doesn't shift the document while typing.
 */

interface Props {
  editor: Editor | null;
  /** Element whose viewport-relative selection we care about (the article). */
  articleEl: HTMLElement | null;
  code: string;
  accessToken: string;
  /** Read/write the visit-scoped identity so guests don't retype their
   * name/email between anchored comments. Shared with the bottom-of-doc box. */
  readIdentity: () => { name: string; email: string };
  writeIdentity: (id: { name: string; email: string }) => void;
}

interface BubbleState {
  /** PM positions captured at selection time. */
  from: number;
  to: number;
  /** The text the guest highlighted, used as `quotedText` and shown back. */
  quotedText: string;
  /** Viewport-relative position of the selection's bottom-left corner. */
  rect: { top: number; left: number; bottom: number; right: number };
}

export function GuestAnchoredCommentBubble({
  editor,
  articleEl,
  code,
  accessToken,
  readIdentity,
  writeIdentity,
}: Props) {
  const [state, setState] = useState<BubbleState | null>(null);
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Selection watcher. Listens to `mouseup` and `selectionchange` so both
  // mouse-drag and keyboard-arrow selections trigger the bubble.
  useEffect(() => {
    if (!editor || !articleEl) return;

    function captureSelection() {
      // Don't collapse the bubble while the composer is open — typing in the
      // composer's inputs clears window.getSelection() and would dismiss us.
      if (composing) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      // Only react to selections inside the actual prose. Selecting text in
      // the title (an h1 outside the editor) or in the bottom comment box's
      // own textarea would otherwise trigger a bubble that points nowhere.
      const proseRoot = editor!.view.dom as HTMLElement;
      if (!proseRoot.contains(ancestor)) {
        setState(null);
        return;
      }
      const quotedText = sel.toString();
      if (!quotedText.trim()) {
        setState(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) {
        setState(null);
        return;
      }
      // Convert viewport coords → PM positions. `+1` / `-1` nudges the probe
      // points off the rect boundaries so we don't miss the pos at exact
      // baselines on some browsers.
      const fromPM = editor!.view.posAtCoords({
        left: rect.left,
        top: rect.top + 1,
      });
      const toPM = editor!.view.posAtCoords({
        left: rect.right,
        top: rect.bottom - 1,
      });
      if (!fromPM || !toPM) return;
      setState({
        from: Math.min(fromPM.pos, toPM.pos),
        to: Math.max(fromPM.pos, toPM.pos),
        quotedText,
        rect: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        },
      });
    }

    document.addEventListener('mouseup', captureSelection);
    // selectionchange fires on every keystroke that moves the caret too;
    // we run the same gate inside captureSelection so the cost is minimal.
    document.addEventListener('selectionchange', captureSelection);
    return () => {
      document.removeEventListener('mouseup', captureSelection);
      document.removeEventListener('selectionchange', captureSelection);
    };
  }, [editor, articleEl, composing]);

  // When the composer opens, hydrate the identity fields from sessionStorage.
  useEffect(() => {
    if (!composing) return;
    const id = readIdentity();
    if (id.name && !name) setName(id.name);
    if (id.email && !email) setEmail(id.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing]);

  // Dismiss on Escape — but only when the composer isn't open (Esc inside an
  // input should defer to the browser's normal behavior, e.g. close datepicker).
  useEffect(() => {
    if (!state || composing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, composing]);

  if (!state) return null;

  // Anchor the bubble below the selection by default. If that would clip the
  // viewport bottom (selection near the page bottom), flip above instead.
  // Heights are coarse estimates that drive only the flip decision, not the
  // actual rendered size.
  const BUBBLE_HEIGHT = composing ? 320 : 36;
  const flipAbove = state.rect.bottom + BUBBLE_HEIGHT + 16 > window.innerHeight;
  const top =
    (flipAbove ? state.rect.top - BUBBLE_HEIGHT - 8 : state.rect.bottom + 8) +
    window.scrollY;
  // Center on the selection, clamped to the viewport with an 8px gutter.
  const BUBBLE_WIDTH = composing ? 360 : 120;
  const centerX = (state.rect.left + state.rect.right) / 2;
  const left = Math.max(
    8,
    Math.min(centerX - BUBBLE_WIDTH / 2, window.innerWidth - BUBBLE_WIDTH - 8),
  );

  function reset() {
    setComposing(false);
    setText('');
    setError(null);
    setState(null);
    // Best-effort clear the visual selection so the page returns to a calm
    // state after posting. Native selection survives our render cycle.
    window.getSelection()?.removeAllRanges();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !name.trim() || !email.trim() || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Each anchored comment gets its own thread. We mint a unique-ish
      // blockId so the owner's UI doesn't conflate independent selections
      // into one thread — they're meaningfully separate.
      const blockId = `guest-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      await api.postGuestComment(code, accessToken, {
        blockId,
        authorEmail: email.trim(),
        authorName: name.trim(),
        text: text.trim(),
        quotedText: state.quotedText,
        positionHint: { from: state.from, to: state.to },
      });
      writeIdentity({ name: name.trim(), email: email.trim() });
      reset();
    } catch (err) {
      setError((err as Error).message || 'Failed to post comment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={`guest-anchored-bubble${composing ? ' is-composing' : ''}`}
      style={{ top, left, width: BUBBLE_WIDTH }}
      onMouseDown={(e) => {
        // Stop the underlying selection from collapsing when the user clicks
        // the bubble. We also already gated captureSelection on `composing`
        // so subsequent selectionchange events while typing are ignored.
        e.stopPropagation();
      }}
    >
      {!composing ? (
        <button
          type="button"
          className="guest-anchored-bubble-trigger"
          onMouseDown={(e) => {
            // preventDefault so the click doesn't blur+collapse the selection
            // before our state captures it.
            e.preventDefault();
            setComposing(true);
          }}
        >
          <CommentIcon /> Comment
        </button>
      ) : (
        <form className="guest-anchored-bubble-form" onSubmit={submit}>
          <blockquote className="guest-anchored-bubble-quote">
            {state.quotedText.length > 140
              ? `${state.quotedText.slice(0, 140)}…`
              : state.quotedText}
          </blockquote>
          <div className="guest-anchored-bubble-row">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoFocus={!name}
            />
            <input
              type="email"
              placeholder="Your email"
              value={email}
              maxLength={320}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          <textarea
            placeholder="Add a comment…"
            value={text}
            maxLength={10000}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            autoFocus={!!name && !!email}
          />
          <div className="guest-anchored-bubble-actions">
            <button
              type="button"
              className="guest-anchored-bubble-cancel"
              onClick={reset}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="guest-anchored-bubble-submit"
              disabled={busy || !name.trim() || !email.trim() || !text.trim()}
            >
              {busy ? 'Posting…' : 'Post'}
            </button>
          </div>
          {error && <div className="guest-anchored-bubble-error">{error}</div>}
        </form>
      )}
    </div>
  );
}

function CommentIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H8l-3 3v-3H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  );
}
