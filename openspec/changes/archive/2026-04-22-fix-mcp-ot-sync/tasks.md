## 1. Backend: OTSessionManager reset method

- [x] 1.1 Add `resetContent(docId, newContent)` method to `OTSessionManager` — replaces content, bumps revision, clears history, sets dirty=false, updates lastFlushedContent
- [x] 1.2 Add `handleExternalWrite(docId)` method to `OTService` — reads fresh content from storage, calls `sessionManager.resetContent()` if session exists, returns client list for notification

## 2. Backend: FilesService event emission

- [x] 2.1 Make `FilesService` extend `EventEmitter` and emit `file:written` with `{ path }` after `storage.write()` in `createFile()`

## 3. Backend: OTGateway subscription and broadcast

- [x] 3.1 Inject `FilesService` into `OTGateway` and subscribe to `file:written` events — call `otService.handleExternalWrite()`, broadcast `doc:reload` to connected clients if session existed
- [x] 3.2 Update file watcher handler to treat `add` events on `.md` files the same as `change` events (broadcast `file:changed`, with OT session suppression check)

## 4. Frontend: Fix stale closure and handle doc:reload

- [x] 4.1 Add `activeFileRef` ref in `App.tsx` that stays in sync with `activeFile` state, use it in the `file:changed` handler instead of the stale closure variable
- [x] 4.2 Add `doc:reload` WebSocket handler in `App.tsx` — if path matches `activeFileRef.current`, call `openFile()` to re-open the document through the standard flow

## 5. Verification

- [x] 5.1 Test: open an empty doc in browser, use MCP `create_note` to generate content — editor should update without manual refresh
- [x] 5.2 Test: open an existing doc in browser, use MCP `edit_note` to replace content — editor should update with new content
- [x] 5.3 Test: regular editing (typing in the editor) still works correctly with OT, no spurious reloads
