## Purpose

Generates public share links that grant read-only access to a single note.

## Requirements

### Requirement: Share link code generation

The system SHALL assign a unique 10-character base62 code to a document **on explicit mint** (not on first open), stored in the `short_links` table with `expires_at`, `created_by_email`, and `revoked_at = null`. If an active code already exists for that path, the system SHALL return the existing code; if the existing row is expired or revoked, a new code SHALL be minted.

#### Scenario: First explicit mint
- **WHEN** an owner POSTs `/api/share-links` for a path with no active row
- **THEN** the system generates a new code, stores it with the metadata, and returns the code

#### Scenario: Mint over an active row
- **WHEN** an owner POSTs `/api/share-links` for a path that already has an active row
- **THEN** the system returns the existing code (idempotent)

#### Scenario: Mint over an expired row
- **WHEN** an owner POSTs `/api/share-links` for a path whose existing row is expired
- **THEN** the system mints a new code; the old row remains in the table with `expires_at` unchanged

### Requirement: Share-links are minted only on explicit user action

The system SHALL NOT automatically mint a share-link when a user opens a document. A share-link row SHALL be created only in response to an explicit `POST /api/share-links` request initiated by user action (e.g., clicking "Generate public link" in `ShareDialog`).

#### Scenario: Opening a file does not insert a row
- **GIVEN** a path with no row in `short_links`
- **WHEN** the owner opens the file via the standard file-open flow
- **THEN** no row is inserted into `short_links`

#### Scenario: Explicit mint inserts a row
- **WHEN** the owner POSTs to `/api/share-links` with the path
- **THEN** a row is inserted with `created_by_email` set to the owner's canonical email

### Requirement: Share-links carry an optional expiry

`short_links` SHALL include `expires_at` (nullable; null = never). The default expiry on mint SHALL be 30 days for paths under `_users/` and null for shared-vault paths, both overridable per mint.

#### Scenario: Default expiry for a personal note
- **WHEN** the owner mints a share-link for `_users/alice@x.com/foo.md` without specifying `ttl_ms`
- **THEN** `expires_at` is `now + 30 days`

#### Scenario: Default expiry for a shared-vault note
- **WHEN** the owner mints a share-link for `Notes/foo.md` without specifying `ttl_ms`
- **THEN** `expires_at` is null

#### Scenario: Explicit ttl wins
- **WHEN** the owner mints with `ttl_ms = 7 * 86400 * 1000`
- **THEN** `expires_at` is `now + 7 days` regardless of the default

### Requirement: Resolving an expired or revoked share-link returns 410

When a code's `revoked_at` is set or `expires_at < now`, both the public viewer (`GET /share/:code`) and the authenticated resolver (`GET /api/share-links/resolve/:code`) SHALL return HTTP 410 Gone with a message indicating the link is no longer active.

#### Scenario: Expired link
- **GIVEN** a row with `expires_at = now - 1`
- **WHEN** any client resolves the code
- **THEN** the response is 410

#### Scenario: Revoked link
- **GIVEN** a row with `revoked_at = now`
- **WHEN** any client resolves the code
- **THEN** the response is 410

#### Scenario: Unknown code
- **GIVEN** no row matching the code
- **WHEN** a client resolves
- **THEN** the response is 404 (existing behaviour preserved)

### Requirement: Owner and admin can revoke a share-link

`DELETE /api/share-links/:code` SHALL set `revoked_at = now` on the row. Authorization SHALL allow the owner of the underlying path and admins; others receive 403.

#### Scenario: Owner revokes
- **GIVEN** Alice owns the path and has minted a code
- **WHEN** Alice DELETEs `/api/share-links/<code>`
- **THEN** `revoked_at` is set and subsequent resolves return 410

#### Scenario: Non-owner cannot revoke
- **GIVEN** Bob does not own the path
- **WHEN** Bob DELETEs the code
- **THEN** the response is 403

### Requirement: Owner can list the share-link for a path

`GET /api/share-links/by-path?path=...` SHALL return the metadata for the active share-link on the given path (`{ code, expires_at, revoked_at, created_at, last_resolved_at }`) or null if none exists. Authorization SHALL allow the owner and admins.

#### Scenario: Owner reads metadata
- **GIVEN** Alice owns the path and an active share-link exists
- **WHEN** Alice GETs `/api/share-links/by-path?path=Notes/foo.md`
- **THEN** the response is 200 with the metadata blob

#### Scenario: No link exists
- **WHEN** the path has no row
- **THEN** the response is 200 with `null`

### Requirement: Share link resolution
The system SHALL provide an API endpoint (`GET /api/share-links/resolve/:code`) that resolves a code to its current file path.

#### Scenario: Resolve a valid code
- **WHEN** the frontend requests resolution of a valid code
- **THEN** the system returns `{ path }` with the current file path

#### Scenario: Resolve an unknown code
- **WHEN** the frontend requests resolution of a code that does not exist
- **THEN** the system returns a 404 error

### Requirement: Recipient URL is path-free

