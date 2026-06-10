## Context

Kalepin uses TipTap 3.20 (ProseMirror) with React 19. Images are handled by the `ImageWithAttachments` extension with a custom NodeView providing hover actions (maximize, download). Attachments are stored in `_attachments/` with content-addressed naming (SHA256 hash + extension). SVG is already a supported MIME type. Mermaid diagrams use a custom CodeBlockLowlight extension with React NodeView — the draw.io editor follows a different pattern since draw.io diagrams are stored as SVG image files, not code blocks.

Notes are stored as markdown on disk and must remain Obsidian-compatible. Multiple users create diagrams in draw.io's web app and need to view and edit them within Kalepin.

## Goals / Non-Goals

**Goals:**
- Render draw.io SVG diagrams inline as images with an "Edit in draw.io" action
- Provide a fullscreen modal editor using draw.io's own JS, sandboxed for security
- Detect raw draw.io XML in code blocks and guide users to the SVG export workflow
- Keep draw.io JS lazy-loaded and network-isolated
- Maintain Obsidian compatibility (standard SVGs with embedded draw.io metadata)

**Non-Goals:**
- Replacing Mermaid — Mermaid remains the tool for simple text-defined diagrams
- Real-time collaborative diagram editing
- draw.io cloud features (cloud storage, templates, sharing)
- Auto-converting existing raw XML notes to SVG — users re-export once, guided by a hint
- Supporting `.drawio` files as a separate file type — everything is SVG

## Decisions

### 1. Vendored draw.io JS, pinned to a specific release

**Choice**: Vendor `app.min.js` and required assets from a specific tagged release of `jgraph/drawio` (Apache 2.0). Store in the repo under `packages/frontend/public/drawio/` (or similar static assets path). Lazy-load only when the editor modal opens.

**Alternatives considered**:
- *External embed via `embed.diagrams.net`*: Sends diagram content through third-party infrastructure. Unacceptable for internal architecture diagrams (SSO flows, etc.). CSP would need to allow-list an external domain.
- *Self-hosted draw.io Docker container*: Adds operational complexity (second container, extra port/routing). User explicitly wants a single-container deployment.

**Rationale**: Vendoring gives full control — no network dependency, no supply chain surprises, auditable JS. The ~5MB cost is acceptable since it's lazy-loaded. Update cycle is deliberate (2-3x/year), not automatic.

### 2. Sandboxed iframe with `sandbox="allow-scripts"` only — no `allow-same-origin`

**Choice**: The draw.io editor runs in an iframe with `sandbox="allow-scripts"`. No `allow-same-origin`.

**Alternatives considered**:
- *`allow-same-origin`*: Enables clipboard API and localStorage directly, fewer quirks. But allows iframe JS to access parent's cookies, storage, and auth tokens if on the same origin. Unacceptable.
- *Different-origin iframe*: Serving draw.io assets from a subdomain would make `allow-same-origin` safe. Adds routing complexity and deployment configuration.

**Rationale**: `allow-scripts` only is the strictest viable sandbox. It blocks DOM access, cookie/storage access, and navigation. The clipboard and keyboard shortcut gaps are closed via postMessage proxying (see decisions 4 and 5).

### 3. CSP with `connect-src: 'none'` on the iframe

**Choice**: The iframe's HTML includes a Content-Security-Policy meta tag: `default-src 'self' blob: data:; script-src 'self'; connect-src 'none'; img-src 'self' blob: data:;`

**Rationale**: Even if `app.min.js` is compromised, the JS cannot make any network requests (fetch, XHR, WebSocket, beacon). Combined with the sandbox, a compromised editor can break itself but cannot exfiltrate diagram data. This is the key security guarantee that makes vendoring a third-party ~5MB JS blob acceptable.

### 4. Clipboard via postMessage proxy

**Choice**: Clipboard operations are mediated by Kalepin's parent window through postMessage:

- **Copy**: draw.io serializes selection → sends `{event: 'clipboard', type: 'copy', data: xmlString}` → Kalepin validates content is draw.io XML → writes to system clipboard via `navigator.clipboard.writeText()`
- **Paste**: Kalepin detects paste event when iframe has focus → reads system clipboard → validates/sanitizes content → sends `{event: 'clipboard', type: 'paste', data: sanitized}` to iframe → draw.io processes pasted shapes

**Alternatives considered**:
- *`allow-same-origin` for direct clipboard access*: Weakens sandbox (see decision 2)
- *No clipboard*: Unacceptable — users copy/paste shapes constantly

