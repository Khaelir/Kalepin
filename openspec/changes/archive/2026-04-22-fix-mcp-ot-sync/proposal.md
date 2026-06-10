## Why

MCP-generated content never appears in the editor when the user has the document open. The user sees the diff tracked in the Changes panel, but the editor stays empty — even after a full page refresh. This happens because MCP writes bypass the OT session entirely, and three independent bugs prevent the frontend from learning about the new content.

## What Changes

- Add a mechanism for non-OT writes (MCP) to notify the OT system and reset active sessions with fresh disk content
- Broadcast `doc:reload` to WebSocket clients when an external write invalidates their OT session
- Fix `file:changed` handler to also cover file creation (`add` events), not just modifications
- Fix stale closure on `activeFile` so the `file:changed` handler references the current document
- Handle the new `doc:reload` message on the frontend by re-opening the document through the standard OT flow

## Capabilities

### New Capabilities
- `external-write-sync`: Mechanism for non-OT writes to invalidate active OT sessions and notify connected clients to reload

### Modified Capabilities
- `ot-collaboration`: OT session manager gains a `resetContent` method; file watcher handles `add` events for content notification
- `editor`: Frontend handles `doc:reload` WS message and fixes stale `activeFile` closure in `file:changed` handler

## Impact

- **Backend**: `OTSessionManager`, `OTService`, `OTGateway`, `FilesService` — new event-based coordination between file writes and OT sessions
- **Frontend**: `App.tsx` — new WS message handler, ref-based closure fix
- **Dependencies**: May need `@nestjs/event-emitter` if not already present (to decouple FilesService → OTGateway without circular deps)
- **No breaking changes**: Existing OT flow for regular editing is unchanged
