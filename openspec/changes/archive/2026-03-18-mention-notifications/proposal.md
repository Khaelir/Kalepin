# @Mention Notifications in Comments

## Problem

When collaborators leave comments on notes, mentioned users have no way of knowing unless they happen to open the document. There's no mechanism to draw someone's attention to a specific thread or reply.

## Solution

Add @mention support to comments with autocompletion and email notifications:

1. **Autocomplete** — Typing `@` in any comment input (FloatingInput or reply textarea) triggers a dropdown listing registered users, filtered as you type.
2. **Mention storage** — Mentions are stored in plain text as `@[Display Name](email)`, snapshotting the display name at mention time.
3. **Rendering** — The frontend parses `@[name](email)` and renders a styled, non-clickable chip showing just the name.
4. **Email notification** — When a comment containing mentions is saved, the backend extracts mentioned emails and sends each user a notification email with the comment text and a direct link to the thread.

## Scope

- Backend: new `GET /api/users` endpoint, mention extraction, notification email sending
- Frontend: `@` trigger + dropdown in both comment inputs, mention rendering in CommentsPanel
- Email: notification template (reuses existing nodemailer/SMTP infra)

## Out of scope

- Thread subscription / "notify all participants on reply"
- Mute thread / opt-out preferences
- In-app notification center
- Display name live resolution (we snapshot at mention time)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | `@[Name](email)` in plain text | Keeps sidecar files readable, search indexable, MCP-compatible |
| Display name | Snapshot at mention time | Simpler; comments are point-in-time artifacts |
| Editing UX | Raw syntax visible while typing | GitHub-style — low effort, well-understood pattern |
| Mention rendering | Styled `<span>`, not clickable | Email is for identification, not navigation |
| Email sending | Synchronous in request handler | Small team scale; no queue needed yet |
