# Spec delta: file-management (MODIFIED)

## MODIFIED Requirements

### Requirement: Per-user download-zip returns plaintext markdown

The system SHALL ensure `GET /api/files/download-zip` returns a tar.gz containing plaintext markdown for every entry, regardless of whether the underlying files are stored as envelopes on disk. Decryption SHALL happen in-stream as the handler walks the archive entries.

#### Scenario: Download-zip on encrypted personal vault yields plaintext
- **GIVEN** the `personal` zone is encrypted and Alice has notes in `_users/alice/`
- **WHEN** Alice calls `GET /api/files/download-zip`
- **THEN** the resulting tar contains plaintext `.md` files (no envelope magic bytes)

#### Scenario: Download-zip excludes stage-2 paths
- **GIVEN** stub: `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** Alice calls `GET /api/files/download-zip`
- **THEN** the tar entry for that path either omits the file or includes a manifest sentinel (decision: stage 2 confirms behavior)
