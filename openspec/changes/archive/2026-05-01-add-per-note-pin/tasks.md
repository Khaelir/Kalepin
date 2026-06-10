# Tasks — per-note PIN

## 1. Schema + service

- [x] 1.1 SQLite migration creating `note_meta`.
- [x] 1.2 `packages/backend/src/pin/pin.service.ts`: `setPin(path, pin, owner)`, `removePin(path, owner)`, `verifyPin(path, pin, viewer) → token | null`, `isLocked(path, viewer)`, `mintUnlockToken(path, viewer, kind)`.
- [x] 1.3 bcrypt cost 12 for hashing.
- [x] 1.4 Sliding-window rate limit per (path, viewer).

## 2. HTTP endpoints

- [x] 2.1 `POST /api/notes/:path/pin` — set/change (owner-only).
- [x] 2.2 `DELETE /api/notes/:path/pin` — remove (owner-only, no PIN required for reset).
- [x] 2.3 `POST /api/notes/:path/pin/verify` — verify and set unlock cookie.
- [x] 2.4 Path encoding: `:path` URL-encoded; decode and canonicalize before lookup.

## 3. Route gating

- [x] 3.1 Read path: `FilesService.readFile` checks `note_meta.pin_hash`. If set, validate unlock cookie. Return 423 on missing/expired/wrong.
- [x] 3.2 Write paths: `createFile`, `patchFile`, `appendToFile`, `deleteFile`, `move(src→...)` validate unlock cookie for the source path.
- [x] 3.3 Comments: `comments.controller.create` validates unlock for the path.
- [x] 3.4 Share resolve: `share-links.controller.resolve` requires unlock when the resolved path has a PIN; serves a PIN prompt if not.

## 4. MCP integration

- [x] 4.1 MCP read tools (`read_note`, `search_notes`, `get_updates`) consult PIN service. Return `{ kind: 'pin-protected', path }` sentinel for locked paths.
- [x] 4.2 `X-Kalepin-Unlock` header support: one-shot verify-token. Rejected if not matching path.

## 5. Frontend

- [x] 5.1 Context-menu "Set PIN" / "Change PIN" / "Remove PIN" actions on note rows.
- [x] 5.2 Set PIN dialog: 8-char input, strength hint ("digits-only is weak; mix in letters").
- [x] 5.3 PIN-prompt overlay on note-open when locked; shows remaining attempts and lockout timer.
- [x] 5.4 Share-link viewer: PIN prompt before rendering.
- [x] 5.5 Settings → Security: list of notes with PIN, with quick-remove buttons.

## 6. Stage-2 carve-out

- [x] 6.1 Reject `POST /pin` with 400 when `isE2EEncrypted(path)` is true. UI hides the action.

## 7. Tests

- [x] 7.1 Owner sets PIN; reads without verify returns 423.
- [x] 7.2 Verify with correct PIN issues unlock cookie; subsequent reads succeed.
- [x] 7.3 Verify with wrong PIN: counter increments; 5th wrong → 15 min lockout.
- [x] 7.4 Lockout: verify during lockout returns 423; after lockout expires, attempts reset.
- [x] 7.5 Owner reset (DELETE) without PIN clears state.
- [x] 7.6 Grantee can verify and unlock; cannot reset.
- [x] 7.7 Tampered cookie (wrong path in JWT) returns 423.
- [x] 7.8 Public share-viewer cookie is session-scoped.
- [x] 7.9 MCP read tool returns sentinel for locked path; succeeds with valid `X-Kalepin-Unlock` header.
- [x] 7.10 Stage-2 path rejects PIN set.
