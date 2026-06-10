# Spec delta: share-links (MODIFIED)

## MODIFIED Requirements

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

### Requirement: Notification links use stable URLs

Backend email notifications SHALL construct document links using the durable `/doc/<handle-id>` form (via `DocHandlesService.findOrCreateForPath`) instead of the previous `/d/<code>/<cosmetic-path>` form. Notification URLs SHALL NOT carry the path or any share-link code; they survive rename/move via the handle and never leak vault structure into email bodies.

#### Scenario: Comment notification email uses handle URL
- **WHEN** the system sends a notification email about a comment on a document
- **THEN** the document link in the email is `${APP_URL}/doc/<handle-id>` (optionally `?thread=<id>`)
- **AND** the email body contains no `/d/<code>` URL and no cosmetic suffix

## REMOVED Requirements

### Requirement: Cosmetic-fallback recovery for gone share-links

**Reason**: The cosmetic-path arm of `/s/<code>/<cosmetic>` was a recovery affordance — if a code resolved 410, an authed user with native access could open the file via the cosmetic path. With the cosmetic suffix removed from emitted URLs (see "Recipient URL is path-free"), there is no cosmetic to recover from. A code-gone URL renders the same 410 card for everyone; an authed user with access can still locate the file via the file tree.

**Migration**: Pre-existing URLs containing a cosmetic suffix continue to resolve by code; the cosmetic part is silently ignored. Users will not see broken behaviour, but they also lose the "code is dead but I have access via the tree" auto-recovery. This is documented in the proposal as an intentional regression.

## ADDED Requirements

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
