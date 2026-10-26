# Spec delta: note-templates (ADDED)

## ADDED Requirements

### Requirement: Template folders

The system SHALL treat every `.md` file inside the templates folder as a template: `<TEMPLATES_FOLDER>/` at the vault root (shared) and, when personal folders are enabled, `_users/{email}/<TEMPLATES_FOLDER>/` (personal, visible to its owner only). `TEMPLATES_FOLDER` SHALL default to `Templates`. Files in subfolders of the templates folder SHALL also be templates. Paths under `_users/{email}/_secure/` SHALL never be templates.

#### Scenario: Default folder
- **GIVEN** `TEMPLATES_FOLDER` is unset and the vault contains `Templates/Meeting notes.md`
- **WHEN** a user lists templates
- **THEN** the list contains `{ name: 'Meeting notes', path: 'Templates/Meeting notes.md', scope: 'shared' }`

#### Scenario: Configured folder
- **GIVEN** `TEMPLATES_FOLDER=Blueprints` and the vault contains `Blueprints/Retro.md` and `Templates/Old.md`
- **WHEN** a user lists templates
- **THEN** the list contains `Blueprints/Retro.md` and does not contain `Templates/Old.md`

#### Scenario: Subfolder template
- **GIVEN** the vault contains `Templates/Work/Standup.md`
- **WHEN** a user lists templates
- **THEN** the list contains a template named `Work/Standup`

### Requirement: Template listing respects visibility

`GET /api/templates` SHALL return `{ folder, templates }`, where `templates` holds the shared templates and the caller's own personal templates, each as `{ name, path, scope }` with `scope` either `shared` or `personal`. The personal folder SHALL be derived from the caller's own email; templates in another user's personal folder SHALL never be returned, whether or not the caller holds a grant on them.

#### Scenario: Personal templates are owner-only
- **GIVEN** personal folders are enabled and `_users/alice@example.com/Templates/Diary.md` exists
- **WHEN** Bob lists templates
- **THEN** the response does not contain `Diary` or any path under `_users/alice@example.com/`
- **AND** when Alice lists templates the response contains `{ name: 'Diary', scope: 'personal' }`

#### Scenario: Grant does not list foreign templates
- **GIVEN** Alice granted Bob read access to `_users/alice@example.com/Templates/Diary.md`
- **WHEN** Bob lists templates
- **THEN** `Diary` is not in the response

#### Scenario: No templates folder
- **GIVEN** neither `Templates/` nor the caller's personal `Templates/` exists
- **WHEN** the caller lists templates
- **THEN** the response is `200` with an empty `templates` array and `folder: 'Templates'`

### Requirement: Template variables

The system SHALL render templates server-side with a single pure function, replacing the following Obsidian-compatible variables (names case-insensitive, optional surrounding spaces): `{{title}}` (the new note's file name without extension), `{{date}}` (`YYYY-MM-DD`), `{{time}}` (`HH:mm`), `{{date:FORMAT}}` and `{{time:FORMAT}}`, `{{author}}` (the user's display name, else the email local part split on `.`, `_`, `-` and capitalized) and `{{author_email}}`. FORMAT SHALL support the tokens `YYYY YY MMMM MMM MM M DD D Do dddd ddd HH H hh h mm ss A a` with English names; text in `[brackets]` SHALL be literal and any other character SHALL be copied as-is. Unknown variables, and a format on a variable other than `date`/`time`, SHALL be left untouched. Substituted values SHALL NOT be re-scanned for variables.

#### Scenario: Basic variables
- **GIVEN** a template `# {{title}}\n{{date}} {{time}} by {{author}} <{{author_email}}>`, title `Kickoff`, user `jane.doe@example.com` with no display name, and the instant 2026-03-05T14:07:09Z in timezone `UTC`
- **WHEN** the template is rendered
- **THEN** the result is `# Kickoff\n2026-03-05 14:07 by Jane Doe <jane.doe@example.com>`

#### Scenario: Format tokens
- **GIVEN** the same instant and timezone
- **WHEN** `{{date:dddd, MMMM Do YYYY [at] h:mm A}}` is rendered
- **THEN** the result is `Thursday, March 5th 2026 at 2:07 PM`

#### Scenario: Unknown variable untouched
- **WHEN** a template containing `{{weather}}` and `{{title:upper}}` is rendered
- **THEN** both strings appear unchanged in the output

#### Scenario: Display name wins
- **GIVEN** the user has display name `J. Doe`
- **WHEN** `{{author}}` is rendered
- **THEN** the result is `J. Doe`

### Requirement: Rendering uses the caller's timezone

Date and time variables SHALL be computed in the IANA timezone supplied by the client. The timezone SHALL be validated with `Intl`; a missing or invalid timezone SHALL fall back to the server timezone.

