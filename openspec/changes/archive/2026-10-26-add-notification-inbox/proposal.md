# In-app notification inbox + per-user email preferences

## Why

Mentions, thread replies and shares only reach people by email today. There is no in-app list, no unread count, and no way to turn the emails off short of asking an admin to unset `SMTP_USER`. Users who live in the app miss mentions buried in their mailbox; users who don't want email have no opt-out, and the emails carry no unsubscribe link (which also hurts deliverability with providers that expect `List-Unsubscribe`).

## What Changes

- **New `notifications` table** holding one in-app item per (recipient, event): actor, recipient, type, path (+ the note's doc handle so the path follows renames), `threadId`/`commentId` where relevant, a short snippet, `createdAt`, `readAt`. Keyed by the recipient's canonical email. `mention_notifications` stays what it is — the email dedup ledger.
- **Four event types**, created at the chokepoints that already decide on emails, after the existing suppression rules (no self-notification; mentions/replies in a personal note are suppressed for non-owners):
  - `comment_mention` — `@mention` in a new comment or a reply.
  - `doc_mention` — a newly added `@mention` in a note body.
  - `thread_reply` — a reply in a thread you were mentioned in or commented in.
  - `share` — someone grants you access to a note you could not see before (`POST /api/grants`).
- In-app items are **not** subject to the email anti-spam gates (10 s cooldown, one-doc-mention-email-per-doc-ever); they have their own dedup (one item per recipient per comment; one unread doc-mention item per recipient per note).
- **API** (recipient-scoped; another user's id is a 404):
  - `GET /api/notifications?limit&before` — newest first, cursor-paginated; items whose note is no longer visible to the recipient are skipped; items whose note was deleted come back with `available: false`.
  - `GET /api/notifications/unread-count`
  - `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`
  - `GET|PUT /api/notifications/preferences` — `{ email: 'all' | 'mentions' | 'none' }`.
  - `GET|POST /api/notifications/unsubscribe?token=…` — public, signed purpose-scoped token; sets the preference to `none` and renders a small confirmation page.
- **Realtime freshness** reuses the existing per-user `/ws` socket: the server pushes `notifications:changed` to the recipient's sessions when an item is created or read; the client re-fetches the count on that frame, on socket (re)connect and on window focus.
- **Email preferences**: new `users.emailNotifications` column (`all` default = today's behaviour; `mentions` = mentions + shares, no thread-reply emails; `none`). In-app items are created regardless. Every notification email carries an unsubscribe link and `List-Unsubscribe` / `List-Unsubscribe-Post` headers.
- **New share email** ("X shared “Note” with you"), sent to registered users when a grant gives them new access, throttled to one per grantor→grantee per minute so a folder share (one grant per file) sends one email.
- **Retention**: a daily cron deletes read items older than 90 days (`NOTIFICATION_RETENTION_DAYS`, `0` disables).
- **UI**: a bell in the top-bar action cluster with an unread badge, and a dropdown listing items (actor, "mentioned you in / replied in / shared … with you", snippet, relative time), unread styling, "Mark all as read", empty state. Clicking an item marks it read and opens the note, scrolling to the comment thread when there is one. A "Email notifications" section in Settings.

## Capabilities

### New Capabilities

- `notification-inbox`: in-app notification items — creation rules, storage, recipient-scoped API, visibility filtering, rename-following, retention, realtime refresh and the top-bar bell UI.

### Modified Capabilities

- `notification`: emails are gated by the recipient's email preference, carry an unsubscribe link + `List-Unsubscribe` headers, and a new share email is sent when a grant gives someone access.

## Impact

- **Backend**
  - `entities/inbox-notification.entity.ts` (new), `entities/user.entity.ts` (+`emailNotifications`), `entities/index.ts`, `app.module.ts` (entity + module registration).
  - `notifications/` (new module, `@Global`): `notification-inbox.service.ts`, `notification-preferences.service.ts`, `unsubscribe-token.ts`, `notification-snippet.ts`, `notifications.controller.ts`, `unsubscribe.controller.ts`, `notification-retention.service.ts`, `notifications.module.ts`.
  - `comments/notification.service.ts`: preference gating, unsubscribe link/headers, `notifyShare`. Its provider moves from `CommentsModule` to the global `NotificationsModule` so `GrantsController` can reach it without a module cycle.
  - `comments/comments.service.ts`, `comments/doc-mention.service.ts`: create inbox items before the email gates.
  - `grants/grants.controller.ts`: share item + email on mint when the grantee gains access.
  - `ot/ot.gateway.ts`: fan `notifications:changed` out to the recipient's sockets.
- **Frontend**
  - `components/NotificationBell.tsx` (new), `components/notification-format.ts` (+ test), `components/Settings/EmailNotificationsSection.tsx` (new).
  - `components/TopBar/TopBar.tsx`, `components/TopBar/ActionCluster.tsx` (one `inbox` prop threaded through), `components/SettingsPage.tsx` (one section), `App.tsx` (WS listeners + open handler), `api.ts` (appended client functions), `styles.css` (appended block).
- **E2E**: `packages/e2e/tests/notification-inbox.spec.ts`.
- **Not touched**: `files/files.service.ts`, `files/rename-tracking.service.ts` — paths follow renames through `doc_handles`, which both rename paths already maintain.
- **Out of scope**: MCP tools for notifications; digest emails; per-type in-app muting.
