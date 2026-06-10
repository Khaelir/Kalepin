# e2e-test-harness Specification

## Purpose
TBD - created by archiving change e2e-test-suite. Update Purpose after archive.
## Requirements
### Requirement: Self-contained server lifecycle
The test harness SHALL start the backend (NestJS) and frontend (Vite) servers automatically before tests run and shut them down after all tests complete. No pre-running services SHALL be required.

#### Scenario: Test suite starts servers
- **WHEN** the e2e test suite is executed via `npm run test:e2e`
- **THEN** the backend starts with in-memory SQLite and a temporary vault directory, the frontend dev server starts and proxies to the backend, and tests begin only after both servers are healthy

#### Scenario: Test suite stops servers
- **WHEN** all tests have completed (pass or fail)
- **THEN** both servers are terminated and temporary directories are cleaned up

### Requirement: Test authentication without SMTP
The test harness SHALL provide authenticated browser sessions using directly-signed JWT tokens, bypassing the magic-link email flow entirely.

#### Scenario: Test gets authenticated page
- **WHEN** a test requests an authenticated editor page via the `editorPage` fixture
- **THEN** a valid JWT token is generated using the test JWT secret, set in the browser's storage, and the page is ready to interact with the editor

#### Scenario: Multiple authenticated users
- **WHEN** a collaboration test requests two authenticated sessions
- **THEN** each session receives a distinct JWT token with a unique user identity

### Requirement: Deterministic test data via temporary vault
The test harness SHALL create markdown files in a temporary vault directory before tests run, providing deterministic starting content for each test.

#### Scenario: Test with table content
- **WHEN** a test needs a note containing a markdown table
- **THEN** the fixture creates a `.md` file with the table content in the vault directory and the editor can open it immediately

#### Scenario: Test isolation
- **WHEN** multiple tests run in sequence
- **THEN** each test uses uniquely-named note files to avoid state pollution from prior tests

### Requirement: Multi-user collaboration fixtures
The test harness SHALL provide fixtures that set up two independent browser contexts connected to the same note via WebSocket, enabling real-time collaboration testing.

#### Scenario: Two users editing the same note
- **WHEN** a test uses the collaboration fixture
- **THEN** two browser contexts are created, each authenticated as a different user, both with the same note open in the editor, and WebSocket connections are established before the test body runs

#### Scenario: Waiting for remote sync
- **WHEN** one user types in their editor
- **THEN** the fixture provides a helper to wait until the other user's editor reflects the change

### Requirement: Table integrity on remote edits
The e2e suite SHALL verify that remote edits inside table cells do not corrupt the table structure on the observer's side.

#### Scenario: Remote cell edit preserves table structure
- **WHEN** user A types in a table cell and the edit is synced to user B
- **THEN** user B's editor contains a valid table with the correct number of rows and cells, and no nested tables or merged cells appear

### Requirement: Remote edits excluded from undo history
The e2e suite SHALL verify that Ctrl+Z on the observer's side does not undo remote edits.

#### Scenario: Undo does not revert remote changes
- **WHEN** user A types in a table cell, the edit syncs to user B, and user B presses Ctrl+Z
- **THEN** user A's remote edit remains visible in user B's editor

### Requirement: Non-table surgical replace regression
The e2e suite SHALL verify that the surgical diff/replace still works correctly for non-table content (paragraphs, headings, lists).

#### Scenario: Remote paragraph edit applies cleanly
- **WHEN** user A edits a paragraph and the edit syncs to user B
- **THEN** user B's editor shows the updated paragraph content without corruption or content loss

