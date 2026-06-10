## ADDED Requirements

### Requirement: User can view list of API keys
The system SHALL display a list of the user's API keys showing each key's name and creation date. The list SHALL be ordered by creation date, most recent first. If the user has no keys, the system SHALL show an empty state message.

#### Scenario: User has existing keys
- **WHEN** the user navigates to the settings page
- **THEN** the system displays a table/list of API keys with columns for name, creation date, and a revoke action

#### Scenario: User has no keys
- **WHEN** the user navigates to the settings page and has no API keys
- **THEN** the system displays a message indicating no keys exist and prompts the user to create one

### Requirement: User can create a new API key
The system SHALL allow the user to create a new API key by providing a name. After creation, the system SHALL display the raw key exactly once with a copy-to-clipboard action and a warning that the key cannot be retrieved again.

#### Scenario: Successful key creation
- **WHEN** the user enters a name and submits the create key form
- **THEN** the system calls `POST /api/auth/api-keys` and displays the returned raw key with a copy button
- **THEN** the new key appears in the list

#### Scenario: Copy key to clipboard
- **WHEN** the user clicks the copy button next to a newly created key
- **THEN** the raw key is copied to the clipboard and the user sees confirmation feedback

#### Scenario: Key display is transient
- **WHEN** the user navigates away from settings or refreshes the page
- **THEN** the raw key is no longer visible; only the key name and creation date remain in the list

### Requirement: User can revoke an API key
The system SHALL allow the user to revoke (delete) an API key with a confirmation step. After revocation, the key SHALL be removed from the list and SHALL no longer be usable for authentication.

#### Scenario: Revoke with confirmation
- **WHEN** the user clicks the revoke button on a key
- **THEN** the system shows an inline confirmation prompt ("Are you sure?")

#### Scenario: Confirm revocation
- **WHEN** the user confirms the revocation
- **THEN** the system calls `DELETE /api/auth/api-keys/:id` and removes the key from the list

#### Scenario: Cancel revocation
- **WHEN** the user cancels the revocation
- **THEN** the key remains in the list unchanged

### Requirement: User can navigate to settings
The system SHALL provide a way to navigate from the main workspace to the settings page and back. The navigation element SHALL be accessible from the sidebar.

#### Scenario: Navigate to settings
- **WHEN** the user clicks the settings navigation element in the sidebar
- **THEN** the main content area switches from the editor workspace to the settings page

#### Scenario: Navigate back to workspace
- **WHEN** the user clicks the back/workspace navigation element from settings
- **THEN** the main content area switches back to the editor workspace with previous state preserved
