import Image from '@tiptap/extension-image';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';
import { fetchImageBlob } from '../api';
import { isDrawioSvg } from './drawio-utils';
import { getActiveDocPath } from './slash-commands';

/**
 * Extract the attachment filename from a relative path containing `_attachments/`.
 */
function extractAttachmentName(src: string): string | null {
  const match = src.match(/_attachments\/([^/\s)]+)$/);
  return match ? match[1] : null;
}

// --- Fullscreen modal (singleton) ---

let modal: HTMLDivElement | null = null;

function showImageModal(src: string) {
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.className = 'image-modal-overlay';
  modal.innerHTML = `
    <div class="image-modal-content">
      <img src="${src}" class="image-modal-img" />
      <button class="image-modal-close" aria-label="Close">&times;</button>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (
      e.target === modal ||
      (e.target as HTMLElement).classList.contains('image-modal-close')
    ) {
      modal?.remove();
      modal = null;
    }
  });
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      modal?.remove();
      modal = null;
      document.removeEventListener('keydown', handleKey);
    }
  };
  document.addEventListener('keydown', handleKey);
  document.body.appendChild(modal);
}

function downloadImage(src: string, name: string) {
  const a = document.createElement('a');
  a.href = src;
  a.download = name;
  a.click();
}

// --- draw.io editor modal event ---

/** Dispatched when user clicks "Edit" on a draw.io SVG */
export const DRAWIO_EDIT_EVENT = 'kalepin:drawio-edit';

export interface DrawioEditDetail {
  /** The attachment filename (e.g., "abc123.svg") */
  attachmentName: string;
  /** The ProseMirror node position */
  nodePos: number;
}

/**
 * Image extension with:
 * - Markdown serialization support for tiptap-markdown
 * - Custom NodeView with authenticated blob URL resolution
 * - Hover actions: maximize in modal, download full-res
 * - draw.io SVG detection: badge and "Edit" action
 */
export const ImageWithAttachments = Image.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode) {
          const alt = node.attrs.alt || '';
          const src = node.attrs.src || '';
          const title = node.attrs.title;
          if (title) {
            state.write(`![${alt}](${src} "${title}")`);
          } else {
            state.write(`![${alt}](${src})`);
          }
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },

  addNodeView() {
    return (props: { node: PMNode; view: EditorView; getPos: () => number | undefined }) => {
      const { node, view, getPos } = props;
      const src = node.attrs.src || '';
      const alt = node.attrs.alt || '';
      const title = node.attrs.title || '';
      const attachmentName = extractAttachmentName(src);
      const isSvg = attachmentName?.endsWith('.svg') ?? false;

      // Wrapper
      const wrapper = document.createElement('span');
      wrapper.className = 'image-wrapper';

      // Image
      const img = document.createElement('img');
      img.alt = alt;
      if (title) img.title = title;
      img.setAttribute('data-original-src', src);

      // Track draw.io status for this image
      let isDrawio = false;

      // Resolve src: attachment → blob URL, otherwise use as-is
      if (attachmentName) {
        fetchImageBlob(attachmentName, getActiveDocPath()).then((blobUrl) => {
          img.src = blobUrl;
          // For SVGs, check if it's a draw.io diagram
          if (isSvg) {
            checkDrawioStatus(attachmentName, blobUrl);
          }
        });
      } else {
        img.src = src;
      }

      // Action buttons
      const actions = document.createElement('span');
      actions.className = 'image-actions';
      actions.contentEditable = 'false';

      const maximizeBtn = document.createElement('button');
      maximizeBtn.className = 'image-action-btn';
      maximizeBtn.title = 'View full size';
      maximizeBtn.type = 'button';
      maximizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 1 1 1 1 4"/><polyline points="12 1 15 1 15 4"/><polyline points="4 15 1 15 1 12"/><polyline points="12 15 15 15 15 12"/></svg>`;
      maximizeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showImageModal(img.src);
      });

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'image-action-btn';
      downloadBtn.title = 'Download';
      downloadBtn.type = 'button';
      downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v10M4 8l4 4 4-4"/><path d="M1 13v1a1 1 0 001 1h12a1 1 0 001-1v-1"/></svg>`;
      downloadBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const filename = attachmentName || src.split('/').pop() || 'image';
        downloadImage(img.src, filename);
      });

      // draw.io badge (hidden by default, shown when detected)
      const drawioBadge = document.createElement('span');
      drawioBadge.className = 'drawio-badge';
      drawioBadge.textContent = 'draw.io';
      drawioBadge.style.display = 'none';

      // draw.io edit button (hidden by default)
      const editBtn = document.createElement('button');
      editBtn.className = 'image-action-btn drawio-edit-btn';
      editBtn.title = 'Edit in draw.io';
      editBtn.type = 'button';
      editBtn.style.display = 'none';
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>`;
      editBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (attachmentName) {
          const pos = getPos();
          if (pos !== undefined) {
            document.dispatchEvent(new CustomEvent(DRAWIO_EDIT_EVENT, {
              detail: { attachmentName, nodePos: pos } as DrawioEditDetail,
            }));
          }
        }
      });

      actions.appendChild(drawioBadge);
      actions.appendChild(editBtn);
      actions.appendChild(maximizeBtn);
      actions.appendChild(downloadBtn);

      wrapper.appendChild(img);
      wrapper.appendChild(actions);

      /** Fetch SVG text and check for draw.io metadata */
      async function checkDrawioStatus(name: string, blobUrl: string) {
        try {
          const res = await fetch(blobUrl);
          const text = await res.text();
          isDrawio = isDrawioSvg(text);
          if (isDrawio) {
            drawioBadge.style.display = '';
            editBtn.style.display = '';
            wrapper.classList.add('drawio-image');
          }
        } catch {
          // Not a draw.io SVG — leave defaults
        }
      }

      return {
        dom: wrapper,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'image') return false;
          const newSrc = updatedNode.attrs.src || '';
          const newAlt = updatedNode.attrs.alt || '';
          const newTitle = updatedNode.attrs.title || '';
          img.alt = newAlt;
          if (newTitle) img.title = newTitle;

          if (newSrc !== src) {
            img.setAttribute('data-original-src', newSrc);
            const newName = extractAttachmentName(newSrc);
            if (newName) {
              fetchImageBlob(newName, getActiveDocPath()).then((blobUrl) => {
                img.src = blobUrl;
                if (newName.endsWith('.svg')) {
                  checkDrawioStatus(newName, blobUrl);
                }
              });
            } else {
              img.src = newSrc;
            }
          }
          return true;
        },
      };
    };
  },
});
