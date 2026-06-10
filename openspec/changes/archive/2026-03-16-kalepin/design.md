## Context

Kalepin is a greenfield collaborative markdown workspace — a self-hosted, open-source alternative to Microsoft Loop. There is no existing codebase; the entire system will be built from scratch as a monorepo with three packages (backend, frontend, obsidian-plugin).

The system targets small teams (10-20 users) who want real-time collaborative editing while keeping files as portable plain markdown on disk, compatible with Obsidian and other editors.

Key constraints:
- Single Docker container deployment (simple ops for self-hosters)
- SQLite — no external database dependency
- Minimal production dependencies (8 backend, 4 frontend)
- Hand-written OT engine (~200 lines) — no CRDT library, full control
- Files on disk are the source of truth, not the database

## Goals / Non-Goals

**Goals:**
- Real-time multi-user collaborative editing of markdown documents
- Plain markdown files on disk, readable by any editor including Obsidian
- Threaded comments via sidecar files (no markdown pollution)
- File tree management (create, rename, move, delete, drag/drop)
- Magic-link auth with domain allowlist
- Pluggable storage adapters (LocalFS and Git for v1)
- Single `docker compose up` deployment
- Obsidian plugin that surfaces comments from sidecar files

**Non-Goals:**
- Per-file/folder permissions (domain allowlist only for v1)
- S3/MinIO/WebDAV storage adapters (v2)
- External edit merge (reload with toast for v1)
- Mobile-specific UI
- Plugin marketplace / extensibility API
- End-to-end encryption
- Offline editing / conflict-free offline sync

## Decisions

### 1. Monorepo with shared TypeScript

**Choice:** Single repo with `packages/{backend,frontend,obsidian-plugin}`, managed with npm workspaces.

**Rationale:** Shared types (OT operations, WebSocket message schemas, comment models) between frontend and backend without publishing packages. Simple CI — one repo, one Docker build.

**Alternatives considered:**
- Separate repos: Rejected — shared types become a versioning headache for a small team project.
- Turborepo/Nx: Overkill for 3 packages. npm workspaces are sufficient.

### 2. Hand-written OT over CRDT

**Choice:** Custom Operational Transform engine (~200 lines) handling text insert, delete, and retain operations.

**Rationale:** OT is well-understood for text editing, the server is authoritative (single server, no P2P), and hand-writing it avoids a black-box dependency. With a single server and SQLite, the centralized OT model is a natural fit. CRDTs solve a distributed problem we don't have.

**Alternatives considered:**
- Yjs (CRDT): More complex, designed for decentralized/P2P scenarios. Adds a significant dependency. Metadata overhead in document storage.
- ShareDB: Brings in MongoDB as a dependency. Heavier than needed.

### 3. TipTap (ProseMirror) editor with custom OT bridge

**Choice:** TipTap as the rich text editor, with a custom plugin that sends ProseMirror transactions as OT operations over WebSocket.

**Rationale:** TipTap provides a high-quality editing UX with slash commands, markdown serialization, and extensibility. The bridge layer translates ProseMirror steps into OT ops (insert/delete/retain) and applies remote ops back as ProseMirror transactions.

**Alternatives considered:**
- CodeMirror: Better for code, worse for rich text/slash commands.
- Lexical: Younger ecosystem, less community tooling for markdown.
- Milkdown: Smaller community, less extensible.

### 4. WebSocket with native `ws` library

**Choice:** Native `ws` library with a thin reconnect/heartbeat wrapper. NestJS WebSocket gateway with `ws` adapter.

**Rationale:** Socket.IO adds unnecessary overhead (HTTP long-polling fallback, room abstraction, custom protocol). We need one channel per document for OT ops, comments, and presence — a simple WebSocket with JSON messages is sufficient.

**Message protocol:**
```
{ type: "op", docId, ops: [...], rev: N }
{ type: "ack", docId, rev: N }
{ type: "presence", docId, userId, cursor, selection }
{ type: "comment:new", docId, comment: {...} }
{ type: "comment:update", docId, comment: {...} }
{ type: "comment:delete", docId, commentId }
{ type: "file:changed", path }
```

### 5. Sidecar files for comments

**Choice:** `.filename.md.collab` JSON sidecar files, dot-prefixed.

**Rationale:** Comments must not pollute the markdown file. Sidecar files are invisible in file browsers (dot prefix), ignored by Obsidian's markdown parser, and can be read by the Obsidian plugin. Anchoring uses invisible HTML comments (`<!-- bid:xx -->`) in the markdown — these render as nothing in any markdown viewer.

**Sidecar format:**
```json
{
  "comments": {
    "bid:1": {
      "threads": [{
        "id": "t1",
        "comments": [
          { "id": "c1", "author": "user@domain.com", "text": "...", "createdAt": "..." }
        ],
        "resolved": false
      }]
    }
  }
}
```

