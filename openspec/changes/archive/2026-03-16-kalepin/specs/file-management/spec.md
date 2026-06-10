## ADDED Requirements

### Requirement: File CRUD operations
The system SHALL provide REST API endpoints for creating, reading, updating, and deleting markdown files in the vault.

#### Scenario: Create a new file
- **WHEN** a user creates a new file via the API with a path and optional initial content
- **THEN** the system creates the markdown file on disk and returns the file metadata

#### Scenario: Read a file
- **WHEN** a user requests a file by path
- **THEN** the system returns the file content and metadata

#### Scenario: Delete a file
- **WHEN** a user deletes a file by path
- **THEN** the system removes the file from disk and its sidecar file (if exists)

### Requirement: Directory management
The system SHALL support creating, renaming, moving, and deleting directories in the vault.

#### Scenario: Create a directory
- **WHEN** a user creates a new directory at a given path
- **THEN** the system creates the directory on disk

#### Scenario: Delete a non-empty directory
- **WHEN** a user deletes a directory that contains files
- **THEN** the system deletes the directory and all its contents recursively (with confirmation)

### Requirement: File and directory move/rename
The system SHALL support moving and renaming files and directories. When a file is moved, its sidecar file MUST move with it.

#### Scenario: Rename a file
- **WHEN** a user renames a file from `old.md` to `new.md`
- **THEN** the system renames the file and its sidecar (`.old.md.collab` → `.new.md.collab`) on disk

#### Scenario: Move a file to another directory
- **WHEN** a user moves a file to a different directory
- **THEN** the system moves both the file and its sidecar to the new location

### Requirement: File tree listing
The system SHALL provide an API endpoint that returns the hierarchical file tree of the vault.

#### Scenario: List file tree
- **WHEN** a user requests the file tree
- **THEN** the system returns a recursive listing of all files and directories in the vault, excluding dot-prefixed files (sidecars, `.obsidian/`)

### Requirement: External edit detection
The system SHALL detect when files are modified externally (e.g., via Obsidian or a text editor) using chokidar file watching.

#### Scenario: File changed externally while open
- **WHEN** a file is modified on disk by an external process while users have it open in Kalepin
- **THEN** the server broadcasts a `file:changed` event to connected clients, and the client displays a toast notification and reloads the document content

#### Scenario: File changed externally while not open
- **WHEN** a file is modified on disk while no users have it open
- **THEN** the file tree updates to reflect the change (no notification needed)

#### Scenario: File created or deleted externally
- **WHEN** a file is created or deleted on disk by an external process
- **THEN** the file tree updates accordingly for all connected clients
