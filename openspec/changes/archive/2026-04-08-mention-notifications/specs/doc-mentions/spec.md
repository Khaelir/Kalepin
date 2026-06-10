## ADDED Requirements

### Requirement: Mention autocomplete in document body
The editor SHALL provide a mention autocomplete when the user types `@` in the document body. The autocomplete SHALL display workspace users filtered by the typed text, matching against display name and email (case-insensitive).

#### Scenario: Trigger autocomplete
- **WHEN** the user types `@` preceded by a space or at the start of a line in the document body
- **THEN** a dropdown appears listing workspace users fetched from `GET /api/users`

#### Scenario: Filter autocomplete
- **WHEN** the user types `@ali` in the document body
- **THEN** the dropdown filters to users whose display name or email contains "ali" (case-insensitive)

#### Scenario: Select a mention
- **WHEN** the user selects a user from the autocomplete dropdown (click or Enter)
- **THEN** a mention node is inserted at the cursor position displaying `@pseudo` as a pill/chip badge, and the autocomplete closes

#### Scenario: Dismiss autocomplete
- **WHEN** the user presses Escape or clicks outside the dropdown
- **THEN** the autocomplete closes and the typed `@` text remains as plain text

### Requirement: Mention badge rendering
Mention nodes in the document body SHALL render as inline pill/chip badges showing the user's pseudo (email prefix before `@`).

#### Scenario: Badge appearance
- **WHEN** a document contains a mention node for `alice.smith@company.com`
- **THEN** the editor renders a pill badge with a small colored circle (using `getColorForUser(email)`) followed by `@alice.smith`, with the user's color at 12% opacity as background

#### Scenario: Badge hover tooltip
- **WHEN** the user hovers over a mention badge
- **THEN** a tooltip displays the full email address

#### Scenario: Badge is atomic
- **WHEN** the cursor moves through a mention badge
- **THEN** the badge is treated as a single atomic inline element (cannot be partially selected or edited)

### Requirement: Mention markdown serialization
Mention nodes SHALL serialize to `@[pseudo](email)` format in the `.md` file and SHALL be parsed back into mention nodes when loading the document.

#### Scenario: Save document with mention
- **WHEN** a document containing a mention for `alice.smith@company.com` is saved
- **THEN** the `.md` file contains `@[alice.smith](alice.smith@company.com)` at the mention position

#### Scenario: Load document with mention
- **WHEN** a `.md` file containing `@[alice.smith](alice.smith@company.com)` is opened in the editor
- **THEN** the editor renders a mention badge for `alice.smith@company.com`

#### Scenario: Non-mention similar syntax
- **WHEN** a `.md` file contains `[alice](alice@company.com)` without the `@` prefix
- **THEN** the editor treats it as a standard markdown link, not a mention

### Requirement: Mention detection on save
The backend SHALL detect newly added mentions when a document is saved by comparing mentions in the new content against the previous content.

#### Scenario: New mention added
- **WHEN** a document is saved and the new content contains `@[bob](bob@company.com)` that was not in the previous content
- **THEN** the system triggers the notification pipeline for `bob@company.com`

#### Scenario: Existing mention unchanged
- **WHEN** a document is saved and the mention `@[bob](bob@company.com)` existed in both old and new content
- **THEN** no notification is triggered for `bob@company.com`

#### Scenario: Mention removed
- **WHEN** a document is saved and a mention that existed in the old content is no longer in the new content
- **THEN** no notification is triggered (removals are silent)
