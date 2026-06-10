## ADDED Requirements

### Requirement: get_updates MCP tool exists
The system SHALL expose a `get_updates` tool via both the HTTP MCP service and the stdio MCP server. The tool SHALL require authentication.

#### Scenario: Tool is listed in MCP capabilities
- **WHEN** an MCP client lists available tools
- **THEN** `get_updates` appears with a description indicating it returns recent note changes

### Requirement: get_updates returns changes since last activity
The tool SHALL query `note_changes` for rows where `created_at > user.last_active_at`. If `last_active_at` is NULL, it SHALL return all tracked changes.

#### Scenario: User with previous activity
- **WHEN** user calls `get_updates` and their `last_active_at` is `2026-03-10T00:00:00Z`
- **THEN** the response contains only changes with `created_at` after that timestamp

#### Scenario: User with no previous activity
- **WHEN** user calls `get_updates` and their `last_active_at` is NULL
- **THEN** the response contains all tracked changes in the `note_changes` table

### Requirement: get_updates accepts optional since parameter
The tool SHALL accept an optional `since` ISO 8601 datetime parameter that overrides `last_active_at`. When provided, changes since that timestamp are returned instead.

#### Scenario: Explicit since parameter
- **WHEN** user calls `get_updates` with `since: "2026-03-12T00:00:00Z"`
- **THEN** the response contains changes after that timestamp, regardless of `last_active_at`

### Requirement: Response is grouped by folder
The response SHALL group changes by the top-level folder of the file path. Files at the vault root SHALL be grouped under `"/"`.

#### Scenario: Changes in multiple folders
- **WHEN** changes exist in `projects/roadmap.md` and `journal/2026-03-11.md`
- **THEN** the response has `by_folder` keys `"projects/"` and `"journal/"` with their respective changes

### Requirement: Response includes period and stats
The response SHALL include a `period` object with `since` and `until` timestamps, and a `stats` object with counts of created, modified, and deleted notes.

#### Scenario: Response structure
- **WHEN** there are 2 created, 3 modified, and 1 deleted note since last activity
- **THEN** the response includes `stats: { created: 2, modified: 3, deleted: 1 }`

### Requirement: Each file entry includes all diffs
For each changed file, the response SHALL include the path, action (last action for that file), number of changes, last changed timestamp, and an array of all diffs in chronological order.

#### Scenario: File modified multiple times
- **WHEN** `projects/roadmap.md` was modified 3 times since last activity
- **THEN** its entry has `changes: 3` and `diffs` contains all 3 unified diffs in chronological order

#### Scenario: File created then modified
- **WHEN** `journal/new.md` was created and then modified once
- **THEN** its entry has `action: "modified"`, `changes: 2`, and `diffs` contains the creation content and the subsequent diff

### Requirement: get_updates is available as REST endpoint
The system SHALL expose a `GET /api/updates` endpoint (or similar) that the MCP tools delegate to, authenticated via JWT or API key.

#### Scenario: REST endpoint returns same data as MCP tool
- **WHEN** a user calls the REST endpoint with a valid token
- **THEN** the response matches the structure returned by the MCP tool
