## Why

Mentions exist in comments but not in document bodies, and the notification system is minimal — no dedup, no reply-chain awareness, no anti-spam. Users who get mentioned have no easy way to track or return to the relevant document. This change builds a complete mention-to-notification pipeline: document body mentions with a visual badge, smart email notifications that don't spam, and auto-starring so mentioned users can stay on top of changes.

## What Changes

- **Remove the 5-star limit** on favorites — users can star as many documents as they want
- **TipTap Mention extension** for document body — `@` autocomplete, pill/chip badge with user color, serializes to `@[pseudo](email)` in markdown
- **Auto-star documents** for mentioned users (idempotent upsert)
- **Doc mention emails** — sent once per (user, doc) pair with a link to the section (`#nearest-heading`); never re-sent for the same doc
- **Comment mention emails** — sent per comment with thread deep link (`?thread=id`)
- **Reply-chain notifications** — when someone replies to a thread, all previously-mentioned users in that thread are notified (even without re-mention)
- **Anti-spam pipeline** — self-mention skip, per-event dedup, doc-mention dedup, 10-second hard cooldown per user
- **Upgraded email templates** — polished HTML design for all notification types
- **SQLite `mention_notifications` table** — tracks sent notifications for dedup and cooldown

## Capabilities

### New Capabilities
- `doc-mentions`: TipTap Mention extension for document body — autocomplete, badge rendering, markdown serialization (`@[pseudo](email)`), mention detection on save (diff new vs old)
- `mention-notification-tracking`: SQLite table and service for notification dedup, cooldown, and reply-chain awareness

### Modified Capabilities
- `star-files`: Remove MAX_STARS limit, add auto-star on mention (idempotent upsert for mentioned user)
- `notification`: Upgraded email templates, doc-mention emails with section links, reply-chain notifications for thread participants, anti-spam pipeline (per-event dedup + 10s cooldown)
- `comments`: Reply endpoint triggers notifications to all previously-mentioned users in thread (not just explicit @mentions in the new reply)

## Impact

- **Backend**: New `mention_notifications` entity + migration, new `MentionTrackingService`, changes to `StarsService` (remove limit, add upsert method), changes to `NotificationService` (new email types, templates, anti-spam), changes to `CommentsService` (reply-chain notification logic), new doc-mention detection in file save path
- **Frontend**: New TipTap Mention extension + node view, mention autocomplete in editor, updated star UI (remove limit guards/toasts), mention badge CSS
- **Shared**: Mention node type definitions
- **Database**: New `mention_notifications` table
- **API**: No new endpoints needed — mentions piggyback on existing save and comment endpoints; stars endpoints unchanged (just limit removal)
- **Email**: Three new email template variants (doc mention, comment mention, thread reply)