### 6. Storage adapter pattern

**Choice:** `StorageAdapter` interface with `LocalFSAdapter` and `GitAdapter` implementations. Configured via environment variable.

**Rationale:** Decouples file operations from the business logic. LocalFS covers local bind mounts and NFS (transparent at the FS API level). Git extends LocalFS by adding `git add` + `git commit` on document session close.

**Interface:**
```typescript
interface StorageAdapter {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(src: string, dest: string): Promise<void>;
  list(dir: string): Promise<FileEntry[]>;
  watch(callback: (event: FileChangeEvent) => void): void;
  // Git-only extensions
  history?(path: string): Promise<Commit[]>;
  diff?(path: string, rev1: string, rev2: string): Promise<string>;
}
```

### 7. Auth flow — magic link + JWT

**Choice:** Passwordless magic-link auth via email (Mailjet SMTP), JWT for session tokens, domain allowlist for access control.

**Rationale:** No passwords to manage, simple for small teams. Domain allowlist (e.g., `@company.com`) controls who can log in. JWT tokens are stateless; refresh handled by configurable expiry.

**Flow:**
1. User enters email → backend checks domain allowlist
2. Backend sends magic link (JWT with short expiry) via Mailjet
3. User clicks link → backend validates token, issues session JWT
4. Frontend stores JWT, sends in WebSocket upgrade header and REST Authorization header

### 8. SQLite via TypeORM

**Choice:** SQLite with TypeORM, stored in a Docker volume at `/data/db`.

**Rationale:** Zero-config, no external database service, sufficient for 20 concurrent users. Stores users, sessions, magic link tokens, and OT operation history (prunable).

**Alternatives considered:**
- PostgreSQL: Requires a separate container, overkill for 20 users.
- Prisma: Heavier migration tooling, less control.
- Raw SQL: TypeORM provides just enough convenience without heavy abstraction.

### 9. External edit detection — reload with toast

**Choice:** chokidar watches the vault directory. When a file changes on disk while a document is open, the server broadcasts a `file:changed` event. The client shows a toast notification and reloads the document content.

**Rationale:** Merging external edits with in-flight OT operations is complex and error-prone. For v1, reloading is honest — no data loss, no silent corruption. Users who edit in Obsidian and the browser simultaneously will see a clear reload prompt.

### 10. Docker — single container, 2 volumes

**Choice:** One Dockerfile with a multi-stage build. Backend serves the frontend's static assets. Two Docker volumes: `/data/vault` (markdown files) and `/data/db` (SQLite).

**Rationale:** Simplest deployment story. No reverse proxy config, no separate frontend container. `docker compose up` and it works.

## Risks / Trade-offs

**[OT correctness]** → Hand-written OT engine could have edge-case bugs in concurrent editing.
→ Mitigation: Keep the OT engine minimal (insert/delete/retain only). Extensive unit tests with randomized concurrent operation sequences. OT history stored in SQLite for replay/debugging.

**[Single-server OT]** → Cannot horizontally scale. One server handles all OT sessions.
→ Mitigation: Acceptable for target audience (10-20 users). SQLite is also single-writer. If scaling is needed later, the OT module can be extracted to a separate process.

**[SQLite write contention]** → Under concurrent OT operations, SQLite WAL mode may bottleneck.
→ Mitigation: OT operations are batched (debounced flush to disk/DB). WAL mode enabled by default. 20 users is well within SQLite's comfortable range.

**[Sidecar file sync]** → If a markdown file is moved externally, the sidecar file won't follow.
→ Mitigation: Moves through the app keep sidecar files in sync. Document this limitation for external moves. V2 could add sidecar reconciliation.

**[Magic link email delivery]** → Email delivery can be unreliable (spam filters, delays).
→ Mitigation: Mailjet has good deliverability. Backend logs magic link URLs for self-hosters who want to debug. Could add backup SMTP provider in config.

**[TipTap ↔ OT bridge complexity]** → Mapping ProseMirror transactions to OT operations and back is the most complex integration point.
→ Mitigation: Constrain to plain text operations in the OT layer. Rich formatting is ProseMirror-only; OT handles the text content. This reduces the bridge surface area.

## Resolved Questions

1. **OT operation granularity**: Batch at the ProseMirror transaction level. Transactions are typically a few keystrokes and fire within ~2 seconds — granular enough to feel live without per-keystroke overhead. If this proves too coarse, switch to 1:1 keystroke mapping.

2. **Session close definition for Git adapter**: Both — commit when the last user disconnects from a document AND on inactivity timeout (e.g., 5 minutes of no edits). Whichever fires first.

3. **Obsidian plugin distribution**: Auto-install only for v1. The app writes plugin files directly into `vault/.obsidian/plugins/kalepin-comments/`.