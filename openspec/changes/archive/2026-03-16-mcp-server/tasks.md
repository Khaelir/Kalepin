## 1. Full-Text Search (Backend)

- [x] 1.1 Create `SearchModule` with `SearchService` in `packages/backend/src/search/`
- [x] 1.2 Create FTS5 virtual table (`notes_fts`) with columns: `path`, `title`, `content` — using raw SQL via TypeORM DataSource (FTS5 tables aren't standard entities)
- [x] 1.3 Implement `indexNote(path, content)` — extracts title from first heading or filename, upserts into FTS5 table
- [x] 1.4 Implement `removeNote(path)` — deletes entry from FTS5 table
- [x] 1.5 Implement `search(query)` — FTS5 MATCH query with BM25 ranking, returns `{ path, snippet, score }[]`
- [x] 1.6 Implement `reindexAll()` — scans all `.md` files via StorageAdapter, rebuilds entire FTS5 index
- [x] 1.7 Hook into file lifecycle: call `indexNote` on file create/update, `removeNote` on file delete (integrate with `FilesService` and file watcher events)
- [x] 1.8 Create `SearchController` with `GET /api/files/search?q=...` and `POST /api/search/reindex` endpoints
- [x] 1.9 Run initial full index on app startup (if FTS5 table is empty)

## 2. API Key Authentication (Backend)

- [x] 2.1 Create `ApiKey` entity with columns: `id`, `name`, `keyHash` (SHA-256), `userId`, `createdAt`
- [x] 2.2 Add API key CRUD methods to `AuthService`: `createApiKey(userId, name)`, `listApiKeys(userId)`, `revokeApiKey(userId, keyId)`
- [x] 2.3 Create `ApiKeyAuthGuard` that checks `Authorization: Bearer kp_...` — hashes the key and looks up the record
- [x] 2.4 Create a combined `AuthGuard` that tries JWT first, then falls back to API key
- [x] 2.5 Add API key management endpoints to `AuthController`: `POST /api/auth/api-keys`, `GET /api/auth/api-keys`, `DELETE /api/auth/api-keys/:id`
- [x] 2.6 Replace `JwtAuthGuard` usage with the combined guard on all existing endpoints

## 3. MCP Server Package Setup

- [x] 3.1 Scaffold `packages/mcp-server` with `package.json`, `tsconfig.json`, and entry point `src/index.ts`
- [x] 3.2 Add `@modelcontextprotocol/sdk` dependency
- [x] 3.3 Create Kalepin API client class — wrapper around `fetch` calls to backend REST API, configured via `KALEPIN_URL` and `KALEPIN_API_KEY` env vars
- [x] 3.4 Set up MCP `Server` instance with stdio transport and server metadata

## 4. MCP Tools

- [x] 4.1 Implement `search_notes` tool — calls `GET /api/files/search?q=...`
- [x] 4.2 Implement `read_note` tool — calls `GET /api/files?path=...`
- [x] 4.3 Implement `list_files` tool — calls `GET /api/files/tree`
- [x] 4.4 Implement `create_note` tool — calls `POST /api/files` with path and content
- [x] 4.5 Implement `edit_note` tool — calls `POST /api/files` with path and content (overwrite)
- [x] 4.6 Implement `delete_note` tool — calls `DELETE /api/files?path=...`
- [x] 4.7 Implement `list_comments` tool — calls `GET /api/comments?path=...`
- [x] 4.8 Implement `add_comment` tool — calls `POST /api/comments`

## 5. MCP Resources and Prompts

- [x] 5.1 Implement `note://{path}` resource — returns note content as `text/markdown`
- [x] 5.2 Implement `tree://` resource — returns file tree as JSON
- [x] 5.3 Implement `summarize-notes` prompt template
- [x] 5.4 Implement `review-doc` prompt template

## 6. Integration and Testing

- [x] 6.1 Add build script to `packages/mcp-server/package.json` and wire into monorepo build
- [ ] 6.2 Test MCP server end-to-end: start backend, run MCP server, verify tools work via MCP inspector or manual stdio testing
- [x] 6.3 Add MCP server configuration example (for Claude Desktop `claude_desktop_config.json`)
