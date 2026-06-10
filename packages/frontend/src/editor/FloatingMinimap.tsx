import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { CommentThread } from '@kalepin/shared';
import type { DocHeading } from './Editor';

/**
 * Walks the offsetParent chain summing offsetTop until the scroll container
 * is reached. Used instead of getBoundingClientRect for scroll-independent
 * positions — rect-based math shifts with scroll and would jitter under
 * rAF-throttled updates.
 */
export function offsetTopWithin(el: HTMLElement, container: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== container) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/**
 * Finds the best ProseMirror position matching a quoted fragment. Ported from
 * the previous CommentScrollMarkers so Phase 8 can own the resolver and the
 * old file can be deleted.
 */
function findBestMatch(
  fullText: string,
  posMap: { charOffset: number; pmPos: number }[],
  quotedText: string,
  positionHint?: { from: number; to: number },
): number | null {
  const occurrences: number[] = [];
  let startIdx = 0;
  while (true) {
    const index = fullText.indexOf(quotedText, startIdx);
    if (index === -1) break;
    let pmFrom = 0;
    for (let i = posMap.length - 1; i >= 0; i--) {
      if (posMap[i].charOffset <= index) {
        pmFrom = posMap[i].pmPos + (index - posMap[i].charOffset);
        break;
      }
    }
    occurrences.push(pmFrom);
    startIdx = index + 1;
  }
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1 || !positionHint) return occurrences[0];
  let best = occurrences[0];
  let bestDist = Math.abs(best - positionHint.from);
  for (const pos of occurrences) {
    const dist = Math.abs(pos - positionHint.from);
    if (dist < bestDist) {
      best = pos;
      bestDist = dist;
    }
  }
  return best;
}

interface FloatingMinimapProps {
  editor: Editor;
  container: HTMLElement | null;
  headings: DocHeading[];
  threads: CommentThread[];
  onFocusThread: (threadId: string) => void;
}

interface HeadingEntry {
  slug: string;
  level: number;
  text: string;
  pos: number;
  top: number;
}

interface CommentEntry {
  threadId: string;
  top: number;
  resolved: boolean;
  quotedText: string;
}

