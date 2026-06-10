## 1. Project Setup

- [x] 1.1 Initialize monorepo with npm workspaces (`packages/backend`, `packages/frontend`, `packages/obsidian-plugin`)
- [x] 1.2 Set up NestJS backend with TypeScript config, ESLint, and `ws` adapter
- [x] 1.3 Set up React + Vite frontend with TypeScript config
- [x] 1.4 Create shared types package or shared directory for OT operations, WebSocket message schemas, and common models
- [x] 1.5 Create Dockerfile (multi-stage build) and docker-compose.yml with `/data/vault` and `/data/db` volumes
- [x] 1.6 Set up SQLite + TypeORM with initial entities (users, sessions, magic_link_tokens, ot_operation_history)

## 2. Storage Adapters

- [x] 2.1 Define `StorageAdapter` interface (read, write, delete, move, list, watch)
- [x] 2.2 Implement `LocalFSAdapter` with fs operations and chokidar file watching
- [x] 2.3 Implement `GitAdapter` extending LocalFS — `git add` + `git commit` on session close (last disconnect OR 5-min inactivity), plus `history()` and `diff()` methods
- [x] 2.4 Add adapter selection via `STORAGE_ADAPTER` env variable (default: LocalFS)

## 3. Auth Module

- [x] 3.1 Create auth module with domain allowlist configuration (env variable)
- [x] 3.2 Implement magic link endpoint — validate email domain, generate short-lived JWT, send via Mailjet SMTP (nodemailer)
- [x] 3.3 Implement magic link verification endpoint — validate token, issue session JWT, redirect to workspace
- [x] 3.4 Add JWT auth guard for REST endpoints (Authorization header)
- [x] 3.5 Add JWT auth guard for WebSocket upgrade requests

## 4. File Management Module

- [x] 4.1 Create file module with REST endpoints for file CRUD (create, read, delete)
- [x] 4.2 Add directory management endpoints (create, delete recursive with confirmation)
- [x] 4.3 Implement file/directory move and rename — ensure sidecar files follow
- [x] 4.4 Add file tree listing endpoint (recursive, excluding dot-prefixed files)
- [x] 4.5 Implement external edit detection via chokidar — broadcast `file:changed` WebSocket event for open documents, update file tree for all clients on create/delete

## 5. OT Collaboration Module

- [x] 5.1 Implement OT engine core — insert, delete, retain operations with transform function (~200 lines)
- [x] 5.2 Create OT document session manager — track active documents, connected clients, and current document state in memory
- [x] 5.3 Implement WebSocket gateway for OT — handle `op` messages, transform against concurrent ops, broadcast, send `ack`
- [x] 5.4 Add OT operation history persistence to SQLite (per-document, with revision tracking)
- [x] 5.5 Implement debounced flush to disk — write document state to markdown file on disk every 2-5 seconds of inactivity
- [x] 5.6 Implement session close logic — flush to disk and trigger Git adapter commit when last user disconnects or inactivity timeout fires

## 6. Comments Module

- [x] 6.1 Implement sidecar file read/write — `.{filename}.collab` JSON format with threaded comments keyed by block anchor ID
- [x] 6.2 Create comment CRUD endpoints — add comment (insert `<!-- bid:xx -->` anchor if needed), reply to thread, delete own comment
- [x] 6.3 Implement comment resolution — resolve/unresolve thread, update sidecar file
- [x] 6.4 Add WebSocket broadcasting for comment events (`comment:new`, `comment:update`, `comment:delete`)
- [x] 6.5 Load comments from sidecar on document open and send to client

## 7. Presence Module

- [x] 7.1 Track connected users per document — add on WebSocket connect, remove on disconnect
- [x] 7.2 Broadcast presence updates (join/leave) to all clients viewing the same document
- [x] 7.3 Handle cursor position and text selection sharing via `presence` WebSocket messages

## 8. Frontend — Editor

- [x] 8.1 Set up TipTap editor with starter-kit extensions (headings, bold, italic, lists, code blocks, links, blockquotes)
- [x] 8.2 Implement TipTap ↔ OT bridge — convert ProseMirror transactions to OT operations (insert/delete/retain) and apply remote ops as ProseMirror transactions
- [x] 8.3 Create WebSocket client with reconnect and heartbeat wrapper
- [x] 8.4 Implement slash command registry and dropdown UI — `/table`, `/task`, `/heading`, `/divider`, `/code`, `/callout`, `/link`
- [x] 8.5 Ensure all slash command outputs render rich in editor but serialize to pure markdown

## 9. Frontend — File Tree Sidebar

- [x] 9.1 Build hierarchical file tree component with expand/collapse, file icons, and active file highlighting
- [x] 9.2 Implement drag-and-drop for moving files/directories
- [x] 9.3 Add context menu (right-click) — rename, delete, new file, new folder
- [x] 9.4 Add file tree search/filter input

## 10. Frontend — Comments Panel

- [x] 10.1 Build comments panel component — display threaded comments grouped by block anchor, resolved threads collapsed
- [x] 10.2 Implement add comment, reply, resolve/unresolve, and delete interactions
- [x] 10.3 Add click-to-navigate — clicking a comment scrolls editor to the anchored block
- [x] 10.4 Wire comments panel to WebSocket for real-time updates

## 11. Frontend — Presence & Auth

- [x] 11.1 Build avatar pills component showing users currently viewing the document
- [x] 11.2 Render remote cursors and selections in the editor with user colors
- [x] 11.3 Build login page — email input, magic link sent confirmation, error states
- [x] 11.4 Implement JWT storage and automatic inclusion in REST and WebSocket requests

## 12. Frontend — Layout & Design

- [x] 12.1 Design and build the main workspace layout — sidebar, editor area, comments panel (use frontend-design plugin for distinctive UI)
- [x] 12.2 Style all components with a cohesive design system — colors, typography, spacing, transitions
- [x] 12.3 Add toast notification system (for external file changes, errors, etc.)

## 13. Obsidian Plugin

- [x] 13.1 Create Obsidian plugin scaffold (`main.ts`, `manifest.json`, `styles.css`)
- [x] 13.2 Implement sidecar file reader — detect `.collab` files and parse comment data
- [x] 13.3 Render comment indicators in the Obsidian editor next to anchored blocks
- [x] 13.4 Build comment thread popover — show full thread on click (author, text, timestamp, resolved status)
- [x] 13.5 Implement auto-install logic on backend — write plugin files to `vault/.obsidian/plugins/kalepin-comments/` on server start if `.obsidian/` exists

## 14. Integration & Docker

- [x] 14.1 Wire backend to serve frontend static assets (Vite build output)
- [x] 14.2 Finalize Dockerfile — multi-stage build (install deps, build frontend, build backend, runtime image)
- [x] 14.3 Add environment variable documentation and defaults (STORAGE_ADAPTER, MAILJET_*, JWT_EXPIRY, DOMAIN_ALLOWLIST, etc.)
- [x] 14.4 End-to-end smoke test — docker compose up, login, create file, edit collaboratively, add comment, verify on disk
