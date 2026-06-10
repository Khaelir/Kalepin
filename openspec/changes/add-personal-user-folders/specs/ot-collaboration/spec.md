## MODIFIED Requirements

### Requirement: WebSocket doc:open is gated by viewer visibility

The OT gateway SHALL reject any `doc:open` whose `docId` is not visible to the connecting user. Rejection SHALL emit an error event indicating not-found and SHALL NOT call `OTService.openDocument`.

#### Scenario: doc:open of foreign personal docId rejected
- **WHEN** Bob's authenticated WebSocket sends `doc:open` with `{ docId: "_users/alice@example.com/Diary.md" }`
- **THEN** the gateway sends an error event indicating the doc was not found and does NOT push content; the existing OT session for that docId is unaffected

#### Scenario: Owner doc:open succeeds
- **WHEN** Alice's WebSocket sends `doc:open` for `_users/alice@example.com/Diary.md`
- **THEN** the gateway opens the session and sends the standard `doc:opened` event with content and revision

### Requirement: file:tree-update broadcast is per-recipient gated

The system SHALL replace the unconditional `broadcastToAll` for `file:tree-update` events with a per-recipient gated broadcast. Each connected client SHALL receive a `file:tree-update` only if `isVisibleTo(event.path, client.user.email)` is true.

#### Scenario: Personal-folder add not broadcast to non-owners
- **WHEN** Alice creates `_users/alice@example.com/NEW.md` and the file watcher fires an `add` event
- **THEN** Bob's WebSocket receives no `file:tree-update` for that path; Alice's WebSocket receives the event

#### Scenario: Shared-vault add still broadcast to everyone
- **WHEN** any user creates `Notes/foo.md`
- **THEN** every connected authenticated WebSocket receives the `file:tree-update` event

### Requirement: Shared and per-user file watchers are split

The system SHALL run a single shared `chokidar` watcher rooted at `VAULT_PATH` and SHALL run an independent per-user watcher rooted at `personal/{email}/` started lazily on the first WebSocket connection for that email and stopped when the last connection closes.

#### Scenario: Per-user watcher starts on first connect
- **WHEN** Alice's first WebSocket connection authenticates
- **THEN** a `chokidar` subscription on `personal/alice@example.com/` is created if not already running

#### Scenario: Per-user watcher stops on last disconnect
- **WHEN** Alice's last WebSocket connection closes
- **THEN** the personal watcher for her email is stopped and resources released

#### Scenario: Personal watcher events fan out to owner only
- **WHEN** the personal watcher for Alice fires an event
- **THEN** the gateway sends the event only to WebSocket clients whose authenticated email is `alice@example.com`