**Rationale**: The proxy is more secure than direct clipboard access because Kalepin validates every operation. Content that doesn't look like draw.io XML is rejected. Size limits can be enforced.

### 5. Keyboard shortcuts via postMessage coordination

**Choice**: The iframe captures all keyboard events. Specific combinations are forwarded to Kalepin:

- `Cmd/Ctrl+S` → postMessage to parent → Kalepin saves diagram SVG + note
- `Escape` → postMessage to parent → Kalepin closes editor modal
- All other shortcuts → handled by draw.io internally (undo, redo, select all, etc.)

**Rationale**: draw.io's embed protocol already supports save events. We wire Kalepin-level actions (save note, close modal) through the same channel. draw.io's internal shortcuts (Cmd+Z for undo, etc.) work naturally since the iframe has focus.

### 6. Storage as SVG in `_attachments/` with content-addressed naming

**Choice**: draw.io diagrams are stored as standard SVG files in `_attachments/`, using the same content-addressed naming as other attachments. The SVG contains draw.io XML in the root element's `content` attribute — this is draw.io's native SVG export format.

**Alternatives considered**:
- *Separate `.drawio` files*: Non-standard, wouldn't render as images in markdown, requires new file type handling
- *Inline XML in code blocks*: The current (bad) user workflow. XML is opaque and unrenderable.
- *Separate storage location*: Adds complexity for no benefit

**Rationale**: SVGs in `_attachments/` leverage the existing upload, serve, cleanup, and deduplication infrastructure. The SVG renders as an image everywhere (Kalepin, Obsidian, GitHub, browsers). The embedded draw.io XML is invisible metadata that only draw.io reads.

**Save-back flow**: When the editor saves, the SVG content changes, producing a new content hash. The flow is: write new SVG → update the markdown image reference → orphan cleanup handles the old file.

### 7. Fullscreen modal for editor UX

**Choice**: The draw.io editor opens in a fullscreen modal overlay (similar to the existing image maximize modal), not inline in the document.

**Alternatives considered**:
- *Inline editor replacing the image*: draw.io's editor needs substantial screen real estate for toolbars, shape libraries, canvas. An inline editor would be cramped and conflict with the surrounding document layout.

**Rationale**: draw.io diagrams are complex visual artifacts requiring a dedicated workspace. A fullscreen modal provides the space and focus needed. The existing image maximize pattern provides a precedent for fullscreen overlays in Kalepin.

### 8. Detection of draw.io content

**Choice**: Two detection mechanisms:

- **Code blocks**: Scan text content for `<mxfile` or `<mxGraphModel` tags. Show an inline hint banner.
- **SVG images**: When rendering an SVG attachment, parse it and check for a `content` attribute on the root `<svg>` element containing mxGraphModel data. Show a draw.io badge and "Edit" action.

**Rationale**: Code block detection guides users away from the raw XML paste workflow. SVG detection enables the edit action on properly exported diagrams.

### 9. Font handling

**Choice**: Vendor the most common Google Fonts used by draw.io (if feasible and the set is small), otherwise accept system font fallback. No external font loading.

**Rationale**: `connect-src: 'none'` blocks Google Fonts CDN requests. Most diagrams use standard fonts. If a diagram uses an unusual font, the fallback is visually acceptable.

### 10. Images inside diagrams

**Choice**: Images inserted into draw.io diagrams are base64-encoded within the SVG. No external image references.

**Rationale**: This is rare but needs to work. Base64 embedding keeps the SVG self-contained and portable. The tradeoff is slightly larger SVG files, but since it's rare, the impact is negligible.

## Risks / Trade-offs

- **Bundle size**: Vendored draw.io JS adds ~5MB to static assets → Mitigated by lazy loading only when editor opens; not included in the main JS bundle
- **draw.io update maintenance**: Vendored JS must be updated manually → Deliberate 2-3x/year updates, diffed before acceptance. CSP blocks exfiltration even on stale versions, so delayed updates are a rendering bug risk, not a security risk
- **Clipboard proxy complexity**: postMessage clipboard is more complex than native clipboard → Well-defined protocol, draw.io's embed API supports it. Must be tested thoroughly across OS/browser combos
- **draw.io feature completeness**: Some draw.io features may not work in sandboxed mode (cloud storage, external images) → These are disabled via config. Core diagramming features (shapes, connectors, text, styling) are unaffected
- **SVG content hash changes on edit**: Each save produces a new filename → Existing note-update and orphan-cleanup mechanisms handle this, but the flow must be atomic (write new file → update reference → no dangling references)
