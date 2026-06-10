## Purpose

Toggles between rendered (read) and source (edit) modes for an open note.

## Requirements

### Requirement: Editor opens in rendered mode by default
The editor SHALL display the document in rendered (TipTap WYSIWYG) mode when a file is opened. Slash commands SHALL be available in rendered mode.

#### Scenario: Opening a file shows rendered view
- **WHEN** a user opens a markdown file from the sidebar
- **THEN** the editor displays the content in WYSIWYG rendered mode with full TipTap editing capabilities

#### Scenario: Slash commands work in rendered mode
- **WHEN** the user types `/` in rendered mode
- **THEN** the slash command menu appears with available commands

### Requirement: Mode toggle selector
The editor SHALL display a mode toggle control that allows switching between "Rendered" mode and "Raw Markdown" mode. The toggle SHALL be positioned in the editor header area.

#### Scenario: Toggle is visible in editor
- **WHEN** a file is open in the editor
- **THEN** a mode toggle control is visible in the editor header area with options for rendered and raw markdown modes

#### Scenario: Switching to raw markdown mode
- **WHEN** the user selects "Raw Markdown" from the mode toggle
- **THEN** the editor displays the document content as plain Markdown text in a textarea
- **THEN** the TipTap WYSIWYG editor is hidden

#### Scenario: Switching back to rendered mode
- **WHEN** the user selects "Rendered" from the mode toggle while in raw markdown mode
- **THEN** the raw markdown content is parsed and loaded back into the TipTap editor
- **THEN** the textarea is hidden and the WYSIWYG editor is shown

### Requirement: Raw markdown mode provides plain text editing
In raw markdown mode, the editor SHALL display the document's Markdown source in a plain text textarea. Slash commands SHALL NOT be available in raw mode.

#### Scenario: Editing raw markdown
- **WHEN** the user is in raw markdown mode
- **THEN** they can edit the markdown source text directly in a textarea

#### Scenario: Slash commands disabled in raw mode
- **WHEN** the user types `/` in raw markdown mode
- **THEN** the slash command menu does NOT appear and the character is inserted as plain text

### Requirement: OT synchronization behavior across modes
The editor SHALL flush pending OT operations when switching modes. Remote operations received during raw mode SHALL be queued and applied when switching back to rendered mode.

#### Scenario: Pending ops flushed on mode switch
- **WHEN** the user switches from rendered mode to raw mode with pending local operations
- **THEN** all pending operations are sent to the server before the mode switch completes

#### Scenario: Remote ops queued during raw mode
- **WHEN** another user makes edits while the current user is in raw mode
- **THEN** those edits are queued and applied when the user switches back to rendered mode
