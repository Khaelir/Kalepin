## Purpose

Provides UI and endpoints for users to create, view, and revoke their personal API keys.
## Requirements
### Requirement: User can view list of API keys
The Settings page SHALL display a unified "Connections" list containing both CLI API keys and active OAuth grants. Each row SHALL show the connection's name, type icon (CLI key vs OAuth client), scope badge, last-used timestamp (if known), and creation/grant date. The list SHALL be ordered by most recently created first, mixing types. If the user has no connections, the system SHALL show an empty state with both creation affordances.

#### Scenario: User has API keys and OAuth grants
- **WHEN** the user navigates to the settings page and has both an API key and an OAuth grant
- **THEN** the system displays a single "Connections" list showing each connection with a type icon (e.g. 💻 for CLI keys, 🌐 for OAuth grants), name (key name for API keys; client name for OAuth grants), scope badge ("Read-only", "Read + Comments", "Full access"), last-used timestamp, and creation date

#### Scenario: User has only API keys
- **WHEN** the user has API keys but no OAuth grants
- **THEN** the list shows only the API keys with their CLI icons; the empty OAuth grant state does not produce a separate empty section

#### Scenario: User has no connections
- **WHEN** the user navigates to the settings page and has no connections of any type
- **THEN** the system displays an empty-state message and prompts the user with both options: "Create an API key for Claude Code" and "Connect to Claude.ai"

### Requirement: User can create a new API key
The system SHALL allow the user to create a new API key by providing a name and selecting a scope profile (`ro`, `rc`, or `rw`). The scope selection SHALL default to `ro` (safest option). After creation, the system SHALL display the raw key exactly once with a copy-to-clipboard action and a warning that the key cannot be retrieved again.

#### Scenario: Successful key creation with scope
- **WHEN** the user enters a name, selects a scope (e.g. "Read-only"), and submits the create key form
- **THEN** the system calls `POST /api/auth/api-keys` with `{ name, scope }` and displays the returned raw key with a copy button
- **THEN** the new key appears in the list with the selected scope badge

#### Scenario: Copy key to clipboard
- **WHEN** the user clicks the copy button next to a newly created key
- **THEN** the raw key is copied to the clipboard and the user sees confirmation feedback

#### Scenario: Key display is transient
- **WHEN** the user navigates away from settings or refreshes the page
- **THEN** the raw key is no longer visible; only the key name, scope, and creation date remain in the list

### Requirement: User can revoke an API key
The system SHALL allow the user to revoke (delete) any connection — API key or OAuth grant — with a confirmation step. After revocation, the connection SHALL be removed from the list and SHALL no longer be usable for authentication. Revoking an OAuth grant SHALL revoke the entire token chain (access + refresh).

#### Scenario: Revoke with confirmation
- **WHEN** the user clicks the revoke button on any connection (API key or OAuth grant)
- **THEN** the system shows an inline confirmation prompt ("Are you sure?")

#### Scenario: Confirm revocation of API key
- **WHEN** the user confirms revocation of an API key
- **THEN** the system calls `DELETE /api/auth/api-keys/:id` and removes the key from the list

#### Scenario: Confirm revocation of OAuth grant
- **WHEN** the user confirms revocation of an OAuth grant
- **THEN** the system calls `DELETE /api/oauth/grants/:id` which revokes the access token and the entire refresh chain, and removes the grant from the list

#### Scenario: Cancel revocation
- **WHEN** the user cancels the revocation
- **THEN** the connection remains in the list unchanged

### Requirement: User can navigate to settings
The system SHALL provide a way to navigate from the main workspace to the settings page and back. The navigation element SHALL be accessible from the sidebar.

#### Scenario: Navigate to settings
- **WHEN** the user clicks the settings navigation element in the sidebar
- **THEN** the main content area switches from the editor workspace to the settings page

#### Scenario: Navigate back to workspace
- **WHEN** the user clicks the back/workspace navigation element from settings
- **THEN** the main content area switches back to the editor workspace with previous state preserved

### Requirement: User can list OAuth grants

The system SHALL expose `GET /api/oauth/grants` returning the authenticated user's active OAuth grants with `{ id, client_id, client_name, scope, created_at, last_used_at }`. The endpoint SHALL NOT return access or refresh token values.

#### Scenario: Listing OAuth grants
- **WHEN** an authenticated user sends `GET /api/oauth/grants`
- **THEN** the response is an array of grant objects ordered by `created_at` descending; revoked grants are not included

#### Scenario: Last-used freshness
- **WHEN** an OAuth access token from grant `G` is used at time `T` to access a protected endpoint
- **THEN** the next listing of the user's grants reflects `last_used_at: T` (eventual consistency within seconds is acceptable)

### Requirement: User can revoke an OAuth grant via API

The system SHALL expose `DELETE /api/oauth/grants/:id` to revoke a specific grant, only if it belongs to the authenticated user.

#### Scenario: Revoke own grant
- **WHEN** an authenticated user sends `DELETE /api/oauth/grants/:id` for a grant they own
- **THEN** the system revokes all access and refresh tokens for that grant and returns 200 OK

#### Scenario: Cannot revoke another user's grant
- **WHEN** a user attempts to delete a grant belonging to another user
- **THEN** the system returns 404 Not Found

### Requirement: Connections list is accessible from Settings

The system SHALL group the unified Connections list under a clearly-labeled "Connections" section heading on the Settings page, replacing the previous "API keys" section heading.

#### Scenario: Section heading
- **WHEN** the user navigates to Settings
- **THEN** the section that previously showed "API keys" now shows "Connections" with a one-line subheading explaining that this lists everything that can access the user's vault on their behalf

