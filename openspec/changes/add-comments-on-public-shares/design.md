# Design: comments on public share-links

## Auth flow

```
Anonymous viewer at /share/abc123
        │
        ├── reads note + comments (read-only) ✓
        │
        ▼
   wants to comment → clicks "Sign in to comment"
        │
        ▼
   inline magic-link form
   ?return=/share/abc123 stored in URL state
        │
        ▼
   email arrives, click link
        │
        ▼
   token verified, redirect to /share/abc123
        │
        ▼
   viewer is now authenticated
   comment input active
```

The return-URL param is a relative path under the same origin to prevent open-redirect.

## Backend changes

- `share-links.controller.ts:resolve` already returns the note content. Extend the response to include `comments: CommentThread[]` (or have the frontend make a separate `GET /api/comments?path=...` call — preferred, matches existing patterns).
- `comments.controller.ts` already auth-gates comment creation. No structural change needed.
- Optional: add `via_share_code TEXT` column to `comments` for provenance. If present, the comment was posted while the viewer was on `/share/{via_share_code}`. Surfaces in admin views.

## Frontend changes

- `SharedNoteViewer.tsx`: add `<CommentsPanel readOnly={!authed}>`.
- A `useReturnAfterAuth(path)` hook stores the share path before initiating magic-link flow and consumes it on auth completion.

## Spam mitigation

- Rate limit: 30 comments / hour / authenticated user across the entire system. Implemented in `comments.service.ts` via a simple counter.
- Optional CAPTCHA on the magic-link form for share-page initiations only (not for the regular login path) — deferred unless spam appears.

## Stage-2 interaction

Share-links cannot be minted for E2E paths (the encryption capability blocks this at mint time via `share_link_mintable` predicate). So this feature naturally never applies to E2E. No additional gate needed.

## Dependencies

- None hard. Stronger UX with `add-access-metadata` (so owners see "anonymous viewer commented from share-link") but not required.
