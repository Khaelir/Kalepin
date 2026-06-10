import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { uploadImage } from '../api';
import { isDrawioSvg } from './drawio-utils';

const imagePasteKey = new PluginKey('imagePaste');

/**
 * TipTap extension that intercepts paste events containing image data,
 * uploads the image, and inserts a markdown image reference.
 *
 * Also detects pasted draw.io SVG text content — if the clipboard contains
 * an SVG string with draw.io metadata, it's saved as an attachment and
 * inserted as an image node (instead of being pasted as raw text).
 */
export function createImagePasteExtension(getDocPath: () => string) {
  return Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: imagePasteKey,
          props: {
            handlePaste(view, event) {
              const items = event.clipboardData?.items;
              if (!items) return false;

              // 1. Check for image blobs (binary paste — screenshots, copied images)
              for (const item of items) {
                if (item.type.startsWith('image/')) {
                  const file = item.getAsFile();
                  if (!file) continue;

                  event.preventDefault();

                  const docPath = getDocPath();
                  uploadImage(file, docPath).then(({ relativePath }) => {
                    const imageNode = view.state.schema.nodes.image?.create({
                      src: relativePath,
                      alt: 'image',
                    });
                    if (imageNode) {
                      const tr = view.state.tr.replaceSelectionWith(imageNode);
                      view.dispatch(tr);
                    }
                  });

                  return true;
                }
              }

              // 2. Check for pasted text that is a draw.io SVG
              const text = event.clipboardData?.getData('text/plain');
              if (text && text.includes('<svg') && isDrawioSvg(text)) {
                event.preventDefault();

                const docPath = getDocPath();
                const blob = new Blob([text], { type: 'image/svg+xml' });
                const file = new File([blob], 'diagram.svg', { type: 'image/svg+xml' });

                uploadImage(file, docPath).then(({ relativePath }) => {
                  const imageNode = view.state.schema.nodes.image?.create({
                    src: relativePath,
                    alt: 'draw.io diagram',
                  });
                  if (imageNode) {
                    const tr = view.state.tr.replaceSelectionWith(imageNode);
                    view.dispatch(tr);
                  }
                });

                return true;
              }

              return false;
            },
          },
        }),
      ];
    },
  });
}
