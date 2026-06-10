# Tasks — share-dialog view stats

## 1. Backend

- [x] 1.1 Add `AccessLogService.summaryForPath(path)` returning `{ rows: [{ email, view_count, last_view_at, last_edit_at }], anonymous: { resolve_count, last_resolve_at } }`.
- [x] 1.2 Add `GET /api/notes/:path/access-summary` to `AccessLogController`. Owner-or-admin gate (reuses the existing `assertReadableByOwnerOrAdmin` from `access-log` capability).
- [x] 1.3 Active-grant filter: `summaryForPath` joins with `grants` (or accepts a `granteeEmails` list passed by the controller) and drops rows whose email is not in that set, but always includes the anonymous aggregate.
- [x] 1.4 Stage-2 carve-out: for E2E paths, anonymous block is `null` (share-links cannot exist for these paths anyway).
- [x] 1.5 Unit tests covering: counts, last-ts, revoked-grantee exclusion, owner-self-view exclusion, anonymous aggregate.

## 2. Frontend

- [x] 2.1 `api.getAccessSummary(path)` helper.
- [x] 2.2 `ShareDialog` fetches both `listGrantsForPath` and `getAccessSummary` in parallel; joins by lowercased email.
- [x] 2.3 Render per-grantee meta: `view_count > 0 ? '· N views · last <relative>' : '· Not yet viewed'`. For E2E paths, render `· N fetched` with a tooltip.
- [x] 2.4 Render anonymous aggregate on the public-link panel (added by `tighten-public-share-links`).
- [x] 2.5 If `add-access-metadata` is not yet shipped (endpoint returns 404), gracefully hide the meta line — don't break the dialog.

## 3. Tests

- [x] 3.1 Owner sees `view_count` reflecting only logged views by active grantees.
- [x] 3.2 Revoked grantee with prior views is NOT in the response.
- [x] 3.3 Anonymous resolves are aggregated on `anonymous.resolve_count`.
- [x] 3.4 Non-owner non-admin gets 403.
- [x] 3.5 ShareDialog rendering snapshot for each state (zero / some / many / e2e).
