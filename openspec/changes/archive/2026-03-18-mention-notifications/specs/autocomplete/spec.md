# Spec: Mention Autocomplete

## User List Endpoint

- `GET /api/users` returns all registered users as `[{ email, displayName }]`
- Protected by `CombinedAuthGuard` (JWT or API key)
- Returns all users regardless of activity status

## Autocomplete Trigger

- Typing `@` in FloatingInput or reply textarea activates autocomplete
- A dropdown appears positioned near the input
- The dropdown lists all registered users, filtered by characters typed after `@`
- Filtering matches against both `displayName` and `email` (case-insensitive)
- If no users match the filter, the dropdown dismisses

## User Selection

- Click or Enter on a user inserts `@[Display Name](email) ` into the text at the `@` position
- If the user has no display name, the email local part is used as the name (e.g., `@[alice](alice@example.com)`)
- Arrow keys navigate the dropdown; Enter selects the highlighted item
- Escape dismisses the dropdown without inserting

## Mention Display

- In rendered comments (CommentsPanel), `@[name](email)` is parsed and displayed as a styled chip showing only the name
- The chip is not clickable and does not expose the email
- Display name is snapshotted at mention time — no live resolution

## Edge Cases

- Self-mention is allowed in the UI (backend skips self-notification)
- Multiple mentions of the same user in one comment: only one notification sent
- Mention in the middle of a word (e.g., `hello@[Name](email)`) — the `@` must be preceded by a space or be at the start of the text to trigger autocomplete
