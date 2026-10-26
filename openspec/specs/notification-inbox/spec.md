# notification-inbox Specification

## Purpose
TBD - created by archiving change add-notification-inbox. Update Purpose after archive.
## Requirements
### Requirement: Notification items are stored per recipient

The system SHALL maintain a `notifications` table with one row per in-app notification: `id`, `recipientEmail` (canonical), `actorEmail` (canonical), `type` (`comment_mention` | `doc_mention` | `thread_reply` | `share`), `path`, `handleId` (nullable doc handle of the note), `threadId` (nullable), `commentId` (nullable), `heading` (nullable), `snippet` (nullable, at most 160 characters), `createdAt` and `readAt` (nullable). This table SHALL be separate from `mention_notifications`, which remains the email dedup ledger.

#### Scenario: Item captures the event
- **WHEN** alice@x.com mentions bob@x.com in a comment on `Notes/Plan.md`
- **THEN** a row is stored with `recipientEmail=bob@x.com`, `actorEmail=alice@x.com`, `type=comment_mention`, `path=Notes/Plan.md`, the thread and comment ids, a snippet of the comment, and `readAt=null`

#### Scenario: Mention markup is collapsed in the snippet
- **WHEN** the comment text is `Hey @[bob](bob@x.com) can you check?`
- **THEN** the stored snippet is `Hey @bob can you check?`

#### Scenario: No snippet for end-to-end encrypted paths
- **WHEN** an item is created for, or its note later moves to, a path under `_users/{email}/_secure/`
- **THEN** no snippet is stored or returned for it

### Requirement: Items are created at the notification chokepoints

The system SHALL create in-app items where notification emails are decided: comment mentions (new comment or reply), doc mentions (newly added mention in a note body), thread replies, and grant mints. Items SHALL be created after the user-facing suppression rules and SHALL NOT be subject to the email anti-spam gates (the 10-second cooldown and the one-doc-mention-email-per-document rule). Items SHALL be created regardless of the recipient's email preference.

#### Scenario: Comment mention
- **WHEN** a registered user is `@mentioned` in a new comment by another user
- **THEN** a `comment_mention` item is created for them

#### Scenario: Mention inside a reply
- **WHEN** a reply `@mentions` a registered user
- **THEN** a `comment_mention` item is created for them (not `thread_reply`)

#### Scenario: Reply notifies thread participants
- **WHEN** a reply is posted in a thread
- **THEN** a `thread_reply` item is created for every user previously `@mentioned` in the thread and for every earlier verified commenter of the thread, excluding the reply author

#### Scenario: Doc mention
- **WHEN** a note save adds a mention of a registered user that was not in the previous content
- **THEN** a `doc_mention` item is created for them with the nearest heading slug above the mention

#### Scenario: Share
- **WHEN** an owner mints a grant for bob@x.com on a note bob had no active grant for
- **THEN** a `share` item is created for bob@x.com

#### Scenario: Permission change is silent
- **WHEN** an owner re-shares a note with someone who already holds an active grant on it (changing the permission)
- **THEN** no new `share` item is created

#### Scenario: Email cooldown does not drop the item
- **WHEN** a user is mentioned twice within 10 seconds in different comments
- **THEN** two in-app items exist even though the second email is suppressed by the cooldown

### Requirement: Self and cross-personal events are suppressed

The system SHALL NOT create an item when the recipient is the actor. The system SHALL NOT create a mention or reply item for a note under `_users/{owner}/…` when the recipient is not the owner, matching the email suppression rule. Share items are exempt from the cross-personal rule.

#### Scenario: Self-mention
- **WHEN** alice@x.com mentions herself in a comment
- **THEN** no item is created

#### Scenario: Mention in someone else's personal note
- **WHEN** alice@x.com mentions bob@x.com in a comment on `_users/alice@x.com/diary.md`
- **THEN** no item is created for bob@x.com

#### Scenario: Owner mentioned in their own personal note
- **WHEN** bob@x.com (a grantee) mentions alice@x.com on `_users/alice@x.com/diary.md`
- **THEN** a `comment_mention` item is created for alice@x.com

### Requirement: Items are deduplicated

The system SHALL create at most one item per recipient per comment id, and SHALL NOT create a `doc_mention` item while an unread `doc_mention` item already exists for the same recipient and note.

#### Scenario: Same comment processed twice
- **WHEN** the same comment would notify the same recipient twice
- **THEN** only one item exists

#### Scenario: Doc mention churn
- **WHEN** a mention is removed and re-added to a note while the recipient's previous doc-mention item for that note is still unread
- **THEN** no second item is created

### Requirement: Recipient-scoped notification API

