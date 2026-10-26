# Spec delta: daily-notes (ADDED)

## ADDED Requirements

### Requirement: Daily note endpoint

`POST /api/daily-notes` with `{ date, timezone }` SHALL return `{ path, id, created }` for the caller's note of that day, creating it when missing. `date` SHALL be a valid calendar date in `YYYY-MM-DD` form, otherwise the response SHALL be `400`. The client SHALL send its local date, so the note matches the user's day regardless of the server timezone.

#### Scenario: Create today's note
- **GIVEN** personal folders are enabled and no daily note exists for 2026-03-05
- **WHEN** Alice posts `{ date: '2026-03-05', timezone: 'Europe/Paris' }`
- **THEN** `_users/alice@example.com/Journal/2026-03-05.md` is created
- **AND** the response is `{ path: '_users/alice@example.com/Journal/2026-03-05.md', id, created: true }`

#### Scenario: Invalid date
- **WHEN** the caller posts `{ date: '2026-02-30' }` or `{ date: '05/03/2026' }`
- **THEN** the response is `400` and nothing is created

### Requirement: Daily note location

Daily notes SHALL live in `<DAILY_NOTES_FOLDER>/YYYY-MM-DD.md` inside the caller's personal folder when personal folders are enabled, and at the vault root otherwise. `DAILY_NOTES_FOLDER` SHALL default to `Journal`.

#### Scenario: Personal folders disabled
- **GIVEN** `PERSONAL_PATH` is unset
- **WHEN** a user requests the daily note for 2026-03-05
- **THEN** the path is `Journal/2026-03-05.md`

#### Scenario: Configured folder
- **GIVEN** `DAILY_NOTES_FOLDER=Daily` and personal folders are enabled
- **WHEN** Alice requests the daily note for 2026-03-05
- **THEN** the path is `_users/alice@example.com/Daily/2026-03-05.md`

### Requirement: Daily note content

A new daily note SHALL be rendered from the template named `Daily.md` directly in the templates folder, preferring the caller's personal templates folder over the shared one, with `{{title}}` set to the date and date tokens showing the requested day. Without a `Daily.md` template the content SHALL be `# {{date:dddd, MMMM D, YYYY}}` followed by an empty line. Reading `Daily.md` SHALL apply the same visibility and PIN checks as any template.

#### Scenario: Default content
- **GIVEN** no `Daily.md` template exists
- **WHEN** the daily note for 2026-03-05 is created
- **THEN** its content is `# Thursday, March 5, 2026\n\n`

#### Scenario: Personal Daily template wins
- **GIVEN** both `Templates/Daily.md` and `_users/alice@example.com/Templates/Daily.md` exist
- **WHEN** Alice creates her daily note
- **THEN** the content is rendered from her personal `Daily.md`

#### Scenario: Date tokens follow the requested day
- **GIVEN** `Daily.md` contains `{{title}} {{date:ddd}}`
- **WHEN** the daily note for 2026-03-05 is created on any day
- **THEN** the content is `2026-03-05 Thu`

### Requirement: Daily note is idempotent

If the daily note already exists the system SHALL return it unchanged with `created: false`. Concurrent requests for the same note SHALL create it exactly once; every request SHALL receive the same path.

#### Scenario: Second call returns existing note
- **GIVEN** the daily note for 2026-03-05 exists and the user edited it
- **WHEN** the user requests the daily note for 2026-03-05 again
- **THEN** the content is unchanged and `created` is `false`

#### Scenario: Concurrent requests
- **WHEN** five requests for the same daily note arrive concurrently
- **THEN** exactly one reports `created: true`, all return the same path, and the file is written once

### Requirement: MCP daily_note tool

The MCP server SHALL expose a `daily_note` tool, registered with the note-write tools, taking optional `date` (`YYYY-MM-DD`, default: today in `timezone`) and `timezone`. It SHALL return JSON `{ path, id, created, content }` with the same location, content and idempotency rules as the REST endpoint. When the note is PIN-locked and the call carries no valid unlock token, `content` SHALL be omitted and `kind: 'pin-protected'` returned.

#### Scenario: Agent opens today's note
- **WHEN** an agent with a write-scoped key calls `daily_note` with `{ date: '2026-03-05' }`
- **THEN** the response contains the daily note's `path`, `id` and `content`

### Requirement: Today's note shortcut and entry

The web app SHALL open today's daily note (in the browser's local date and timezone) when the user presses ⌘⇧D on macOS or Ctrl+Shift+D elsewhere, except while an `<input>` or `<textarea>` has focus, and SHALL offer a "Today's note" entry in the create popover. The note SHALL open in the editor without entering rename mode.

#### Scenario: Shortcut from the editor
- **WHEN** the user presses ⌘⇧D while editing a note
- **THEN** today's daily note is created if needed and opened

#### Scenario: Popover entry
- **WHEN** the user clicks "Today's note" in the create popover
- **THEN** today's daily note opens and the popover closes
