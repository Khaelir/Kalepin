# Spec delta: attachments (MODIFIED)

## MODIFIED Requirements

### Requirement: Attachment blobs are encrypted under encrypted zones

The attachments service SHALL write attachment blobs (PNG, PDF, etc.) through the same `EncryptingStorageAdapter` as markdown files. The envelope `kind` field SHALL be `"attachment"` for these. Reads through `GET /api/files/attachment` SHALL decrypt before streaming the response.

#### Scenario: Image attachment in encrypted personal vault
- **GIVEN** the `personal` zone is encrypted
- **WHEN** Alice uploads an image to `_users/alice/diary.md`
- **THEN** the file at `PERSONAL_PATH/alice/_attachments/{name}` begins with `KE1\0`
- **AND** `GET /api/files/attachment?path=...` returns the original image bytes