The system SHALL expose, to authenticated users with the `updates:read` permission:
- `GET /api/notifications?limit&before` returning `{ items, nextBefore }`, newest first, `limit` defaulting to 20 and capped at 50, `before` an item id cursor;
- `GET /api/notifications/unread-count` returning `{ count }`;
- `POST /api/notifications/:id/read`;
- `POST /api/notifications/read-all`.

Each item SHALL include `id`, `type`, `actorEmail`, `actorName`, `path`, `threadId`, `commentId`, `heading`, `snippet`, `createdAt`, `readAt` and `available`. Every endpoint SHALL only ever read or modify the caller's own items; an id belonging to another user SHALL return 404.

#### Scenario: Newest first with cursor
- **GIVEN** bob has items 1..30
- **WHEN** bob GETs `/api/notifications?limit=20`
- **THEN** items 30..11 are returned and `nextBefore` is 11
- **AND** `GET /api/notifications?limit=20&before=11` returns items 10..1 with `nextBefore=null`

#### Scenario: Another user's id
- **WHEN** carol POSTs `/api/notifications/{bob's item id}/read`
- **THEN** the response is 404 and bob's item stays unread

#### Scenario: Mark all as read
- **WHEN** bob POSTs `/api/notifications/read-all`
- **THEN** all of bob's unread items get `readAt` set and `unread-count` returns 0

### Requirement: Listing honours current visibility

The list and the unread count SHALL only include items whose note is visible to the recipient now, using the same predicate as `/api/updates` (owner-or-shared-vault, or an active grant on the path). Items whose note no longer exists SHALL be returned with `available: false` instead of failing the request.

#### Scenario: Grant revoked
- **GIVEN** bob has a `share` item for `_users/alice@x.com/plan.md`
- **WHEN** alice revokes the grant
- **THEN** the item no longer appears in bob's list and is not counted as unread

#### Scenario: Note deleted
- **GIVEN** bob has a `comment_mention` item for `Notes/Old.md`
- **WHEN** `Notes/Old.md` is deleted
- **THEN** the item is still listed with `available: false` and the request succeeds

### Requirement: Item paths follow renames and moves

An item's path SHALL follow its note through renames and moves, including folder moves and renames made outside the app, by resolving the note's doc handle at read time.

#### Scenario: Note renamed
- **GIVEN** bob has an item for `Notes/Plan.md`
- **WHEN** the note is renamed to `Notes/Roadmap.md`
- **THEN** the item is listed with `path=Notes/Roadmap.md`

#### Scenario: Folder moved
- **GIVEN** bob has an item for `Projects/A/spec.md`
- **WHEN** the folder `Projects/A` is moved to `Archive/A`
- **THEN** the item is listed with `path=Archive/A/spec.md`

### Requirement: Realtime unread refresh

When an item is created for, or read by, a user, the server SHALL send `{ "type": "notifications:changed" }` (no path or content) over the `/ws` socket to that user's sessions only. The client SHALL re-fetch the unread count on that message, when the socket (re)connects, and when the window regains focus.

#### Scenario: Live badge update
- **GIVEN** bob has the app open
- **WHEN** alice mentions bob in a comment
- **THEN** bob's bell badge shows the new unread count without a reload

### Requirement: Read items are pruned after 90 days

A daily job SHALL delete items that are read and were created more than `NOTIFICATION_RETENTION_DAYS` days ago (default 90; `0` disables pruning). Unread items SHALL never be pruned.

#### Scenario: Old read item
- **GIVEN** an item created 91 days ago and read
- **WHEN** the retention job runs
- **THEN** the item is deleted

#### Scenario: Old unread item
- **GIVEN** an item created 200 days ago and never read
- **WHEN** the retention job runs
- **THEN** the item is kept

### Requirement: Notification bell in the top bar

The top bar's action cluster SHALL show a bell button with an unread badge (capped at `99+`) that opens a dropdown listing the user's items: actor name, a verb phrase ("mentioned you in", "replied in", "shared … with you") with the note title, the snippet, and a relative time. Unread items SHALL be visually distinct. The dropdown SHALL offer "Mark all as read" and show an empty state when there are no items. It SHALL be keyboard accessible and close on Escape or an outside click.

#### Scenario: Open an item
- **WHEN** the user clicks an item for a comment thread
- **THEN** the item is marked read, the dropdown closes, the note opens, the comments rail opens, and the thread is scrolled to and highlighted

#### Scenario: Open a doc mention
- **WHEN** the user clicks a `doc_mention` item that has a heading
- **THEN** the note opens scrolled to that heading

#### Scenario: Unavailable item
- **WHEN** the user clicks an item with `available: false`
- **THEN** the item is marked read and no navigation happens

#### Scenario: Keyboard
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** it closes and focus returns to the bell button

