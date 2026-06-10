## Context

Kalepin is a collaborative markdown editor with a NestJS backend, SQLite database (TypeORM), and a storage abstraction layer (`StorageAdapter`) for file operations. Authentication uses JWT via magic links. There is no search capability today — files are accessed by exact path only.

The MCP (Model Context Protocol) is an open standard for connecting AI models to external tools and data sources. MCP clients (Claude Desktop, Cursor, etc.) discover and call tools/resources exposed by MCP servers over stdio or HTTP+SSE transport.

## Goals / Non-Goals

**Goals:**
- Enable LLMs to search, read, create, edit, and delete Kalepin notes via MCP
- Add full-text search over all markdown notes using SQLite FTS5
- Provide API key auth for programmatic access (MCP and future integrations)
- Keep the MCP server as a thin adapter over existing backend APIs

**Non-Goals:**
- Real-time collaborative editing via MCP (OT/WebSocket) — request/response only
- Semantic/embedding-based search — FTS5 is sufficient; LLMs handle disambiguation
- Multi-tenant MCP server — single Kalepin instance per MCP server
- MCP server serving static assets or attachments (binary files)

## Decisions

### 1. MCP server as a separate package (`packages/mcp-server`)

**Decision**: Standalone TypeScript package in the monorepo, communicating with the backend via its REST API.

**Alternatives considered**:
- *Embedded in NestJS backend as a module*: Tighter coupling, harder to run independently, mixes transport concerns (HTTP+WS+stdio). MCP servers are typically lightweight standalone processes.
- *Separate repo*: Unnecessary overhead for a tightly related project.

**Rationale**: The MCP SDK expects a standalone process (stdio transport for local use, HTTP+SSE for remote). A separate package keeps concerns clean while sharing types via `@kalepin/shared`.

### 2. FTS5 search in the backend, not the MCP server

**Decision**: Full-text search is a backend capability (new `SearchModule`) with a REST endpoint. The MCP server calls this endpoint like any other.

**Rationale**: Search benefits all clients (frontend could use it too), not just MCP. Putting it in the backend keeps data access centralized through the existing storage layer.

### 3. FTS5 index management via file lifecycle hooks

**Decision**: Index documents on create/save/delete events. Re-index on file watcher events for external changes. The FTS table stores `path`, `title` (first heading or filename), and `content`.

**Alternatives considered**:
- *Periodic full re-index*: Simpler but wasteful and stale between runs.
- *Lazy indexing on search*: Too slow for the first search.

**Rationale**: Event-driven indexing keeps the index fresh with minimal overhead. The file watcher already exists for the OT system.

### 4. API key auth as a new guard alongside JWT

**Decision**: Add an `ApiKey` entity and an `ApiKeyAuthGuard` that checks the `Authorization: Bearer kp_...` header. The existing `JwtAuthGuard` remains unchanged. A combined guard accepts either JWT or API key.

**Alternatives considered**:
- *Reuse JWT with long-lived tokens*: JWTs are meant to expire; long-lived JWTs are an anti-pattern for revocation.
- *OAuth2*: Overkill for a personal/small-team tool.

**Rationale**: API keys are simple, revocable, and familiar. The `kp_` prefix makes them identifiable. Keys are hashed (SHA-256) before storage.

### 5. Stdio transport for MCP (with HTTP+SSE optional later)

**Decision**: Start with stdio transport — the standard for local MCP servers configured in Claude Desktop / Cursor.

**Rationale**: Most MCP clients use stdio. HTTP+SSE can be added later for remote access scenarios without changing the tool/resource definitions.

### 6. Architecture overview

```
┌──────────────────────────────────────────────────┐
│  MCP Client (Claude Desktop, Cursor, etc.)       │
└──────────────┬───────────────────────────────────┘
               │ stdio (JSON-RPC)
               ▼
┌──────────────────────────────────────────────────┐
│  packages/mcp-server                             │
│  ┌────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Tools      │  │Resources │  │ Prompts     │  │
│  │ search     │  │note://   │  │ summarize   │  │
│  │ read/write │  │tree://   │  │ review      │  │
│  │ comments   │  │          │  │             │  │
│  └─────┬──────┘  └────┬─────┘  └─────────────┘  │
│        │              │                           │
│        └──────┬───────┘                           │
│               │ HTTP (REST API)                   │
└───────────────┼──────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────┐
│  packages/backend (NestJS)                       │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Files    │ │ Comments │ │ Search (new)   │   │
│  │ Service  │ │ Service  │ │ FTS5 + BM25    │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
│  ┌──────────┐ ┌──────────────────────────────┐   │
│  │ Auth     │ │ Storage Adapter              │   │
│  │ JWT+API  │ │ (local FS / Git)             │   │
│  └──────────┘ └──────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐    │
│  │ SQLite (users, sessions, ot_history,     │    │
│  │          api_keys, notes_fts)            │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[FTS5 index drift]** → If file watcher misses events (e.g., bulk rename outside app), index becomes stale. Mitigation: add a `POST /api/search/reindex` admin endpoint for manual re-sync.
- **[API key security]** → API keys are long-lived credentials. Mitigation: hash before storage, support revocation, show key only once at creation time.
- **[MCP server depends on backend running]** → MCP server is a client of the backend API. If backend is down, MCP tools fail. Mitigation: clear error messages. This is acceptable — the backend is the source of truth.
- **[FTS5 content duplication]** → FTS5 stores a copy of note content in SQLite alongside the filesystem. Mitigation: for large vaults this adds storage overhead, but markdown notes are small. Can use `content=` option to make FTS5 contentless if needed later.
