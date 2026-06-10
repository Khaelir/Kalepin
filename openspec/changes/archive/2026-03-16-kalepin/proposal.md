# Kalepin

## Summary

Kalepin is an open-source (MIT), self-hosted collaborative markdown workspace that replaces Microsoft Loop. Files are stored as plain markdown on disk — openable in Obsidian, vim, or any text editor. Real-time multi-user editing via Operational Transform, threaded comments via sidecar files, slash commands for quick content generation, and a hierarchical file tree sidebar.

Deployed as a single Docker container. Backend in NestJS, frontend in React + Vite with the claude-code frontend-design plugin for distinctive UI.

## Problem

Microsoft Loop is proprietary, cloud-only, and locks content into a format that can't be opened elsewhere. The team needs a collaborative writing tool where the files remain portable, self-hosted, and compatible with tools like Obsidian.

## Solution

A web application with three packages in a monorepo:

- **Backend** (NestJS) — OT server, file management, auth, comments, WebSocket transport
- **Frontend** (React + Vite + TipTap) — Rich markdown editor with slash commands, file tree, comments panel, presence indicators
- **Obsidian Plugin** — Reads `.collab` sidecar files to display comments natively in Obsidian

## Core decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Collaboration model | Operational Transform (hand-written, ~200 lines) | Well-understood algorithm, no black-box dependency, full control |
| Source of truth | Markdown files on disk | Obsidian compatibility, portability, no vendor lock-in |
| Comments storage | Sidecar files (`.filename.md.collab`) | No markdown pollution, dot-prefixed so hidden in file browsers, ignored by Obsidian |
| Comment anchoring | Invisible HTML comments (`<!-- bid:xx -->`) | Invisible in rendered markdown and Obsidian preview, stable anchors |
| External edit handling | Reload with toast notification ("File changed externally") | Simple, honest, no data loss. Merge strategy deferred to v2 |
| Git adapter commit strategy | Batch — commit on document session close, debounced write to disk in between | Clean git history without noise |
| Auth | Magic link via Mailjet SMTP + JWT (configurable expiry) + domain allowlist | No passwords, simple for 10-20 people |
| Database | SQLite via TypeORM | Zero-config, Docker-friendly, sufficient for 20 users |
| WebSocket | `ws` (native) + small reconnect wrapper | No Socket.IO overhead, NestJS supports ws adapter natively |
| File watching | chokidar | Reliable cross-platform FS watching for external edit detection |
| Frontend design | claude-code frontend-design plugin | Distinctive, production-grade UI — no generic AI aesthetics |
| Obsidian plugin install | Auto-install toggle — app writes plugin files into `vault/.obsidian/plugins/` | Zero friction for team members |
| License | MIT | Open-source |

## Architecture

```
Browser (React + Vite)
├── File Tree Sidebar (drag/drop, search, context menu)
├── TipTap Editor (ProseMirror + OT client + slash commands)
├── Comments Panel (threaded, per-block)
└── Presence Indicators (avatar pills per document)
        │
        │ WebSocket (OT ops, comments, presence)
        │ REST (auth, file CRUD, tree operations)
        ▼
NestJS Backend
├── Auth Module (magic link, JWT, domain allowlist)
├── OT Module (transform, history, broadcast, flush to file)
├── File Module (CRUD, tree, move/copy, watch via chokidar)
├── Comment Module (CRUD, anchoring, .collab sidecar read/write)
├── Presence Module (track connected users per document)
│
├── Storage Adapter Interface
│   ├── LocalFSAdapter (covers local disk + NFS mounts)
│   └── GitAdapter (extends LocalFS + git add/commit on session close)
│
└── SQLite (TypeORM)
    ├── users, sessions, magic_link_tokens
    └── ot_operation_history (per-doc, prunable)

Docker: single container, 2 volumes
├── /data/vault (markdown files — bind mount or NFS)
└── /data/db (SQLite)
```

## Storage adapters (v1)

- **LocalFS** — `fs.*` operations, chokidar for watch. Covers both local bind mounts and NFS mounts (NFS is transparent at the filesystem API level, configuration is in docker-compose volume definition).
- **Git** — Extends LocalFS. Same read/list/watch. Write/delete/move additionally run `git add` + `git commit` on document session close. Exposes `history(path)` and `diff(path, rev1, rev2)`.

S3/MinIO and WebDAV deferred to v2.

## File on disk

```
vault/                              ← mountable as Obsidian vault
├── project/
│   ├── roadmap.md                  ← markdown content
│   └── .roadmap.md.collab          ← sidecar (comments, metadata)
├── meeting-notes/
│   ├── 2026-03-11.md
│   └── .2026-03-11.md.collab
└── .obsidian/
    └── plugins/
        └── kalepin-comments/       ← auto-installed plugin
            ├── main.js
            ├── manifest.json
            └── styles.css
```

## Slash commands (v1)

`/table`, `/task`, `/heading`, `/divider`, `/code`, `/callout`, `/link`

All render rich in the editor but serialize to pure markdown.

## Dependencies

**Backend (8 production deps):**
`@nestjs/{core,common,platform-express,websockets}`, `ws`, `better-sqlite3`, `jsonwebtoken`, `nodemailer`, `chokidar`

**Frontend (4 production deps):**
`react`, `react-dom`, `@tiptap/core`, `@tiptap/starter-kit`

**Hand-written (~1200 lines):**
OT engine, auth flow, WebSocket manager, storage adapters, comment engine, slash command registry, file tree API

## Monorepo structure

```
kalepin/
├── packages/
│   ├── backend/          NestJS
│   ├── frontend/         React + Vite
│   └── obsidian-plugin/  Obsidian plugin
├── docker-compose.yml
├── Dockerfile
├── LICENSE               MIT
└── README.md
```

## Non-goals (v1)

- Per-folder / per-file permissions (just domain-allowlist login for now)
- S3/MinIO or WebDAV storage adapters
- External edit merge (reload-only for now)
- Mobile-specific UI
- Plugin marketplace / extensibility API
- End-to-end encryption
