## Purpose

Provides `@`-mention autocomplete in the editor, floating comment input, and reply textarea, resolving candidates via a shared users endpoint.

## Requirements

### Requirement: Users list endpoint
The system SHALL expose `GET /api/users` which returns every registered user as `[{ email, displayName }]`, protected by `CombinedAuthGuard` so either a JWT or an API key grants access.

#### Scenario: Authenticated request returns all users
- **WHEN** a client calls `GET /api/users` with a valid JWT or API key
- **THEN** the response SHALL contain every registered user, regardless of activity status
- **AND** each entry SHALL include `email` and `displayName`

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client calls `GET /api/users` without a valid JWT or API key
- **THEN** the response SHALL be a 401

### Requirement: Autocomplete trigger on @
Typing `@` in the `FloatingInput` or reply textarea SHALL open an autocomplete dropdown positioned near the caret, populated with all registered users and filtered case-insensitively against `displayName` and `email` as the user types.

#### Scenario: Dropdown opens on @
- **WHEN** the user types `@` in the comment input
- **THEN** a dropdown SHALL appear anchored near the caret listing all registered users

#### Scenario: Filtering by typed characters
- **WHEN** the user has typed `@ar` after the trigger
- **THEN** the dropdown SHALL only show users whose `displayName` or `email` contains `ar` (case-insensitive)

#### Scenario: No matches dismisses dropdown
- **WHEN** the user has typed characters after `@` that match zero users
- **THEN** the dropdown SHALL dismiss

#### Scenario: @ must follow whitespace or start of text
- **WHEN** the user types `hello@` in the middle of a word
- **THEN** the dropdown SHALL NOT open, because the `@` is not preceded by whitespace or start of text

### Requirement: User selection inserts mention token
Clicking or pressing Enter on a highlighted user SHALL replace the `@` plus typed filter with `@[Display Name](email) `. Arrow keys SHALL move the highlight and Escape SHALL dismiss the dropdown without inserting anything.

#### Scenario: Click inserts mention
- **WHEN** the user clicks a user entry in the dropdown
- **THEN** the text `@[Display Name](email) ` SHALL be inserted at the `@` position

#### Scenario: Enter on highlighted entry inserts mention
- **WHEN** the user presses Enter while an entry is highlighted
- **THEN** the same insertion SHALL occur as for a click

#### Scenario: Missing display name falls back to email local-part
- **WHEN** the selected user has no `displayName` and email `alice@example.com`
- **THEN** the inserted token SHALL be `@[alice](alice@example.com) `

#### Scenario: Arrow keys navigate
- **WHEN** the dropdown is open and the user presses ArrowDown or ArrowUp
- **THEN** the highlighted entry SHALL move accordingly

#### Scenario: Escape dismisses without inserting
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the dropdown SHALL close and no text SHALL be inserted

### Requirement: Mention display in rendered comments
In rendered comments in the CommentsPanel, `@[name](email)` tokens SHALL be parsed and rendered as a styled chip that shows only the name. The chip SHALL NOT be clickable and SHALL NOT expose the email. The displayed name SHALL be whatever was captured at mention time rather than resolved live.

#### Scenario: Chip shows only the name
- **WHEN** a rendered comment contains `@[Alice](alice@example.com)`
- **THEN** the UI SHALL render a chip showing `Alice`
- **AND** the email SHALL NOT appear in the DOM output

#### Scenario: Snapshot name persists after user renames
- **WHEN** a mention was written as `@[Alice](alice@example.com)` and the user later changes their display name
- **THEN** the chip SHALL continue to render `Alice`

### Requirement: Edge cases for self-mention and duplicates
Self-mentions SHALL be allowed in the UI (the backend handles skipping self-notifications), and multiple mentions of the same user within one comment SHALL result in a single notification to that user.

#### Scenario: Self-mention in UI
- **WHEN** the current user types `@` and selects themselves
- **THEN** the mention SHALL be inserted without UI-level rejection

#### Scenario: Duplicate mentions send one notification
- **WHEN** a submitted comment contains two `@[Alice](alice@example.com)` tokens
- **THEN** Alice SHALL receive exactly one mention notification for that comment
