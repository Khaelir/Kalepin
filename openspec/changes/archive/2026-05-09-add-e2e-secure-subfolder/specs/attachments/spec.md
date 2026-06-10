# Spec delta: attachments (MODIFIED)

## MODIFIED Requirements

### Requirement: Attachments under E2E notes are E2E-encrypted

Attachments uploaded against a doc whose path is in `_users/{email}/_secure/` SHALL be encrypted client-side before upload (per the same envelope format) and stored under `personal/{email}/_secure/_attachments/...`. The server SHALL hold ciphertext only.

#### Scenario: Image upload from an E2E note
- **GIVEN** Alice opens `_users/alice/_secure/foo.md` and pastes an image
- **WHEN** the frontend uploads the attachment
- **THEN** the bytes sent are an encrypted envelope and stored unchanged

#### Scenario: Image render decrypts client-side
- **WHEN** the editor renders the note
- **THEN** the frontend fetches the encrypted blob, decrypts client-side, and renders via a blob URL
