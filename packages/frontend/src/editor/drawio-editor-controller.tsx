import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { DrawioEditorModal } from './drawio-editor-modal';
import { DRAWIO_EDIT_EVENT, DrawioEditDetail } from './image-extension';
import { uploadImage, fetchImageBlob } from '../api';

interface DrawioSession {
  /** Original attachment name being edited */
  attachmentName: string;
  /** ProseMirror node position */
  nodePos: number;
  /** SVG content loaded from the attachment */
  svgData: string;
  /** Whether this is a new diagram (from /drawio slash command) */
  isNew?: boolean;
}

interface DrawioEditorControllerProps {
  editor: Editor | null;
  activeDocPath: string;
}

/**
 * Controller component that manages the draw.io editor lifecycle:
 * - Listens for edit events from ImageWithAttachments
 * - Fetches SVG content for the diagram
 * - Opens the DrawioEditorModal
 * - Handles save (upload new SVG, update node src)
 */
export function DrawioEditorController({ editor, activeDocPath }: DrawioEditorControllerProps) {
  const [session, setSession] = useState<DrawioSession | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const docPathRef = useRef(activeDocPath);
  docPathRef.current = activeDocPath;

  // Listen for draw.io edit events from image nodes
  useEffect(() => {
    const handleEditEvent = async (e: Event) => {
      const detail = (e as CustomEvent<DrawioEditDetail>).detail;
      if (!detail?.attachmentName) return;

      try {
        // Fetch the SVG content (scoped to the active doc's namespace)
        const blobUrl = await fetchImageBlob(detail.attachmentName, docPathRef.current);
        const res = await fetch(blobUrl);
        const svgData = await res.text();

        setSession({
          attachmentName: detail.attachmentName,
          nodePos: detail.nodePos,
          svgData,
        });
      } catch (err) {
        console.error('Failed to load draw.io SVG:', err);
      }
    };

    document.addEventListener(DRAWIO_EDIT_EVENT, handleEditEvent);
    return () => document.removeEventListener(DRAWIO_EDIT_EVENT, handleEditEvent);
  }, []);

  // Save handler: upload new SVG, update node src
  const handleSave = useCallback(async (svgData: string) => {
    const ed = editorRef.current;
    if (!ed || !session) return;

    // Skip save if content hasn't changed (compare raw SVG text)
    if (svgData === session.svgData) return;

    try {
      // Upload the SVG as a new attachment
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const file = new File([blob], 'diagram.svg', { type: 'image/svg+xml' });
      const { relativePath } = await uploadImage(file, docPathRef.current);

      // Update the image node's src to point to the new file
      const { doc } = ed.state;
      const nodePos = session.nodePos;

      // Find the image node at the saved position (it may have shifted)
      let targetPos: number | null = null;
      const oldSrc = `_attachments/${session.attachmentName}`;

      doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (node.type.name === 'image') {
          const src = node.attrs.src || '';
          // Match by attachment name (position may have changed)
          if (src.includes(session.attachmentName)) {
            targetPos = pos;
            return false;
          }
        }
        return true;
      });

      if (targetPos !== null) {
        const node = doc.nodeAt(targetPos);
        if (node) {
          ed.view.dispatch(
            ed.state.tr.setNodeMarkup(targetPos, undefined, {
              ...node.attrs,
              src: relativePath,
            }),
          );
        }
      }

      // Update session with new attachment name
      const newName = relativePath.split('/').pop() || session.attachmentName;
      setSession((prev) =>
        prev ? { ...prev, attachmentName: newName, svgData } : null,
      );
    } catch (err) {
      console.error('Failed to save draw.io diagram:', err);
      alert('Failed to save diagram. Please try again.');
    }
  }, [session]);

  const handleClose = useCallback(() => {
    if (session?.isNew && session.attachmentName) {
      // If it's a new diagram that was never saved, clean up
      const ed = editorRef.current;
      if (ed) {
        const { doc } = ed.state;
        doc.descendants((node, pos) => {
          if (node.type.name === 'image' && (node.attrs.src || '').includes(session.attachmentName)) {
            ed.view.dispatch(ed.state.tr.delete(pos, pos + node.nodeSize));
            return false;
          }
          return true;
        });
      }
    }
    setSession(null);
  }, [session]);

  if (!session) return null;

  return (
    <DrawioEditorModal
      svgData={session.svgData}
      onSave={handleSave}
      onClose={handleClose}
    />
  );
}

/**
 * Opens the draw.io editor for a new blank diagram.
 * Used by the /drawio slash command.
 */
export async function openNewDrawioDiagram(
  editor: Editor,
  docPath: string,
): Promise<void> {
  const { EMPTY_DRAWIO_SVG } = await import('./drawio-utils');

  // Upload the empty SVG as an attachment
  const blob = new Blob([EMPTY_DRAWIO_SVG], { type: 'image/svg+xml' });
  const file = new File([blob], 'diagram.svg', { type: 'image/svg+xml' });
  const { relativePath } = await uploadImage(file, docPath);

  // Insert image node at cursor
  editor.chain().focus().setImage({ src: relativePath, alt: 'draw.io diagram' }).run();

  // Extract attachment name and trigger edit
  const attachmentName = relativePath.split('/').pop();
  if (attachmentName) {
    // Small delay to let the node render, then trigger edit
    setTimeout(() => {
      // Find the node position of the just-inserted image
      const { doc } = editor.state;
      let nodePos: number | undefined;
      doc.descendants((node, pos) => {
        if (nodePos !== undefined) return false;
        if (node.type.name === 'image' && (node.attrs.src || '').includes(attachmentName)) {
          nodePos = pos;
          return false;
        }
        return true;
      });

      if (nodePos !== undefined) {
        document.dispatchEvent(
          new CustomEvent(DRAWIO_EDIT_EVENT, {
            detail: { attachmentName, nodePos, isNew: true } as DrawioEditDetail & { isNew: boolean },
          }),
        );
      }
    }, 100);
  }
}
