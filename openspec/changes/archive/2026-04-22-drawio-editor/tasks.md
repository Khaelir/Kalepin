## 1. Vendor draw.io assets

- [x] 1.1 Download `app.min.js` and required assets (CSS, resources) from a specific tagged release of `jgraph/drawio` (e.g., v29.6.10)
- [x] 1.2 Store vendored files under `packages/frontend/public/drawio/` (served as static assets, not bundled in the JS)
- [x] 1.3 Identify and vendor common Google Fonts used by draw.io, or document which fonts fall back to system fonts
- [x] 1.4 Verify vendored draw.io loads and runs correctly in an isolated test (standalone HTML page with sandboxed iframe)

## 2. draw.io XML detection in code blocks

- [x] 2.1 Create a TipTap extension or plugin that scans code block content for `<mxfile` or `<mxGraphModel` patterns
- [x] 2.2 When detected, render an informational banner above/inside the code block with SVG export guidance
- [x] 2.3 Style the banner (informational tone, not error — subtle background, icon, dismissible or persistent)

## 3. draw.io SVG detection in images

- [x] 3.1 Create a utility function `isDrawioSvg(svgContent: string): boolean` that parses SVG and checks for `content` attribute containing mxGraphModel/mxfile data
- [x] 3.2 In the `ImageWithAttachments` NodeView, after fetching an SVG blob, check if it's a draw.io SVG
- [x] 3.3 If draw.io SVG detected, add a "draw.io" badge and "Edit" action button to the hover action bar

## 4. Sandboxed iframe and postMessage protocol

- [x] 4.1 Create the iframe HTML template with: `sandbox="allow-scripts"`, CSP meta tag (`connect-src: 'none'`), draw.io JS loading, and `embed=1` configuration
- [x] 4.2 Implement the postMessage protocol handler on the Kalepin (parent) side: listen for `init`, `load`, `save`, `exit` events from draw.io
- [x] 4.3 Implement draw.io configuration to disable cloud storage, external images, sharing UI, and other unused features
- [x] 4.4 Implement diagram loading: on `init` event from draw.io, send the SVG data via `load` action

## 5. Clipboard postMessage proxy

- [x] 5.1 Implement copy proxy: listen for clipboard copy events from the iframe, validate content, write to system clipboard via `navigator.clipboard.writeText()`
- [x] 5.2 Implement paste proxy: detect paste events when iframe has focus, read system clipboard, validate/sanitize content, send to iframe via postMessage
- [x] 5.3 Add size limit validation on clipboard data to prevent abuse
- [x] 5.4 Test clipboard proxy across browsers (Chrome, Firefox, Safari) and OS (macOS, Windows)

## 6. Keyboard shortcut coordination

- [x] 6.1 Handle `save` event from draw.io embed protocol (triggered by Cmd/Ctrl+S) — extract updated SVG, trigger save flow
- [x] 6.2 Handle `exit` event from draw.io embed protocol (triggered by Escape) — close modal with unsaved changes prompt if needed
- [x] 6.3 Verify draw.io internal shortcuts (Cmd+Z, Cmd+A, Delete, etc.) work without interference

## 7. Fullscreen editor modal

- [x] 7.1 Create a React component for the fullscreen draw.io editor modal (similar to image maximize overlay)
- [x] 7.2 Modal contains: close button, save button, loading indicator, sandboxed iframe
- [x] 7.3 Implement modal open/close transitions and focus management
- [x] 7.4 Wire the "Edit" action button (from task 3.3) to open the modal with the diagram's SVG data
- [x] 7.5 Style the modal (fullscreen overlay, iframe sizing, toolbar)

## 8. Save flow and attachment update

- [x] 8.1 Implement save handler: receive updated SVG from iframe postMessage, send to backend
- [x] 8.2 Backend: add endpoint or extend existing upload to accept SVG content update — write new content-addressed file, return new filename
- [x] 8.3 Frontend: update the TipTap image node's `src` attribute to point to the new filename after save
- [x] 8.4 Handle edge case: save with no changes (content hash unchanged) — skip write and reference update
- [x] 8.5 Verify orphan cleanup correctly handles the old SVG file after reference update

## 9. /drawio slash command

- [x] 9.1 Add `/drawio` entry to `slash-commands.ts` — creates empty draw.io SVG, inserts image reference, opens editor modal
- [x] 9.2 Define the empty draw.io SVG template (valid SVG with empty mxGraphModel in `content` attribute)
- [x] 9.3 Handle cancel-without-save: clean up the empty SVG and remove the inserted image reference

## 10. Testing and hardening

- [x] 10.1 Test sandboxed iframe cannot access parent DOM, cookies, or storage
- [x] 10.2 Test CSP blocks network requests from inside the iframe (fetch, XHR, WebSocket)
- [x] 10.3 Test clipboard proxy works for copy/paste of shapes, text labels, and mixed content
- [x] 10.4 Test save flow: new file created, reference updated, old file orphaned and cleaned
- [x] 10.5 Test Obsidian compatibility: SVG produced by Kalepin's draw.io editor is viewable in Obsidian and editable by Obsidian's draw.io plugin
- [x] 10.6 Test draw.io SVG with base64-embedded images renders correctly and survives edit round-trip
