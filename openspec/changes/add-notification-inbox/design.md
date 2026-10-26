# Design — notification inbox + email preferences

## Context

Three code paths decide whether someone hears about an event today, all ending in `NotificationService` (email):

| Event | Chokepoint | Email gates (in order) |
|---|---|---|
| `@mention` in a new comment | `CommentsService.processMentionNotification` | resolve users → `MentionTrackingService.shouldSend` (self, per-comment dedup, 10 s cooldown) → `notifyMention` (cross-personal suppression, domain allowlist) |
| Reply in a thread | `CommentsService.processReplyNotification` (fan-out over users mentioned anywhere in the thread + new mentions) | same, `notifyThreadReply` |
| `@mention` added to a note body | `DocMentionService.processDocSave` (OT diff capture) | same, plus "one doc-mention email per user per doc, ever", `notifyDocMention` |
| Grant minted | `GrantsController.mint` | — (no email today) |

## Decision 1 — a new `notifications` table, not `mention_notifications`

`mention_notifications` cannot back the inbox:

- It is an **email dedup ledger**, not an event log. A row is written only after the email gates pass, so a mention swallowed by the 10 s cooldown has no row — the inbox would silently lose it.
- It is **pre-seeded by a backfill** that marks every historic mention as "already sent" (plus a `userId=0` marker row). Surfacing those as inbox items would flood every user with years-old mentions.
- Its doc-mention rule is "one per user per doc, ever" — right for email, wrong for an inbox.
- It has no actor, snippet, `readAt`, or share type, and retention on it would delete dedup records and re-enable duplicate emails.

So the inbox gets its own table and `mention_notifications` keeps its single job.

```sql
CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipientEmail VARCHAR NOT NULL,      -- canonical
  actorEmail     VARCHAR NOT NULL,      -- canonical
  type           VARCHAR NOT NULL,      -- comment_mention | doc_mention | thread_reply | share
  path           VARCHAR NOT NULL,      -- last known path (refreshed lazily, see Decision 4)
  handleId       VARCHAR(16) NULL,      -- doc_handles.id of the note
  threadId       VARCHAR NULL,
  commentId      VARCHAR NULL,
  heading        VARCHAR NULL,          -- doc mentions: nearest heading slug
  snippet        TEXT NULL,             -- ≤160 chars, null for E2E paths
  createdAt      INTEGER NOT NULL,      -- unix ms
  readAt         INTEGER NULL           -- unix ms
);
-- (recipientEmail, id), (recipientEmail, readAt), (recipientEmail, commentId)
```

Unix-ms integers match `document_grants` / `doc_handles`. Items are keyed by **email**, not user id: grants and visibility are email-keyed, mention recipients are emails, and a share can target someone who has not signed in yet (their item is waiting on first login).

## Decision 2 — where items are created

Items are created at the existing chokepoints, **after** the user-facing suppression rules and **before** the email anti-spam gates:

- **No self-notification** — actor == recipient (canonical compare) is dropped.
- **Cross-personal suppression** — a mention/reply in `_users/{owner}/…` for anyone but the owner is dropped, exactly like the email (`isCrossPersonalMention`). This also drops grantees; that is the existing email rule and is kept for parity (a follow-up could let active grantees through for both channels).
- The **10 s cooldown and per-doc-forever dedup do not apply** to in-app items — they throttle mailboxes, not a list. The inbox has its own dedup instead: one item per (recipient, commentId); for doc mentions, no new item while an unread one exists for the same recipient + note (absorbs undo/redo churn).
- Comment and reply chokepoints only run for registered users (they already resolve user ids first). Guest comments never notify (unchanged).

**Thread replies** notify, as today, everyone `@mentioned` anywhere in the thread (email + in-app). In addition, earlier **verified commenters** of the thread who were never mentioned get an **in-app `thread_reply` item only** — "a reply in a thread you participate in" without changing who receives email. A reply that `@mentions` you is a `comment_mention`.

