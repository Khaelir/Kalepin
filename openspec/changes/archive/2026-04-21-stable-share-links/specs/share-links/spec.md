## ADDED Requirements

### Requirement: Share link code generation
The system SHALL assign a unique 10-character base62 code to a document when it is first opened, stored in the `short_links` table. If a code already exists for that path, the system SHALL return the existing code.

#### Scenario: First open of a document
- **WHEN** a user opens a document that has no entry in `short_links`
- **THEN** the system generates a new code, stores it with the document path, and returns the code

#### Scenario: Subsequent open of a document
- **WHEN** a user opens a document that already has a code in `short_links`
- **THEN** the system returns the existing code

#### Scenario: Generate code for nonexistent file
- **WHEN** the system attempts to create a code for a path that does not exist on disk
- **THEN** the system returns a 404 error

### Requirement: Share link resolution
The system SHALL provide an API endpoint (`GET /api/share-links/resolve/:code`) that resolves a code to its current file path.

#### Scenario: Resolve a valid code
- **WHEN** the frontend requests resolution of a valid code
- **THEN** the system returns `{ path }` with the current file path

#### Scenario: Resolve an unknown code
- **WHEN** the frontend requests resolution of a code that does not exist
- **THEN** the system returns a 404 error

### Requirement: ID-based URL scheme
The frontend SHALL use URLs of the format `/d/<code>/<cosmetic-path>` as the primary document URL scheme. The code is the stable identifier used for resolution. The cosmetic path is human-readable but not used for routing.

#### Scenario: Navigate to a document via ID URL
- **WHEN** a user navigates to `/d/<code>/<cosmetic-path>`
- **THEN** the frontend resolves the code via the API, opens the corresponding document, and updates the cosmetic path in the URL if it is stale

#### Scenario: Navigate with a stale cosmetic path
- **WHEN** a user navigates to `/d/<code>/Old-Name` but the file has been renamed to `New-Name.md`
- **THEN** the frontend resolves the code to the current path, opens the document, and replaces the URL to show the current cosmetic path

#### Scenario: Fallback when code cannot be resolved
- **WHEN** a user navigates to `/d/<code>/<cosmetic-path>` and the code cannot be resolved (e.g. DB was wiped)
- **THEN** the frontend decodes the cosmetic path, attempts to open the file by path, assigns a new code if the file exists, and updates the URL

#### Scenario: Fallback when neither code nor cosmetic path resolves
- **WHEN** a user navigates to `/d/<code>/<cosmetic-path>` and neither the code nor the decoded cosmetic path matches a file
- **THEN** the system displays a 404 page

### Requirement: Legacy URL backwards compatibility
The system SHALL continue to support legacy `/doc/<path>` URLs by extracting the file path directly and opening the document. After opening, the URL SHALL be upgraded to the new `/d/<code>/<cosmetic-path>` format.

#### Scenario: Navigate via legacy URL
- **WHEN** a user navigates to `/doc/Eclairage%20public/Specs/Syndicats.md`
- **THEN** the system opens the document by path, assigns a code if needed, and replaces the URL with `/d/<code>/Eclairage-public/Specs/Syndicats`

### Requirement: Share link persistence across renames
The system SHALL update share link paths when documents are renamed or moved, so that existing URLs continue to resolve to the correct document.

#### Scenario: File renamed via API
- **WHEN** a file with an existing code is renamed via `POST /api/files/move`
- **THEN** the `short_links` row is updated with the new path, and the code resolves to the new location

#### Scenario: File renamed externally (Obsidian)
- **WHEN** a file with an existing code is renamed on disk by an external editor
- **THEN** the rename tracking service updates the `short_links` row with the new path

#### Scenario: Folder renamed
- **WHEN** a folder is renamed and it contains files with codes
- **THEN** all affected `short_links` rows are updated with the new path prefix

### Requirement: Share link cleanup on deletion
The system SHALL remove share link entries when their associated documents are deleted.

#### Scenario: File deleted via API
- **WHEN** a file with a code is deleted via `DELETE /api/files/delete`
- **THEN** the corresponding `short_links` row is removed

#### Scenario: File deleted externally
- **WHEN** a file with a code is deleted on disk by an external process
- **THEN** the corresponding `short_links` row is removed during the next file watcher cycle

### Requirement: Notification links use stable URLs
Backend email notifications SHALL construct document links using the `/d/<code>/<cosmetic-path>` format so notification links survive renames.

#### Scenario: Comment notification email
- **WHEN** the system sends a notification email about a comment on a document
- **THEN** the document link in the email uses the `/d/<code>/<cosmetic-path>` format
