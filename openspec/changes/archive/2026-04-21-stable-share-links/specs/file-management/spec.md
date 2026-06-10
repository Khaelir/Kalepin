## MODIFIED Requirements

### Requirement: File and directory move/rename
The system SHALL support moving and renaming files and directories. When a file is moved, its sidecar file MUST move with it. When a file is moved, any associated share link path MUST be updated.

#### Scenario: Rename a file
- **WHEN** a user renames a file from `old.md` to `new.md`
- **THEN** the system renames the file and its sidecar (`.old.md.collab` → `.new.md.collab`) on disk

#### Scenario: Move a file to another directory
- **WHEN** a user moves a file to a different directory
- **THEN** the system moves both the file and its sidecar to the new location

#### Scenario: Rename a file that has a share link
- **WHEN** a user renames or moves a file that has an associated share link
- **THEN** the system updates the `short_links` row to reflect the new path, preserving the same short code
