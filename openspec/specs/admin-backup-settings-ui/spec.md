# admin-backup-settings-ui Specification

## Purpose
TBD - created by archiving change admin-backup-restore-ui. Update Purpose after archive.
## Requirements
### Requirement: Admin-only backup section in Settings
The Settings page SHALL display a "Backup & Restore" section visible only to admin users.

#### Scenario: Admin sees backup section
- **WHEN** an admin user navigates to the Settings page
- **THEN** a "Backup & Restore" section is visible between the existing sections

#### Scenario: Non-admin does not see backup section
- **WHEN** a non-admin user navigates to the Settings page
- **THEN** no "Backup & Restore" section is displayed

### Requirement: Download backup button
The backup section SHALL include a "Download Backup" button that triggers a file download of the backup archive.

#### Scenario: Successful download
- **WHEN** an admin clicks the "Download Backup" button
- **THEN** the button shows a loading state, the browser downloads a `.tar.gz` file, and the button returns to its normal state

#### Scenario: Download failure
- **WHEN** the download request fails (network error, server error)
- **THEN** the section displays an error message

### Requirement: Upload and restore from archive
The backup section SHALL include a file picker (accepting `.tar.gz`) and a "Restore" button with double confirmation.

#### Scenario: File selection
- **WHEN** an admin selects a `.tar.gz` file via the file picker
- **THEN** the file name is displayed and the "Restore" button becomes enabled

#### Scenario: First click shows confirmation
- **WHEN** an admin clicks the "Restore" button
- **THEN** an inline confirmation appears: "This will replace all notes and data. Are you sure?" with "Confirm Restore" and "Cancel" buttons

#### Scenario: Cancel aborts restore
- **WHEN** the admin clicks "Cancel" on the confirmation
- **THEN** the confirmation disappears and no restore is triggered

#### Scenario: Confirm triggers restore and shows overlay
- **WHEN** the admin clicks "Confirm Restore"
- **THEN** the archive is uploaded to the server, and a full-screen "Restoring..." overlay is displayed

#### Scenario: Invalid archive error
- **WHEN** the server responds with 400 (invalid archive)
- **THEN** the overlay is dismissed and an error message is shown with the server's message

### Requirement: Post-restore auto-reload
After a successful restore, the frontend SHALL poll the server and auto-reload when it comes back.

#### Scenario: Server restarts and comes back
- **WHEN** the restore succeeds and the server restarts
- **THEN** the frontend polls `GET /api/health` every 2 seconds, and when the server responds, the page auto-reloads

#### Scenario: Server takes long to restart
- **WHEN** the server has not responded after polling begins
- **THEN** the "Restoring..." overlay remains visible with a status message (e.g., "Waiting for server to restart...")

