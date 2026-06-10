# Tasks: @Mention Notifications

## Backend

- [x] **User list endpoint** — Create `UsersController` with `GET /api/users` returning `[{ email, displayName }]`, protected by `CombinedAuthGuard`
- [x] **Mention extraction utility** — Create `extractMentions(text): string[]` function parsing `@[name](email)` pattern
- [x] **Notification service** — Create `NotificationService` with `notifyMention()` method, reusing SMTP config from auth, with dev-mode console fallback
- [x] **Wire notifications into CommentsService** — Call mention extraction + notification after `addComment()` and `replyToThread()`, skipping self-mentions and deduplicating

## Frontend

- [x] **User list API call** — Add `fetchUsers()` to `api.ts`, with in-memory cache
- [x] **MentionAutocomplete component** — Dropdown triggered by `@` in text inputs, keyboard navigation, user filtering
- [x] **Integrate autocomplete into FloatingInput** — Detect `@` keystroke, show dropdown, insert `@[name](email)` on selection
- [x] **Integrate autocomplete into reply textarea** — Same logic as FloatingInput, positioned relative to the textarea in CommentsPanel
- [x] **Mention rendering** — Parse `@[name](email)` in comment text display, render as styled non-clickable chip (`.mention` CSS class)

## Email

- [x] **Notification email template** — HTML template with author, comment text, note title, and thread link
