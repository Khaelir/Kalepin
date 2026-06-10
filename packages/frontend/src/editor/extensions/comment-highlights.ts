import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { CommentThread } from '@kalepin/shared';

export interface CommentIconClickEvent {
  threadId: string;
  rect: DOMRect;
}

const commentHighlightsKey = new PluginKey('commentHighlights');

// Module-level callback ref — shared between the plugin (which reads it) and
// setCommentHighlightOnClick (which writes it).  This sidesteps a TipTap issue
// where extension.storage inside addProseMirrorPlugins() is a different object
// from the one exposed via editor.extensionManager.extensions[…].storage.
let _onClick: ((event: CommentIconClickEvent) => void) | null = null;

export function setCommentHighlightOnClick(
  cb: ((event: CommentIconClickEvent) => void) | null,
) {
  _onClick = cb;
}

export const CommentHighlights = Extension.create({
  name: 'commentHighlights',

  addStorage() {
    return {
      threads: [] as CommentThread[],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightsKey,

        state: {
          init() {
            return DecorationSet.empty;
          },

          apply(tr, oldDecorations, _oldState, newState) {
            const meta = tr.getMeta(commentHighlightsKey);
            if (!meta && !tr.docChanged) {
              return oldDecorations;
            }

            const threads: CommentThread[] = meta?.threads ?? [];
            const focusThreadId: string | null = meta?.focusThreadId ?? null;
            const decorations: Decoration[] = [];
            const doc = newState.doc;

            // Build full-text index for searching
            const textChunks: { pos: number; text: string }[] = [];
            doc.descendants((node, pos) => {
              if (node.isText) {
                textChunks.push({ pos, text: node.text! });
              }
              return true;
            });

            let fullText = '';
            const posMap: { charOffset: number; pmPos: number }[] = [];
            for (const chunk of textChunks) {
              posMap.push({ charOffset: fullText.length, pmPos: chunk.pos });
              fullText += chunk.text;
            }

            function findOccurrences(searchText: string): { from: number; to: number }[] {
              const results: { from: number; to: number }[] = [];
              let startIdx = 0;
              while (true) {
                const index = fullText.indexOf(searchText, startIdx);
                if (index === -1) break;
                let pmFrom = 0;
                for (let i = posMap.length - 1; i >= 0; i--) {
                  if (posMap[i].charOffset <= index) {
                    pmFrom = posMap[i].pmPos + (index - posMap[i].charOffset);
                    break;
                  }
                }
                results.push({ from: pmFrom, to: pmFrom + searchText.length });
                startIdx = index + 1;
              }
              return results;
            }

            const docSize = doc.content.size;

            for (const thread of threads) {
              if (thread.resolved) continue;
              if (!thread.quotedText) continue;

              const occurrences = findOccurrences(thread.quotedText);
              if (occurrences.length === 0) continue;

              // Pick best match using positionHint
              let best = occurrences[0];
              if (occurrences.length > 1 && thread.positionHint) {
                let bestDist = Math.abs(best.from - thread.positionHint.from);
                for (const occ of occurrences) {
                  const dist = Math.abs(occ.from - thread.positionHint.from);
                  if (dist < bestDist) {
                    best = occ;
                    bestDist = dist;
                  }
                }
              }

              const from = Math.max(0, Math.min(best.from, docSize));
              const to = Math.max(0, Math.min(best.to, docSize));
              if (from >= to) continue;

              // Inline decoration: subtle highlight on the text. When the thread
              // is focused (e.g. from the comments panel / search), add a pulse
              // class that plays a 1.4s animation.
              const highlightClass = focusThreadId === thread.id
                ? 'comment-highlight comment-highlight--pulse'
                : 'comment-highlight';
              decorations.push(
                Decoration.inline(from, to, { class: highlightClass }),
              );

              // Widget decoration: small icon after the highlighted text
              const widget = document.createElement('span');
              widget.className = 'comment-highlight-icon';
              widget.setAttribute('data-thread-id', thread.id);

              // Comment bubble SVG
              widget.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

              // Reply count badge
              if (thread.comments.length > 1) {
                const badge = document.createElement('span');
                badge.className = 'comment-highlight-badge';
                badge.textContent = String(thread.comments.length);
                widget.appendChild(badge);
              }

              widget.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = widget.getBoundingClientRect();
                _onClick?.({ threadId: thread.id, rect });
              });
              widget.addEventListener('mousedown', (e) => {
                e.stopPropagation();
              });

              decorations.push(
                Decoration.widget(to, widget, {
                  side: 1,
                  key: `comment-icon-${thread.id}`,
                }),
              );
            }

            return DecorationSet.create(doc, decorations);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

/**
 * Update comment threads, triggering a decoration rebuild.
 */
export function updateCommentHighlights(
  editor: any,
  threads: CommentThread[],
  focusThreadId: string | null = null,
) {
  const view = editor.view;
  if (view) {
    const tr = view.state.tr.setMeta(commentHighlightsKey, { threads, focusThreadId });
    view.dispatch(tr);
  }
}
