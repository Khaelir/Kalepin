## Why

Users report losing entire documents because saves fail silently. There is zero UI feedback about save status, and the save pipeline has multiple bugs that can cause actual data loss: dirty flag reset before flush succeeds, OT error messages silently ignored, WebSocket reconnect doesn't re-open the document, and no `beforeunload` handler to guard against tab close.

## What Changes

- **Fix data loss bugs in the OT session manager**: dirty flag ordering, flush error handling, session close race condition, unbounded history growth
- **Add save confirmation signal**: backend emits `flushed` / `flush:error` WebSocket events after disk write, `doc:flush` sends a response
- **WebSocket resilience**: lifecycle events (`connected`/`disconnected`), exponential reconnect backoff, full document re-sync on reconnect
- **OT client error recovery**: handle server `error` messages, maintain confirmed shadow alongside optimistic shadow for rollback
- **Save status indicator**: visible state in editor UI — Saved / Saving / Failed / Disconnected
- **Hard blocker on failure**: persistent banner + read-only editor on disconnect or save error, with copy button as safety valve
- **`beforeunload` guard**: browser warning when unconfirmed changes exist

## Capabilities

### New Capabilities
- `save-status`: Save status indicator, state machine, and UI feedback (banner, read-only lockdown, copy button, beforeunload)

### Modified Capabilities
- `ot-collaboration`: Fix dirty flag ordering, flush error handling, session close race, history trimming, `flushed`/`flush:error` events, `doc:flush` response, OT client error handling, confirmed shadow, reconnect re-sync
- `presence`: WebSocket lifecycle events (connected/disconnected), exponential reconnect backoff

## Impact

- **Backend**: `ot-session-manager.ts` (flush logic, history trimming, race guard), `ot.gateway.ts` (flushed event broadcast, doc:flush response)
- **Frontend**: `ws-client.ts` (lifecycle events, backoff), `ot-client.ts` (error handling, confirmed shadow), `Editor.tsx` (save status state machine, banner component, beforeunload, read-only toggle)
- **Shared**: May need new WebSocket message types in shared types
