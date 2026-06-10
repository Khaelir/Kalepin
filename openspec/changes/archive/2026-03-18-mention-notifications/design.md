# Design: @Mention Notifications

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Comment Flow                           │
│                                                             │
│  User types "@" ──→ GET /api/users ──→ Dropdown             │
│       ↓ (selects user)                                      │
│  Inserts @[Name](email) into text                           │
│       ↓ (submits)                                           │
│  POST /api/comments or /api/comments/reply                  │
│       ↓                                                     │
│  CommentsService saves to sidecar                           │
│       ↓                                                     │
│  CommentsService extracts mentions from text                │
│       ↓                                                     │
│  NotificationService sends email per mentioned user         │
│       ↓                                                     │
│  Email: "X mentioned you in [note] — [comment text] [link]" │
└─────────────────────────────────────────────────────────────┘
```

## Backend

### User List Endpoint

New `UsersController` with a single route:

```
GET /api/users
→ [{ email, displayName }]
```

- Protected by `CombinedAuthGuard`
- Returns all registered users
- No pagination needed (small team scale)
- Optional `?q=` filter for future use, but frontend can filter client-side

### Mention Extraction

Utility function to parse `@[name](email)` from comment text:

```typescript
// Returns array of emails found in text
function extractMentions(text: string): string[]
```

Regex: `/@\[([^\]]+)\]\(([^)]+)\)/g` — captures name (group 1) and email (group 2).

### Notification Service

New `NotificationService` injected into `CommentsService`:

- Reuses the same nodemailer transporter config as `AuthService` (extract to shared module or duplicate — small enough to duplicate)
- Method: `notifyMention({ mentionedEmail, authorEmail, commentText, notePath, threadId })`
- Builds link using `APP_URL` + `/doc/{path}?thread={threadId}`
- Skips sending if mentioned user === comment author (don't notify yourself)
- Dev mode: logs notification to console if SMTP_USER is not set (same pattern as magic links)

### Integration Points

`CommentsService.addComment()` and `CommentsService.replyToThread()` call notification after save:

```typescript
const mentions = extractMentions(text);
for (const email of mentions) {
  if (email !== authorEmail) {
    await this.notificationService.notifyMention({ ... });
  }
}
```

## Frontend

### Autocomplete Component

New `MentionAutocomplete` component:

- Triggered when user types `@` in a text input
- Fetches user list once (cached in memory for the session)
- Renders a positioned dropdown below the `@` character
- Filters by display name or email as user types after `@`
- On selection: replaces `@partial` with `@[Display Name](email) ` in the input value
- On Escape or click outside: dismisses dropdown
- Keyboard navigation: arrow keys + Enter to select

### Integration with Existing Inputs

**FloatingInput** — Wrap or extend to detect `@` keystrokes and manage the autocomplete dropdown. The input is a simple `<input>` element, so we position the dropdown relative to it.

**Reply textarea** (in CommentsPanel) — Same `@` detection logic. The textarea is inline in the panel, dropdown appears below it.

Both inputs share the same autocomplete hook/logic, differing only in positioning.

### Mention Rendering

In `CommentsPanel`, comment text rendering parses `@[name](email)` and replaces with styled spans:

```tsx
function renderCommentText(text: string): ReactNode {
  // Split on @[name](email) pattern
  // Return mix of plain text strings and <span className="mention">name</span>
}
```

CSS class `.mention`:
- Background color (light blue/purple pill)
- Border-radius for pill shape
- Font-weight: 500
- Not clickable (no `<a>` tag, no cursor pointer)

## Email Template

Simple HTML email matching the magic link style:

```
Subject: [Kalepin] {Author} mentioned you in "{Note title}"

Body:
  {Author} mentioned you in a comment on "{Note title}":

  "{Comment text}"

  View the thread: {link}
```

Note title derived from the file path (strip extension, use last segment).

## Data Flow

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
│ Frontend │    │ Backend  │    │ Sidecar File │    │  Email   │
│          │    │          │    │              │    │          │
│ @trigger │───▶│GET /users│    │              │    │          │
│ dropdown │◀───│ [{email}]│    │              │    │          │
│          │    │          │    │              │    │          │
│ submit   │───▶│POST      │───▶│ save comment │    │          │
│ comment  │    │/comments │    │ with @[..]() │    │          │
│          │    │          │───▶│              │    │          │
│          │    │ extract  │    │              │    │          │
│          │    │ mentions │───▶│              │    │ send per │
│          │    │          │    │              │    │ mention  │
└──────────┘    └──────────┘    └──────────────┘    └──────────┘
```
