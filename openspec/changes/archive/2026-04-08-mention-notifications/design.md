## Context

Kalepin has comment-level mentions (`@[Name](email)`) with basic email notifications but no document body mentions, no notification dedup, and no reply-chain awareness. The stars system caps at 5 items. Users who get mentioned lack an automatic way to track the relevant document and can be spammed by repeated notifications.

The email infrastructure (Nodemailer/SMTP via Mailjet) is already in place for magic links and comment mentions. The frontend uses TipTap with custom extensions (wikilinks, images, etc.) and has a `MentionAutocomplete` component for comments. User colors are deterministic via `getColorForUser(userId)` hashing over 10 colors.

## Goals / Non-Goals

**Goals:**
- Document body mentions with visual badge and autocomplete
- Smart notification pipeline: dedup, cooldown, reply-chain awareness
- Auto-star on mention so users can track documents they're involved in
- Polished email templates for all notification types
- Simple, reliable — no over-engineering

**Non-Goals:**
- In-app notification center / inbox (email only for now)
- Real-time mention sync via WebSocket (use save-based detection)
- Mention permissions or mention-specific access control
- Mobile push notifications
- Batch digest emails

## Decisions

### 1. TipTap Mention as inline Node (not Mark)

Use a TipTap `Node` extension (inline, atom) rather than a Mark. Mentions are discrete entities with structured data (email), not arbitrary text formatting. The node stores `email` as an attribute and renders as a pill/chip via a NodeView.

**Alternative considered:** Mark-based mention — rejected because marks apply to text ranges and don't carry structured metadata cleanly. A node is the standard TipTap/ProseMirror pattern for mentions.

### 2. Markdown serialization: `@[pseudo](email)`

Serialize mention nodes to `@[pseudo](email)` in the `.md` file. This is consistent with the existing comment mention format, and in Obsidian it renders as a recognizable link-like syntax.

**Parsing:** On load, the markdown-to-ProseMirror parser detects `@[...](...)` patterns and creates Mention nodes. The regex is the same one used in `extract-mentions.ts`.

**Alternative considered:** HTML `<span>` tags — rejected for Obsidian compatibility. Custom syntax like `@{email}` — rejected for inconsistency with comment format.

### 3. Mention detection on save (not real-time)

When the backend receives updated `.md` content on save:
1. Read old content from disk
2. Extract mentions from both old and new content using the existing regex
3. Compute `new_mentions = new_set - old_set`
4. For each new mention, trigger the notification pipeline

This avoids spam from typing/deleting/retyping a mention and keeps the implementation simple. The save path already exists in the file storage service.

**Alternative considered:** Real-time detection via WebSocket/CRDT operations — rejected as overly complex and prone to false triggers during editing.

### 4. SQLite `mention_notifications` table for tracking

```
mention_notifications
├── id           INTEGER PRIMARY KEY AUTOINCREMENT
├── userId       INTEGER NOT NULL (FK → users.id)
├── type         TEXT NOT NULL ('doc' | 'comment')
├── docPath      TEXT NOT NULL
├── threadId     TEXT (null for doc mentions)
├── commentId    TEXT (null for doc mentions)
├── sentAt       DATETIME DEFAULT CURRENT_TIMESTAMP
└── INDEX (userId, type, docPath)
└── INDEX (userId, sentAt)
```

**Anti-spam pipeline (checked in order):**
1. Self-mention → skip
2. Per-event dedup → `SELECT 1 WHERE userId=? AND commentId=?` (comments) or `userId=? AND type='doc' AND docPath=?` (docs)
3. Doc-mention dedup → for `type='doc'`, existence check on `(userId, docPath)` is the same as step 2
4. Hard cooldown → `SELECT 1 WHERE userId=? AND sentAt > now() - 10s`

If all gates pass, send email and INSERT the record.

**Alternative considered:** In-memory dedup with TTL cache — rejected because it doesn't survive restarts and doesn't provide audit trail.

### 5. Reply-chain notifications via thread scan

When a reply is posted to a comment thread:
1. Load all comments in the thread from the sidecar
2. Extract mentions from every comment's text (not just the new reply)
3. Union with any new mentions in the current reply
4. For each unique email (excluding the reply author), run through the anti-spam pipeline and send

This is stateless — no extra state beyond what's already in the sidecar. The thread is small (a few comments), so scanning is cheap.

**Email subject varies:**
- If the user is explicitly @mentioned in the new reply: `"[Kalepin] {author} mentioned you in a comment on '{docTitle}'"`
- If the user was mentioned earlier in the thread (reply-chain): `"[Kalepin] {author} replied in a thread where you were mentioned in '{docTitle}'"`

### 6. Auto-star via idempotent upsert

When a user is mentioned (in doc or comment), auto-star the document for them. Use `INSERT OR IGNORE` on the `starred_items` table (unique constraint on `userId, type, path` already exists). No limit check needed since MAX_STARS is being removed.

### 7. Mention badge rendering

The TipTap NodeView renders as:

```
┌─●─@alice.smith──┐
└─────────────────┘
```

- Small circle (6px) filled with `getColorForUser(email)` color
- Text: `@` + email prefix (before `@`)
- Background: user color at 12% opacity
- Border-radius: 12px (full pill)
- Font-weight: 500
- Hover: tooltip with full email address
- Inline display, vertically centered with surrounding text

### 8. Section link for doc mention emails

When generating the email link for a doc mention, find the nearest heading above the mention position in the markdown content. Parse headings (`# ...`, `## ...`, etc.) and their line numbers, find the last heading before the mention's line, and slugify it for the URL anchor.

Link format: `{APP_URL}/doc/{path}#heading-slug`

If no heading exists above the mention, link to the doc without anchor.

### 9. Email template design

Three template variants sharing a common layout:
- **Header**: Kalepin logo/wordmark, subtle top border in accent color
- **Body**: Author attribution, context (comment text or "mentioned you in the document"), quoted text where applicable
- **CTA**: Primary button ("View document" or "View thread") in accent color (#e94560)
- **Footer**: "You received this because you were mentioned in Kalepin" + unsubscribe hint

Max-width 560px, system font stack, responsive. Dark background sections for quoted content.

## Risks / Trade-offs

**[Markdown round-trip fidelity]** → The `@[pseudo](email)` format looks like a markdown link in other editors. Obsidian will render it as `@pseudo` linked to `email` — acceptable degradation. Mitigation: consistent format with comments means users expect this pattern.

**[Save-based detection misses unsaved mentions]** → If a user mentions someone and never saves, no notification is sent. Mitigation: this is the expected behavior — unsaved work shouldn't trigger notifications.

**[Sidecar scan on every reply]** → Scanning all comments in a thread for mentions on every reply is O(n) in thread length. Mitigation: threads are typically < 20 comments; this is negligible.

**[10s cooldown may delay legitimate notifications]** → If a user is mentioned in two different documents saved within 10 seconds, the second notification is dropped. Mitigation: this is an extreme edge case; the dedup record still exists so no data is lost, just the email is delayed/skipped.

**[No unsubscribe mechanism]** → Users cannot opt out of mention emails. Mitigation: acceptable for now in a small team tool; add email preferences in a future change if needed.
