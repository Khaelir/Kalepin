# Tasks — comments on public share-links

## 1. Backend

- [ ] 1.1 Extend `share-links.controller.ts:resolve` to confirm the path. Decide: include comments in resolve response, or have frontend make a separate GET. (Recommended: separate GET via existing `/api/comments?path=...` endpoint.)
- [ ] 1.2 Optional column: `ALTER TABLE comments ADD COLUMN via_share_code TEXT NULL`. Wire `comments.service.ts:create` to accept and persist this when present.
- [ ] 1.3 Rate limit: 30 comments / hour / user in `comments.service.ts` (in-memory counter or a small DB table).

## 2. Frontend

- [ ] 2.1 `SharedNoteViewer` (existing public viewer) renders a `<CommentsPanel>` in read-only mode for anonymous viewers and editable for authenticated viewers.
- [ ] 2.2 "Sign in to comment" button replaces the input area when unauthenticated. Opens an inline magic-link form with `?return=<sharePath>`.
- [ ] 2.3 `useReturnAfterAuth(path)` hook: store path in `sessionStorage`, consume + redirect on auth callback.
- [ ] 2.4 When an authenticated user posts a comment via the share-link viewer, include `via_share_code` in the request body.

## 3. Tests

- [ ] 3.1 Anonymous viewer at `/share/:code` sees existing comments.
- [ ] 3.2 Anonymous viewer cannot post; "Sign in to comment" appears.
- [ ] 3.3 After magic-link auth, the user is returned to `/share/:code` and the comment input is active.
- [ ] 3.4 Authenticated post creates a comment with `via_share_code` populated.
- [ ] 3.5 Rate limit: 31st comment in an hour returns `429`.
