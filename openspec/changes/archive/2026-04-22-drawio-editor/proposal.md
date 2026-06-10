## Why

Multiple users create diagrams in draw.io as part of their daily work. Currently, they paste raw draw.io XML into code blocks, which renders as unreadable markup. These diagrams often contain complex flows (SSO architecture, internal systems) that cannot be reasonably recreated in Mermaid — draw.io supports arbitrary positioning, colors, shapes, and annotations that Mermaid's auto-layout cannot replicate.

Users need to both **view** draw.io diagrams inline in their notes and **edit** them without leaving Kalepin.

## What Changes

### Phase 1: Detection and guidance
- Code blocks containing `<mxfile>` or `<mxGraphModel>` XML show an inline hint: "This looks like a draw.io diagram. Export as SVG from draw.io for a rendered preview."
- draw.io SVGs (SVGs with a `content` attribute containing mxGraphModel data) uploaded as images display a "draw.io" badge on hover

### Phase 2: Embedded editor
- draw.io SVGs show an "Edit in draw.io" action button (alongside existing maximize/download actions)
- Clicking "Edit" opens a **fullscreen modal** with draw.io's editor running in a sandboxed iframe
- The editor uses a vendored, pinned version of draw.io's `app.min.js` — no external network dependency
- Clipboard operations (copy/paste) work via a postMessage proxy between iframe and parent
- Keyboard shortcuts (Cmd+S to save, Escape to close) are coordinated via postMessage
- On save, the updated SVG (with embedded draw.io XML) is written back to `_attachments/`; the markdown reference is updated if the content hash changes
- Unused draw.io features (cloud storage, external image loading, sharing) are disabled via draw.io's configuration parameters

### Phase 3: Diagram creation
- A `/drawio` slash command creates a new empty draw.io SVG in `_attachments/` and immediately opens the editor modal

## Security Model

- **Sandboxed iframe**: `sandbox="allow-scripts"` only — no `allow-same-origin`
- **CSP on iframe**: `connect-src: 'none'` — the editor JS cannot make any network requests, even if compromised
- **Clipboard proxy**: all clipboard operations mediated by Kalepin via postMessage; content is validated and sanitized before passing to/from the iframe
- **Vendored JS**: `app.min.js` pinned to a specific draw.io release, stored in the repo. Updates are deliberate (2-3x/year), diffed before acceptance
- **PostMessage validation**: Kalepin only accepts well-formed SVG responses from the iframe; rejects anything else
- **Fonts**: common Google Fonts vendored locally or system font fallback; no external font loading

Even a fully compromised `app.min.js` cannot exfiltrate data (network blocked by CSP) or access Kalepin's DOM/storage (blocked by sandbox). The worst case is a broken editor, not a data leak.

## Capabilities

### New Capabilities
- `drawio-detect`: Detection of draw.io XML in code blocks with migration hint
- `drawio-badge`: Badge and edit action on draw.io SVG images
- `drawio-editor`: Fullscreen modal editor with sandboxed iframe, postMessage clipboard/keyboard proxy
- `drawio-create`: Slash command to create new draw.io diagrams

### Modified Capabilities
- `attachments`: SVG save-back flow (write updated SVG, update markdown reference on hash change)
- `editor`: Registers draw.io detection and badge extensions
- `editor-context-menu`: Adds `/drawio` slash command

## Impact

- **Frontend**: New extensions for detection, badge, editor modal; vendored draw.io JS (~5MB, lazy-loaded only when editor opens)
- **Backend**: Minor — attachment save-back endpoint (update existing attachment + update note reference)
- **New dependency**: Vendored `app.min.js` from jgraph/drawio (Apache 2.0), pinned to a specific release
- **Storage**: draw.io diagrams stored as SVGs in `_attachments/` — same as regular images. The SVG is valid and renders everywhere; draw.io XML is embedded metadata.
- **Obsidian compatibility**: draw.io SVGs are standard SVGs with embedded metadata. Obsidian renders them as images natively. Obsidian's draw.io plugin can detect the `content` attribute and open them for editing.
- **Images inside diagrams**: Rare case handled via base64 embedding within the SVG (self-contained, no external references)

## Non-goals

- **Replacing Mermaid**: draw.io is for complex visual diagrams; Mermaid remains the right tool for simple text-defined diagrams
- **Real-time collaboration on diagrams**: Single-user editing only (same as Mermaid blocks today)
- **draw.io cloud features**: No integration with draw.io's cloud storage, templates library, or sharing — the editor is a local-only tool
- **Auto-converting XML to SVG**: Users with existing raw XML notes need to re-export from draw.io once; we show them a hint, not an auto-migration
