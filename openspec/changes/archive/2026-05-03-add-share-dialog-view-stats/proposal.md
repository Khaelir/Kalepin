# Surface per-grantee view stats in the share dialog

## Why

Once a user shares a note with a recipient, they have no signal about whether the recipient ever opened it. The change-tracking feed and the per-recipient grant list both show *intent* (you granted access) but not *uptake* (did they actually look). This is the most-asked feature on the share triage: "for each email it has been shared with, how many times they accessed this shared file".

The data layer for this is already proposed in `add-access-metadata` (the `note_access_log` table with `(path, viewer_email, action, ts)` rows and write hooks on read/edit/comment/share-link-resolve). What's missing is the *aggregation* and the *surfacing*: the share dialog already lists the people with access; it should show their view counts and last-view timestamps right next to the existing permission/expiry/revoke controls.

## What Changes

- **Aggregation endpoint**: `GET /api/notes/:path/access-summary` — owner-or-admin only, returns `{ grantees: [{ email, view_count, last_view_at, last_edit_at }], anonymous: { resolve_count, last_resolve_at } }`. The aggregation queries `note_access_log` grouped by `viewer_email` for the path, restricted to the relevant action types.
- **`DocumentGrantInfo` extension**: the existing `GET /api/grants?path=...` response is left alone; aggregation is a sibling endpoint to keep concerns separate. The frontend `ShareDialog` joins them client-side.
- **`ShareDialog` rendering**: each row in the "People with access" list gains two new pieces of metadata — view count and last-viewed-ago. A dedicated "Public link" row (introduced by `tighten-public-share-links`) shows `anonymous.resolve_count` and `anonymous.last_resolve_at`.
- **Empty-state copy**: when a grantee has zero rows, render "Not yet viewed" rather than "0 views" — distinguishes "never opened" from "opened, but log was pruned by retention".
- **Caveat for stage-2 paths**: for `isE2EEncrypted` paths, the access log records `'fetched'` rather than `'view'`. The aggregation labels these as "fetched (encrypted)" with a tooltip explaining the server only saw the ciphertext download. This is in line with the spec already in `add-access-metadata`.

## Capabilities

### Modified Capabilities

- `access-metadata`: New aggregation endpoint `GET /api/notes/:path/access-summary` with per-grantee and anonymous-aggregate shapes.
- `document-grants`: `ShareDialog` reads the access-summary in addition to the grants list and renders combined per-recipient metadata.

## Impact

- **Dependencies**: this change is a strict superset of `add-access-metadata` — it requires that capability's table and write hooks to exist. It can be implemented as a tail-end task of `add-access-metadata` or as a separate follow-up; the proposal here is the spec extension regardless of who ships it.
- **Backend**:
  - `packages/backend/src/access-log/access-log.controller.ts` — add `summary` route. The query is `SELECT viewer_email, COUNT(*), MAX(ts) FROM note_access_log WHERE path = ? AND action IN ('view','fetched','edit') GROUP BY viewer_email`, plus a separate query for `viewer_email = 'anonymous' AND action = 'share-link-resolved'`.
  - Authorization: same predicate as the existing access-log read endpoint (owner-or-admin).
- **Frontend**:
  - `packages/frontend/src/api.ts` — `getAccessSummary(path)`.
  - `packages/frontend/src/components/ShareDialog.tsx` — fetch summary alongside grants, join by email, render `· 12 views · last 3h ago` next to each grantee, render anonymous aggregate on the public-link row.
- **Performance**: one aggregation query per dialog open. The `(path, ts DESC)` index on `note_access_log` already supports the path-scoped grouping efficiently. No frontend caching needed — the dialog is short-lived.
- **Privacy**: the summary is owner-only (or admin); grantees do NOT see the aggregate of who-else-has-viewed. The endpoint never returns rows for users without an active grant on the path (i.e., grantees whose access has been revoked are filtered out of the response, even if their rows exist in the log — this avoids leaking historical access).
- **Risk**: low. The endpoint is additive, gated by existing authz, and the UI change is purely informational.