**Shares**: `GrantsController.mint` checks `findActive(path, grantee)` before minting; if the grantee had no active grant, it creates a `share` item (and email). Permission changes on an existing grant stay silent. The cross-personal rule does not apply to shares (the recipient is a non-owner by definition). A folder share mints one grant per file, so it creates one item per file; the email is throttled (Decision 6).

## Decision 3 — listing visibility

Listing and the unread count use the same predicate as `/api/updates`: `isVisibleTo(path, email) || visibleGrantSet(email).has(path)`. An item whose current path fails it (grant revoked or expired, note moved into someone else's personal folder) is **skipped**, and is not counted. Visible items whose note no longer exists — doc handle tombstoned/gone, or `storage.exists(path)` false — are returned with `available: false` (rendered greyed out, still markable as read). Nothing in the listing path throws on a missing note.

Pagination is by id cursor (`before` = last id seen, newest first). Because filtering happens after the SQL page, the service keeps reading batches until it has `limit` visible items or runs out, and returns `nextBefore` when more rows may exist. `limit` defaults to 20, max 50.

## Decision 4 — following renames through doc handles

Every note already has a durable `doc_handles` row whose `path` is rewritten by **both** rename paths: `FilesService.move` (API, incl. folder moves via `updatePathPrefix`) and `RenameTrackingService.handleRename` (external renames, e.g. Obsidian). Deletes tombstone it. So each item stores the note's `handleId` (minted with `findOrCreateForPath` at creation, as the emails already do for their links) and resolves the current path from it at read time:

- active handle → current path; if it differs from the stored one, the row's `path` is refreshed lazily (and its snippet dropped if the new path is E2E);
- tombstoned/unknown handle → last stored path, `available: false`;
- no handle (mint failed, or a non-`.md` share target) → stored path.

This covers API moves, external renames and folder moves with **no edits** to `files.service.ts` / `rename-tracking.service.ts` (both being changed by the Trash work) and no move hook to keep in sync. The trade-off is one batched `doc_handles` lookup per listing page.

## Decision 5 — freshness reuses the existing `/ws` socket

`ChangesBadge` does not refresh at all (it is loaded once on auth), but the app does hold an app-wide realtime channel: every signed-in tab keeps the `/ws` socket open and the gateway already fans per-user events out with `fanoutToEmail` (`file:tree-update`, personal `file:changed`). The inbox reuses it:

- `NotificationInboxService` exposes `onChanged(listener)`; the gateway subscribes and sends `{ type: 'notifications:changed' }` — no payload, no path — to the recipient's sockets when an item is created or read (so other tabs stay in sync).
- The client re-fetches the unread count on that frame, on socket `connected` (initial + reconnect, covering anything missed while offline) and on window `focus`. No interval polling.

## Decision 6 — email preferences and unsubscribe

- `users.emailNotifications` (`varchar`, default `'all'`; `synchronize: true` adds it). Gating happens inside `NotificationService` after the existing cross-personal / allowlist checks: `all` → everything; `mentions` → comment mentions (incl. a reply that mentions you), doc mentions, shares; `none` → nothing. In-app items ignore the preference.
- `GET|PUT /api/notifications/preferences` is session-only (`JwtAuthGuard`, like `users/me/tours`): an API key cannot change account settings.
- **Unsubscribe token**: a JWT signed with `resolveJwtSecret()` carrying `{ sub: <email>, purpose: 'notification-unsubscribe' }`, 365-day expiry. It deliberately has **no `email` claim**, so `AuthService.verifyToken` (which canonicalizes `payload.email`) rejects it — it can never double as a session token, the same property the PIN unlock tokens rely on. Verification requires the exact purpose; a session JWT or PIN token presented here is rejected (and vice versa).
- `GET /api/notifications/unsubscribe?token=…` sets the preference to `none` and renders a small self-contained HTML confirmation page (400 page on an invalid/expired token). `POST` on the same URL does the same for RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`). The GET has a side effect by design (per the brief); link scanners that prefetch could unsubscribe someone — acceptable for a setting the user can flip back in Settings, and the page says so.
- Every notification email gets nodemailer's `list.unsubscribe` (→ `List-Unsubscribe`) plus the one-click header and a footer link.
- **Share email** ("{actor} shared “{note}” with you", CTA "Open note"): only to registered users (same as mention emails), respects preference + domain allowlist, and is throttled in memory to one per grantor→grantee per 60 s so a folder share sends one email instead of one per file.

## Decision 7 — module wiring

A new `@Global()` `NotificationsModule` provides `NotificationInboxService`, `NotificationPreferencesService`, the retention cron and the two controllers. It also becomes the provider of the existing email `NotificationService` (file stays in `comments/`; `CommentsModule` stops providing it). Reason: `GrantsController` must reach the mailer, and importing `CommentsModule` from `GrantsModule` would close the `FilesModule → … → CommentsModule` loop documented in `ot.gateway.ts`. Exactly one instance exists, so the test-debug counters keep working. New constructor params on `CommentsService`, `DocMentionService`, `GrantsController` and `OTGateway` are `@Optional()` and last, so existing positional test constructions are unchanged.

Endpoints use `CombinedAuthGuard` + `@RequiredScope('updates:read')` (same as `/api/updates/mark-seen`) for list/count/read/read-all.

## Decision 8 — snippet

Comment/reply: the comment text; doc mention: the line holding the mention. `@[name](email)` collapses to `@name`, whitespace collapses, truncated to 160 chars with an ellipsis. Never stored for E2E (`_users/*/_secure/…`) paths (comments and doc-mention processing don't run there anyway; a later move into `_secure/` clears it).

A snippet quotes the note body or its comments, so it follows the note PIN with the same rule as `GET /api/files/search` (main's e92c7a2): for a PIN-locked note, `GET /api/notifications` keeps the item but returns `snippet: null` unless the request carries that note's unlock cookie or `X-Kalepin-Unlock` header. Added at merge, when main gained PIN checks on search and the change feed.

## Decision 9 — retention

`NotificationRetentionService` runs `@Cron(EVERY_DAY_AT_3AM)` (pattern: `AccessLogRetentionService`) and deletes rows with `readAt IS NOT NULL AND createdAt < now − N days`; `N = NOTIFICATION_RETENTION_DAYS` (default 90, `0` disables). Unread items are never pruned.

## UI

- `NotificationBell` sits in `ActionCluster` before the help button: bell icon, unread badge (`99+` cap), `aria-label="Notifications, N unread"`, `aria-expanded`.
- Dropdown (`role="dialog"`): header with "Mark all as read"; list of item buttons — actor (display name or email local part), verb ("mentioned you in", "replied in", "shared … with you"), note title, snippet, relative time; unread items get an accent dot and stronger text; unavailable items are greyed with "(no longer available)". Empty state "You're all caught up". "Load more" when `nextBefore` is set.
- Keyboard: Enter/Space toggles; on open focus moves to the first item; ↑/↓ move between items; Escape closes and returns focus to the bell; outside mousedown closes (same as `HelpDropdown` / overflow menu).
- Click: mark read (optimistic), close, `setView('workspace')`, then App's existing search-modal path — `pendingThreadIdRef` + `setRailTab('comments')` + `openFile(path, heading)`.
- Settings → "Email notifications": three radios bound to `GET/PUT /api/notifications/preferences`.

## Risks / open points

- **Trash (parallel change)**: if trashing tombstones the doc handle or removes the file, items show as unavailable (good). If it moves the file with `FilesService.move` into a visible trash folder, the handle follows and items would point into the trash; filtering trash paths is a one-line addition in `NotificationInboxService.isListable`.
- Folder shares create one item per file; collapsing them into one item is a possible follow-up.
- The in-memory share-email throttle resets on restart (acceptable, same as PIN rate limits).
