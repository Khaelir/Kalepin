## Purpose

Includes a stable content hash in `read_note` responses so write tools can detect concurrent edits.

## Requirements

### Requirement: read_note includes content hash
The `read_note` tool response SHALL include a `contentHash` field — an 8-character hex string derived from the note's content at read time.

#### Scenario: Hash present in response
- **WHEN** user calls `read_note` on an existing note
- **THEN** the response text includes a `contentHash: <8-hex-char>` line before the note content

#### Scenario: Hash is deterministic
- **WHEN** user calls `read_note` twice on the same unmodified note
- **THEN** both responses contain the same `contentHash` value

#### Scenario: Hash changes when content changes
- **WHEN** a note's content is modified between two `read_note` calls
- **THEN** the `contentHash` values differ

### Requirement: Content hash computation
The content hash SHALL be computed as the first 8 characters of the MD5 hex digest of the note's UTF-8 content.

#### Scenario: Hash algorithm
- **WHEN** a note contains "Hello world"
- **THEN** `contentHash` equals `md5("Hello world").hex().slice(0, 8)`

### Requirement: Write tools accept optional base_hash
The `edit_note`, `patch_note`, and `append_to_note` tools SHALL accept an optional `base_hash` parameter. When provided, the tool SHALL reject the operation if the hash of the current content does not match `base_hash`.

#### Scenario: edit_note with base_hash mismatch
- **WHEN** user calls `edit_note` with `base_hash` that doesn't match the current content
- **THEN** the tool returns a conflict error including the current hash, and the document is unchanged

#### Scenario: edit_note without base_hash
- **WHEN** user calls `edit_note` without `base_hash`
- **THEN** the tool proceeds normally (backwards compatible)
