# Tasks — add notification inbox

## 1. Schema

- [x] 1.1 New entity `entities/inbox-notification.entity.ts` (`notifications` table, indexes on `(recipientEmail, id)`, `(recipientEmail, readAt)`, `(recipientEmail, commentId)`); export from `entities/index.ts`; add to the `app.module.ts` entity list.
- [x] 1.2 `users.emailNotifications` column (`varchar`, default `'all'`).

## 2. Inbox service

- [x] 2.1 `notifications/notification-snippet.ts`: collapse mention markup, collapse whitespace, truncate to 160 chars; null for E2E paths.
- [x] 2.2 `NotificationInboxService.record()`: canonicalize emails, drop self, drop cross-personal (non-share), dedup (comment id; unread doc mention per note; unread share per note), mint the doc handle, store, emit `changed`.
- [x] 2.3 `list()` with id cursor, batch handle resolution + lazy path refresh, visibility filter (`isVisibleTo || visibleGrantSet`), `available` flag (tombstone / `storage.exists`), actor display names.
- [x] 2.4 `unreadCount()`, `markRead()` (404 for foreign/unknown ids), `markAllRead()`, `deleteReadOlderThan()`.
- [x] 2.5 `onChanged(listener)` hook for realtime fan-out.

## 3. Preferences + unsubscribe

- [x] 3.1 `NotificationPreferencesService`: `get(email)`, `set(email, pref)`, `allowsEmail(email, kind)`.
- [x] 3.2 `unsubscribe-token.ts`: `mintUnsubscribeToken(email)` / `verifyUnsubscribeToken(token)` with `purpose: 'notification-unsubscribe'`, no `email` claim, 365-day expiry.
- [x] 3.3 `UnsubscribeController` (`GET|POST /api/notifications/unsubscribe`), HTML confirmation + 400 page.

## 4. API + module

- [x] 4.1 `NotificationsController`: `GET /api/notifications`, `GET /unread-count`, `POST /:id/read`, `POST /read-all` (CombinedAuthGuard + `updates:read`); `GET|PUT /preferences` (JwtAuthGuard).
- [x] 4.2 `NotificationRetentionService` daily cron (`NOTIFICATION_RETENTION_DAYS`, default 90, 0 disables).
- [x] 4.3 `@Global() NotificationsModule`; move the email `NotificationService` provider here from `CommentsModule`; register in `app.module.ts`.

## 5. Chokepoint wiring

- [x] 5.1 `CommentsService`: comment-mention and reply items before the email gates; in-app-only `thread_reply` items for earlier verified commenters.
- [x] 5.2 `DocMentionService`: `doc_mention` item (with heading + line snippet) before the email gates.
- [x] 5.3 `GrantsController.mint`: `share` item + share email when the grantee had no active grant.
- [x] 5.4 `NotificationService`: preference gating per kind, unsubscribe footer link + `List-Unsubscribe` headers, `notifyShare` with 60 s grantor→grantee throttle.
- [x] 5.5 `OTGateway`: fan `notifications:changed` out to the recipient's sockets.

## 6. Backend tests

- [x] 6.1 Item creation at each chokepoint, incl. self / cross-personal suppression and cooldown independence.
- [x] 6.2 Listing: visibility filtering (revoked grant), unavailable notes, pagination, recipient isolation (foreign id → 404), read / read-all, unread count.
- [x] 6.3 Rename cascade through doc handles (file rename, folder move).
- [x] 6.4 Email preference gating; unsubscribe token (valid, wrong purpose, tampered, not a session token); unsubscribe controller.
- [x] 6.5 Retention.

## 7. Frontend

- [x] 7.1 `api.ts`: types + `listNotifications`, `getUnreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `setNotificationPreferences` (appended at the end).
- [x] 7.2 `components/notification-format.ts` (verb phrase, note title, actor label, relative time, badge text) + vitest.
- [x] 7.3 `NotificationBell` component (badge, dropdown, mark all, empty state, load more, keyboard, outside click).
- [x] 7.4 Thread an `inbox` prop through `TopBar` → `ActionCluster`; App: WS `notifications:changed` / `connected` + window focus refresh; open handler reusing the thread/heading selection path.
- [x] 7.5 Settings → "Email notifications" section.
- [x] 7.6 Styles appended under `/* ── Notification inbox ── */`.

## 8. E2E + verification

- [x] 8.1 `packages/e2e/tests/notification-inbox.spec.ts`: A mentions B → B sees badge + item → click opens the thread and clears the badge; mark all as read; unsubscribe link sets the preference to `none`.
- [x] 8.2 Backend build + new and neighbouring unit tests; frontend `tsc -b` + vitest; `openspec validate add-notification-inbox --strict`.
- [x] 8.3 Snippets follow the note PIN: `NotificationsController.list` blanks the snippet of a locked note without its unlock, like search (`notifications.controller.pin.test.ts`).
