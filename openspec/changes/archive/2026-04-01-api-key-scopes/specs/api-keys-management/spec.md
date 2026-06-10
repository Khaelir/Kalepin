## MODIFIED Requirements

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

### Requirement: User can view list of API keys
The system SHALL display a list of the user's API keys showing each key's name, scope badge, and creation date. The list SHALL be ordered by creation date, most recent first. If the user has no keys, the system SHALL show an empty state message.

#### Scenario: User has existing keys
- **WHEN** the user navigates to the settings page
- **THEN** the system displays a list of API keys with columns for name, scope (displayed as a label: "Read-only", "Read + Comments", or "Full access"), creation date, and a revoke action

#### Scenario: User has no keys
- **WHEN** the user navigates to the settings page and has no API keys
- **THEN** the system displays a message indicating no keys exist and prompts the user to create one