#### Scenario: Day boundary follows the user
- **GIVEN** the instant 2026-03-05T23:30:00Z
- **WHEN** `{{date}} {{time}}` is rendered with timezone `Asia/Tokyo`
- **THEN** the result is `2026-03-06 08:30`
- **AND** with timezone `America/Los_Angeles` the result is `2026-03-05 15:30`

#### Scenario: Invalid timezone falls back
- **WHEN** a template is rendered with timezone `Mars/Olympus`
- **THEN** rendering succeeds using the server timezone

### Requirement: Create a note from a template

`POST /api/vault/items` SHALL accept optional `template` (a template path or listed template name) and `timezone` when `kind` is `note`. The system SHALL create the note with the existing naming and collision rules and with the rendered template as content, where `{{title}}` is the collision-resolved file name. Reading the template SHALL apply the same checks as reading any note: invisible paths return `404`, PIN-locked templates return `423` unless unlocked. Templates under `_secure/` and creating from a template into a `_secure/` folder SHALL be rejected with `400`. `kind: 'folder'` with a template SHALL be rejected with `400`.

#### Scenario: Create from shared template
- **GIVEN** `Templates/Meeting.md` contains `# {{title}}`
- **WHEN** a user posts `{ kind: 'note', parent_path: 'Projects', name: 'Kickoff', template: 'Templates/Meeting.md', timezone: 'Europe/Paris' }`
- **THEN** `Projects/Kickoff.md` is created with content `# Kickoff` and its path is returned

#### Scenario: Title follows collision rename
- **GIVEN** `Projects/Untitled note.md` already exists
- **WHEN** a user creates a note from a `# {{title}}` template in `Projects` without a name
- **THEN** `Projects/Untitled note 2.md` is created with content `# Untitled note 2`

#### Scenario: Foreign personal template is not found
- **WHEN** Bob creates a note with `template: '_users/alice@example.com/Templates/Diary.md'`
- **THEN** the response is `404` and no note is created

#### Scenario: PIN-locked template
- **GIVEN** `Templates/Secret.md` has a PIN and the caller holds no unlock token for it
- **WHEN** the caller creates a note from it
- **THEN** the response is `423` and no note is created

#### Scenario: Encrypted folder rejected
- **WHEN** a user creates a note from a template with `parent_path` under `_users/{email}/_secure`
- **THEN** the response is `400`

### Requirement: Sample template

`POST /api/templates/sample` SHALL create `<TEMPLATES_FOLDER>/Meeting notes.md` in the shared vault with a sample that uses `{{title}}`, `{{date:…}}`, `{{time}}` and `{{author}}`, and return `{ path, id, created }`. If the file already exists it SHALL be returned unchanged with `created: false`.

#### Scenario: First call creates the sample
- **GIVEN** `Templates/Meeting notes.md` does not exist
- **WHEN** the endpoint is called
- **THEN** the file is created and `created` is `true`

#### Scenario: Existing sample is preserved
- **GIVEN** `Templates/Meeting notes.md` exists with custom content
- **WHEN** the endpoint is called
- **THEN** the content is unchanged and `created` is `false`

### Requirement: MCP create_note accepts a template

The MCP `create_note` tool SHALL accept optional `template` (path or listed template name) and `timezone` arguments. With a template, `content` SHALL be optional; when both are given the rendered template SHALL come first and `content` SHALL be appended after a blank line. `{{title}}` SHALL be the leaf name of `path`. The template SHALL pass the same visibility, E2E and PIN checks as the REST endpoint.

#### Scenario: Template by name
- **GIVEN** `Templates/Meeting notes.md` exists
- **WHEN** an agent calls `create_note` with `path: 'Notes/Sync.md'` and `template: 'Meeting notes'`
- **THEN** `Notes/Sync.md` is created from the rendered template and the response carries its id

#### Scenario: Foreign template rejected
- **WHEN** Bob calls `create_note` with Alice's personal template path
- **THEN** the call fails and no note is created

### Requirement: New from template in the create popover

The create popover (note mode) SHALL offer "From template…", which lists the caller's templates grouped as Shared and Personal and creates the chosen template in the popover's selected folder, with an optional note name. The new note SHALL open like any new note (rename mode when no name was given). When no templates exist the popover SHALL show the hint "Add notes to a Templates folder to use them here." with an action that creates the sample template. The entry SHALL be disabled when the selected folder is in the Encrypted Folder.

#### Scenario: Create from the picker
- **GIVEN** a shared template `Meeting notes`
- **WHEN** the user opens the create popover, chooses "From template…", types `Weekly sync` and clicks `Meeting notes`
- **THEN** `Weekly sync.md` is created in the selected folder from the template and opens in the editor

#### Scenario: Empty state
- **GIVEN** no templates exist
- **WHEN** the user opens "From template…"
- **THEN** the hint and a "Create a sample template" button are shown
- **AND** clicking the button creates `Templates/Meeting notes.md` and lists it