export function FloatingMinimap({
  editor,
  container,
  headings,
  threads,
  onFocusThread,
}: FloatingMinimapProps) {
  const [hover, setHover] = useState(false);
  const [headingEntries, setHeadingEntries] = useState<HeadingEntry[]>([]);
  const [commentEntries, setCommentEntries] = useState<CommentEntry[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0, total: 1 });
  const [anchor, setAnchor] = useState({ top: 80, right: 8 });
  const rafRef = useRef(0);

  // Anchor the minimap to the editor area's viewport bounds. Living inside
  // the scroll container (position: absolute) caused micro-jumps because the
  // browser scrolls natively on the compositor while our React-driven `top`
  // update lags by a frame. position: fixed against the editor area's rect
  // sidesteps that entirely.
  useLayoutEffect(() => {
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      setAnchor({
        top: rect.top + 80,
        right: window.innerWidth - rect.right + 8,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [container]);

  const recomputeGeometry = useCallback(() => {
    if (!container || !editor) return;
    const total = container.scrollHeight || 1;

    const nextHeadings: HeadingEntry[] = [];
    for (const h of headings) {
      const el = container.querySelector(
        `.tiptap [id="${CSS.escape(h.slug)}"]`,
      ) as HTMLElement | null;
      if (!el) continue;
      nextHeadings.push({ ...h, top: offsetTopWithin(el, container) });
    }
    setHeadingEntries(nextHeadings);

    // Build a full-text index so we can resolve thread.quotedText → PM pos.
    const textChunks: { pos: number; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) textChunks.push({ pos, text: node.text! });
      return true;
    });
    let fullText = '';
    const posMap: { charOffset: number; pmPos: number }[] = [];
    for (const chunk of textChunks) {
      posMap.push({ charOffset: fullText.length, pmPos: chunk.pos });
      fullText += chunk.text;
    }

    const containerRect = container.getBoundingClientRect();
    const nextComments: CommentEntry[] = [];
    for (const thread of threads) {
      if (!thread.quotedText) continue;
      const pmPos = findBestMatch(fullText, posMap, thread.quotedText, thread.positionHint);
      if (pmPos === null) continue;
      try {
        const coords = editor.view.coordsAtPos(pmPos);
        const top = coords.top - containerRect.top + container.scrollTop;
        nextComments.push({
          threadId: thread.id,
          top,
          resolved: !!thread.resolved,
          quotedText: thread.quotedText,
        });
      } catch {
        // coordsAtPos can throw for stale positions — skip the marker.
      }
    }
    setCommentEntries(nextComments);

    setViewport({
      top: container.scrollTop,
      height: container.clientHeight,
      total,
    });
  }, [editor, container, headings, threads]);

  // Recompute whenever the data shape or container changes.
  useLayoutEffect(() => {
    recomputeGeometry();
  }, [recomputeGeometry]);

  // ResizeObserver on the scroll container picks up prose-width changes,
  // window resizes, image loads, etc.
  useEffect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => recomputeGeometry());
    ro.observe(container);
    return () => ro.disconnect();
  }, [container, recomputeGeometry]);

  // rAF-throttled scroll tracking — single scheduled render per frame, latched
  // by rafRef so multiple scroll events collapse into one update.
  useEffect(() => {
    if (!container) return;
    const scheduleUpdate = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setViewport({
          top: container.scrollTop,
          height: container.clientHeight,
          total: container.scrollHeight || 1,
        });
      });
    };
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      container.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [container]);

  // Active heading: last heading whose top is above the viewport top + 120px
  // buffer. Matches the handoff reference markup's behavior.
  useEffect(() => {
    if (headingEntries.length === 0) {
      setActivePos(null);
      return;
    }
    const scTop = viewport.top;
    let current = headingEntries[0].pos;
    for (const h of headingEntries) {
      if (h.top - 120 <= scTop) current = h.pos;
      else break;
    }
    setActivePos(current);
  }, [headingEntries, viewport.top]);

  const jumpTo = useCallback(
    (top: number) => {
      if (!container) return;
      container.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
    },
    [container],
  );

  if (headingEntries.length === 0 && commentEntries.length === 0) return null;

  const pct = (px: number) => `${(px / (viewport.total || 1)) * 100}%`;

  return (
    <div
      className={`kp-minimap${hover ? ' is-hover' : ''}`}
      style={{ top: anchor.top, right: anchor.right }}
    >
      <div className="kp-minimap-scrollstrip">
        <div
          className="kp-scrollstrip-viewport"
          style={{ top: pct(viewport.top), height: pct(viewport.height) }}
        />
        {commentEntries.map((c) => (
          <button
            key={c.threadId}
            type="button"
            className={`kp-scrollstrip-marker${c.resolved ? ' is-resolved' : ''}`}
            style={{ top: pct(c.top) }}
            onClick={() => {
              jumpTo(c.top);
              onFocusThread(c.threadId);
            }}
            title={`Comment: "${c.quotedText.slice(0, 60)}${c.quotedText.length > 60 ? '…' : ''}"`}
          >
            <span className="kp-scrollstrip-marker-dot" />
            <span className="kp-scrollstrip-marker-flag">
              <CommentIcon />
              <span>
                {c.quotedText.slice(0, 60)}
                {c.quotedText.length > 60 ? '…' : ''}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div
        className="kp-minimap-rail"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {headingEntries.length > 0 && (
          <div className="kp-minimap-label">
            <TocIcon />
            <span>On this page</span>
          </div>
        )}
        {headingEntries.map((h) => {
          const level = Math.min(3, Math.max(1, h.level));
          const active = h.pos === activePos;
          return (
            <button
              key={h.pos}
              type="button"
              className={`kp-minimap-tick level-${level}${active ? ' is-active' : ''}`}
              onClick={() => jumpTo(h.top)}
              title={h.text}
            >
              <span className="kp-minimap-dot" />
              <span className="kp-minimap-text">{h.text || 'Untitled'}</span>
            </button>
          );
        })}
        {commentEntries.length > 0 && (
          <div className="kp-minimap-commentsection">
            <div className="kp-minimap-label kp-minimap-label--plain">
              <CommentIcon />
              <span>
                {commentEntries.length} comment{commentEntries.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TocIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h10M5 8h8M7 12h6" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H8l-3 3v-3H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  );
}