The clipboard / notification copy URL emitted for a share-link SHALL be exactly `/s/<code>` with no cosmetic suffix. The system SHALL NOT emit `/s/<code>/<cosmetic>` from any code path. The legacy `/d/<code>` (code-only) prefix SHALL continue to resolve for backwards compatibility; legacy `/d/<code>/<cosmetic>` and `/s/<code>/<cosmetic>` URLs SHALL resolve by the code only — the cosmetic suffix is ignored, and clients SHALL normalize the address bar to `/doc/<handle-id>` once resolved.

#### Scenario: Clipboard copy emits path-free URL
- **GIVEN** Alice has minted a share-link for `Notes/Alpha/Beta.md` with code `abc12345`
- **WHEN** Alice triggers "Copy public link" (button or `Cmd-Shift-C`)
- **THEN** the clipboard contains `<origin>/s/abc12345` with no cosmetic suffix

#### Scenario: Legacy `/d/<code>` URL still resolves
- **GIVEN** a previously-shared URL `/d/abc12345`
- **WHEN** any client navigates to it
- **THEN** the system resolves the code identically to `/s/abc12345`

#### Scenario: Legacy `/s/<code>/<cosmetic>` URL resolves by code only
- **GIVEN** a previously-shared URL `/s/abc12345/Notes-Alpha-Beta`
- **WHEN** an authed client navigates to it
- **THEN** the system resolves by `abc12345`, ignores the cosmetic suffix, and the address bar is normalized to `/doc/<handle-id>`

#### Scenario: Mint and revoke do not rewrite the address bar
- **GIVEN** an authed user is viewing a doc with address bar `/doc/<handle-id>`
- **WHEN** the user mints a public share-link via the dialog or `Cmd-Shift-C`
- **THEN** the address bar SHALL remain `/doc/<handle-id>`
- **AND** the clipboard receives `/s/<code>` (when "Copy public link" or `Cmd-Shift-C` is invoked)

### Requirement: Resolve carries handle ID for in-app normalization

`GET /api/share-links/resolve/:code` and `infoForCodeIncludingGone` SHALL include `handleId: string` in the response payload (alongside `path`, `requiresPin`, etc.). The handle ID SHALL be minted lazily if absent — the resolve call is the natural moment for an authed read of the path to ensure a handle exists. Frontends use this to `replaceState` the address bar to `/doc/<handle-id>` once the share-link viewer hands off to the in-app reader.

#### Scenario: Resolve returns handleId for an active link
- **GIVEN** an active share-link with code `abc12345` for path `Notes/Foo.md`
- **WHEN** an authed client GETs `/api/share-links/resolve/abc12345`
- **THEN** the response body contains `handleId: <16-char base32>` matching the path's `doc_handles` row

#### Scenario: Resolve mints handleId on demand
- **GIVEN** an active share-link for a path that has no `doc_handles` row yet (e.g. file pre-dates this change)
- **WHEN** the resolve endpoint is called
- **THEN** the system mints a `doc_handles` row and returns its ID in the response

### Requirement: Share link persistence across renames
The system SHALL update share link paths when documents are renamed or moved, so that existing URLs continue to resolve to the correct document.

#### Scenario: File renamed via API
- **WHEN** a file with an existing code is renamed via `POST /api/files/move`
- **THEN** the `short_links` row is updated with the new path, and the code resolves to the new location

#### Scenario: File renamed externally (Obsidian)
- **WHEN** a file with an existing code is renamed on disk by an external editor
- **THEN** the rename tracking service updates the `short_links` row with the new path

#### Scenario: Folder renamed
- **WHEN** a folder is renamed and it contains files with codes
- **THEN** all affected `short_links` rows are updated with the new path prefix

### Requirement: Share link cleanup on deletion
The system SHALL remove share link entries when their associated documents are deleted.

#### Scenario: File deleted via API
- **WHEN** a file with a code is deleted via `DELETE /api/files/delete`
- **THEN** the corresponding `short_links` row is removed

#### Scenario: File deleted externally
- **WHEN** a file with a code is deleted on disk by an external process
- **THEN** the corresponding `short_links` row is removed during the next file watcher cycle

### Requirement: Notification links use stable URLs
Backend email notifications SHALL construct document links using the durable `/doc/<handle-id>` form (resolved via `DocHandlesService.findOrCreateForPath`) so notification links survive renames and never leak path or share-link state into the email body.

#### Scenario: Comment notification email
- **WHEN** the system sends a notification email about a comment on a document
- **THEN** the document link in the email is `${APP_URL}/doc/<handle-id>` (optionally suffixed with `?thread=<id>`); the path of the file is not in the URL

### Requirement: Share-link viewer challenges for the PIN before rendering

When `/share/:code` resolves a path with a non-null `pin_hash`, the server SHALL serve a PIN-prompt page (or return a status the frontend renders as a prompt) before rendering the note content. Successful PIN entry SHALL set a session-scoped unlock cookie.

#### Scenario: Anonymous viewer prompted for PIN
- **GIVEN** Alice has a share-link `/share/abc123` for a PIN-locked note
- **WHEN** an anonymous viewer opens the URL
- **THEN** the page prompts for the PIN; the note content is not in the response

#### Scenario: Correct PIN reveals content
- **WHEN** the viewer submits the correct PIN
- **THEN** the unlock cookie is set; the next page load (same browser session) renders the note
