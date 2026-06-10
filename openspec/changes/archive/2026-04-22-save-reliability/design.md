## Context

The editor uses an OT-based save pipeline: local edits produce OT operations sent over WebSocket, the server transforms and applies them, then debounce-flushes to disk every 3 seconds of inactivity. This pipeline has no feedback loop — the frontend never learns whether content reached disk. Multiple bugs compound the problem: the dirty flag resets before the flush completes, the OT client ignores server error messages, WebSocket reconnection doesn't re-open the document, and there is no `beforeunload` guard.

Key files:
- Backend: `ot-session-manager.ts` (flush logic), `ot.gateway.ts` (WebSocket handlers)
- Frontend: `ws-client.ts` (WebSocket transport), `ot-client.ts` (OT state machine), `Editor.tsx` (editor component)

## Goals / Non-Goals

**Goals:**
- Guarantee the user knows whether their content is saved to disk
- Fix all identified data loss bugs in the save pipeline
- Provide a hard, undismissable blocker when saves fail or connection drops
- Make WebSocket reconnection fully recover document state
- Add `beforeunload` protection for unconfirmed changes

**Non-Goals:**
- Offline editing or local persistence (IndexedDB) — separate, larger feature
- Changing the debounce timing (3s is fine)
- Multi-device conflict resolution beyond existing OT
- Queuing ops for replay after disconnect (lockdown approach instead)

## Decisions

### 1. `flushed` event as source of truth for "Saved"

**Decision**: The backend emits a `flushed` WebSocket event to all document clients after `flushToDisk()` succeeds. The frontend shows "Saved" only after receiving this event — not after the OT `ack`.

**Why not use the OT `ack`?** The ack means "operation received and transformed in memory." There's a 3-second debounce gap before disk write. Showing "Saved" on ack would be dishonest — if the server crashes during the debounce window, data is lost.

**Alternative considered**: Polling a REST endpoint for save status. Rejected — adds latency, complexity, and doesn't compose well with the existing WebSocket architecture.

### 2. Lockdown on disconnect (not optimistic queuing)

**Decision**: When the WebSocket drops, the editor immediately goes read-only with a hard banner. No attempt to queue ops for later replay.

**Why not queue and replay?** Queued ops accumulate against a stale revision. On reconnect, the server state may have diverged (another user edited, or an external write happened). Replaying stale ops requires complex reconciliation that could silently corrupt content. Lockdown is honest and safe — the user sees the problem and can copy their content.

**Alternative considered**: Optimistic local editing with op queue + reconciliation on reconnect. Rejected — high complexity, hard to test all edge cases, and the failure mode (silent corruption) is worse than the lockdown UX.

### 3. Confirmed shadow alongside optimistic shadow

**Decision**: The OT bridge maintains two shadow states:
- **Optimistic shadow**: updated immediately when the user types (for fast diff computation)
- **Confirmed shadow**: updated only when the server `ack`s an operation

On error or disconnect, the confirmed shadow is the rollback point.

**Why two shadows?** A single shadow that advances on every keystroke cannot be rolled back if the server rejects the op. With two shadows, the confirmed shadow always matches server-known state, enabling safe recovery.

### 4. Full document re-sync on reconnect

**Decision**: On WebSocket reconnect, the client re-sends `doc:open`, receives fresh content + revision, creates a new OTClient, and replaces editor content. No attempt to diff or merge.

**Why full re-sync instead of delta?** The client's local state after a disconnect is unreliable — the shadow may have drifted, pending ops may be stale. A clean re-sync from server state is simple and correct. The momentary content replacement is acceptable since the user was already in read-only lockdown.

### 5. Persistent banner (not modal or toast)

**Decision**: Error/disconnect states show a persistent banner above the editor. The editor content is visible but grayed out and read-only. A "Copy content" button is always available.

**Why not a modal?** Modals block the user from seeing their content, which increases panic. The banner is visible and undismissable but doesn't prevent the user from reading or copying their work.

**Why not a toast?** Toasts auto-dismiss. Connection loss is not a transient event — the warning must persist until the problem resolves.

### 6. WSClient lifecycle events via existing handler system

**Decision**: Extend `WSClient` to emit `connected` and `disconnected` synthetic events through the existing `on(type, handler)` system. Add exponential backoff (2s → 4s → 8s → max 30s) on reconnect, reset on successful connection.

**Why not a separate event emitter?** The `on()` system already exists and works. Adding a parallel event system would be unnecessary complexity.

### 7. Dirty flag fix: reset after flush, re-set on failure

**Decision**: Move `session.dirty = false` to after `await this.onFlush()` succeeds. Wrap flush in try/catch and re-set `dirty = true` on failure.

**Why not just swap the lines?** We also need to handle the failure case — if flush throws, dirty must remain true so the next debounce cycle retries the write.

### 8. History trimming with sliding window

**Decision**: After each flush, trim `session.history` to keep only entries from `(revision - historyWindow)` to current revision. Default window: 1000 operations.

**Why 1000?** Large enough to handle any realistic number of concurrent clients transforming against history, small enough to prevent memory issues in day-long editing sessions.

## Risks / Trade-offs

**[Risk] Content flash on reconnect** — Re-syncing replaces editor content, which may cause a visual flash.
→ Mitigation: User is already in read-only lockdown, so the flash signals recovery. Could add a brief "Reconnected" transition if needed.

**[Risk] Session close race condition** — A new client opening a doc during async flush could lose their session.
→ Mitigation: Check for new clients after flush completes; if session has clients, don't delete it.

**[Risk] Flush error leaves editor stuck in read-only** — If the backend can't write to disk (permissions, full disk), the editor locks down permanently.
→ Mitigation: Backend retries flush on next debounce. If the underlying issue resolves, the `flushed` event fires and the editor recovers. If not, the hard blocker is the correct behavior — the user should know their data isn't being saved.

**[Risk] Two-shadow complexity** — Maintaining optimistic + confirmed shadows adds state management complexity.
→ Mitigation: Keep the implementation in `ot-client.ts` as two string fields. The confirmed shadow only updates on `ack`. On error, set optimistic = confirmed. No complex merge logic needed since we lock down on disconnect.
