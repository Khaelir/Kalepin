## 1. Backend: Fix flush reliability

- [x] 1.1 Fix dirty flag ordering in `ot-session-manager.ts`: move `session.dirty = false` to after `await this.onFlush()`, wrap in try/catch, re-set dirty on failure
- [x] 1.2 Add session close race guard: after async flush in `closeSession()`, check if new clients joined before deleting the session
- [x] 1.3 Add OT history trimming: after each flush, trim `session.history` to a sliding window (default 1000 entries)

## 2. Backend: Flush confirmation events

- [x] 2.1 Emit `flushed` WebSocket event to all document clients after successful `flushToDisk()` — requires passing a broadcast callback into the session manager
- [x] 2.2 Emit `flush:error` WebSocket event to all document clients on flush failure
- [x] 2.3 Update `doc:flush` gateway handler to send `flushed` or `flush:error` response back to the requesting client

## 3. Frontend: WSClient resilience

- [x] 3.1 Emit `connected` and `disconnected` lifecycle events through the existing `on(type, handler)` system in `ws-client.ts`
- [x] 3.2 Add exponential reconnect backoff (2s → 4s → 8s → max 30s), reset delay on successful connection
- [x] 3.3 Expose a `isConnected` getter or reactive state for UI consumption

## 4. Frontend: OTClient error handling and confirmed shadow

- [x] 4.1 Listen for `error` messages from server in OTClient constructor, invoke an error callback
- [x] 4.2 Reset OTClient state on error (clear pending/buffer, return to Synchronized)
- [x] 4.3 Add confirmed shadow field to OTClient — updated only on `ack`, used as rollback point
- [x] 4.4 On error or disconnect, reset optimistic shadow to confirmed shadow value

## 5. Frontend: Document re-sync on reconnect

- [x] 5.1 In Editor.tsx, listen for WSClient `connected` event after a prior `disconnected` event
- [x] 5.2 On reconnect, re-send `doc:open` to get fresh content + revision from server
- [x] 5.3 On `doc:opened` response, destroy old OTClient, create new one with server-provided revision, replace editor content, reset shadows

## 6. Frontend: Save status state machine

- [x] 6.1 Create a `useSaveStatus` hook (or similar) that manages the SYNCED/DIRTY/FLUSH_PENDING/ERROR/DISCONNECTED state machine
- [x] 6.2 Wire state transitions: SYNCED→DIRTY on local edit, DIRTY→FLUSH_PENDING on ack, FLUSH_PENDING→SYNCED on `flushed`, any→ERROR on `flush:error`, any→DISCONNECTED on disconnect, DISCONNECTED→SYNCED on re-sync
- [x] 6.3 Listen for `flushed` and `flush:error` WebSocket events in the hook

## 7. Frontend: Save status UI

- [x] 7.1 Add save status indicator to editor header showing: "Saved" / "Saving..." / "Save failed" / "Connection lost"
- [x] 7.2 Create persistent banner component for ERROR and DISCONNECTED states — undismissable, positioned above editor
- [x] 7.3 Add "Copy content" button to banner that copies current editor markdown to clipboard
- [x] 7.4 Wire editor read-only + visual dimming when save state is ERROR or DISCONNECTED, restore editable on recovery to SYNCED

## 8. Frontend: beforeunload guard

- [x] 8.1 Register `beforeunload` handler in Editor.tsx that fires when save state is not SYNCED
- [x] 8.2 Clean up handler on unmount and when save state returns to SYNCED
