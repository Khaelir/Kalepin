import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { extractDrawioXml } from './drawio-utils';

// Max clipboard payload size (5MB)
const CLIPBOARD_SIZE_LIMIT = 5 * 1024 * 1024;

export interface DrawioEditorProps {
  /** SVG content (with draw.io XML in content attribute) to load */
  svgData: string;
  /** Called when the user saves the diagram */
  onSave: (svgData: string) => void;
  /** Called when the user closes the editor */
  onClose: () => void;
}

/**
 * Fullscreen modal with a sandboxed iframe running the vendored draw.io editor.
 *
 * Security model:
 * - iframe sandbox="allow-scripts" (no allow-same-origin)
 * - CSP meta tag in embed.html: connect-src 'none'
 * - Clipboard via postMessage proxy
 * - Keyboard shortcuts (save/exit) via draw.io's embed protocol
 */
export function DrawioEditorModal({ svgData, onSave, onClose }: DrawioEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const initialDataRef = useRef(svgData);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      const discard = window.confirm(
        'You have unsaved changes. Discard them?',
      );
      if (!discard) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  // draw.io embed protocol handler
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Only accept messages from the iframe (which has an opaque origin)
      // We validate the message format instead of origin since sandbox gives opaque origin
      let msg: any;
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return; // Not a JSON message — ignore
      }

      if (!msg || !msg.event) return;

      console.debug('[drawio] received event:', msg.event, msg);

      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      switch (msg.event) {
        case 'configure':
          // draw.io asks for configuration — disable cloud/external features
          iframe.contentWindow.postMessage(
            JSON.stringify({
              action: 'configure',
              config: {
                // Disable all cloud storage integrations
                enabledLibraries: [],
                // Custom CSS: force white background on the diagram canvas
                // regardless of the OS color scheme
                css: [
                  `.geDiagramContainer { background: #fff !important; }`,
                  `.geEditor { background-color: #f1f3f4 !important; }`,
                ].join('\n'),
                defaultFonts: [
                  'Helvetica', 'Verdana', 'Times New Roman', 'Garamond',
                  'Comic Sans MS', 'Courier New', 'Georgia', 'Lucida Console',
                  'Tahoma',
                ],
              },
            }),
            '*',
          );
          break;

        case 'init':
          // draw.io is ready — send the diagram data
          setLoading(false);
          // Extract mxGraphModel XML from SVG — draw.io's embed protocol
          // expects XML, not the full SVG wrapper
          const xmlData = extractDrawioXml(initialDataRef.current) || initialDataRef.current;
          console.debug('[drawio] sending load action, xml length:', xmlData?.length);
          iframe.contentWindow.postMessage(
            JSON.stringify({
              action: 'load',
              xml: xmlData,
              autosave: 1,
            }),
            '*',
          );
          break;

        case 'autosave':
          // draw.io auto-saved (content changed)
          setHasChanges(true);
          break;

        case 'save':
          // User pressed Cmd/Ctrl+S — extract SVG and save
          if (msg.xml) {
            // Request SVG export from draw.io
            iframe.contentWindow.postMessage(
              JSON.stringify({
                action: 'export',
                format: 'xmlsvg',
                spin: 'Saving...',
              }),
              '*',
            );
          }
          break;

        case 'export':
          // Received exported SVG data
          if (msg.data) {
            // msg.data is the SVG string (data URL or raw SVG)
            let svg = msg.data;
            // If it's a data URL, extract the SVG content
            if (svg.startsWith('data:image/svg+xml;base64,')) {
              svg = atob(svg.replace('data:image/svg+xml;base64,', ''));
            } else if (svg.startsWith('data:image/svg+xml,')) {
              svg = decodeURIComponent(svg.replace('data:image/svg+xml,', ''));
            }
            onSave(svg);
            setHasChanges(false);
          }
          break;

        case 'exit':
          // User pressed Escape or clicked "Close"
          handleClose();
          break;

        // Clipboard proxy from iframe
        case 'clipboard':
          handleClipboardFromIframe(msg);
          break;
      }
    },
    [onSave, handleClose],
  );

  // Clipboard proxy: iframe → system clipboard
  const handleClipboardFromIframe = useCallback(async (msg: any) => {
    if (msg.type === 'copy' && msg.data) {
      if (typeof msg.data === 'string' && msg.data.length <= CLIPBOARD_SIZE_LIMIT) {
        try {
          await navigator.clipboard.writeText(msg.data);
        } catch {
          // Clipboard API not available or denied
        }
      }
    }
  }, []);

  // Clipboard proxy: system clipboard → iframe (paste)
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      // Only proxy paste when the draw.io modal is active
      // Check if the iframe or modal is focused
      if (!document.querySelector('.drawio-modal-overlay')) return;

      const text = e.clipboardData?.getData('text/plain');
      if (text && text.length <= CLIPBOARD_SIZE_LIMIT) {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'clipboard',
            type: 'paste',
            data: text,
          }),
          '*',
        );
      }
    },
    [],
  );

  // Wire up event listeners
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    document.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('paste', handlePaste);
    };
  }, [handleMessage, handlePaste]);

  // ESC key handler (modal level, in case draw.io doesn't send exit)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    // Use capture phase so we get it before other handlers
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [handleClose]);

  // Trigger save from the toolbar button
  const handleSaveClick = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    // Tell draw.io to export as SVG
    iframe.contentWindow.postMessage(
      JSON.stringify({
        action: 'export',
        format: 'xmlsvg',
        spin: 'Saving...',
      }),
      '*',
    );
  }, []);

  // The iframe URL with embed mode parameters
  // dev=1 tells draw.io to skip App.loadScripts() — we load shapes/stencils/extensions
  // statically in embed.html since the bundled app.min.js doesn't include mxscript().
  const iframeSrc = '/drawio/embed.html?embed=1&proto=json&spin=1&stealth=1&configure=1&math=0&dev=1';

  return createPortal(
    <div className="drawio-modal-overlay">
      <div className="drawio-modal-toolbar">
        <span className="drawio-modal-title">draw.io Editor</span>
        <div className="drawio-modal-actions">
          <button
            className="drawio-modal-btn drawio-modal-save"
            onClick={handleSaveClick}
            title="Save (Cmd/Ctrl+S)"
            disabled={!hasChanges}
          >
            Save
          </button>
          <button
            className="drawio-modal-btn drawio-modal-close"
            onClick={handleClose}
            title="Close (Escape)"
          >
            &times;
          </button>
        </div>
      </div>

      {loading && (
        <div className="drawio-modal-loading">
          <div className="drawio-modal-spinner" />
          <span>Loading editor...</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="drawio-modal-iframe"
        sandbox="allow-scripts"
        title="draw.io editor"
        style={{ opacity: loading ? 0 : 1 }}
      />
    </div>,
    document.body,
  );
}
