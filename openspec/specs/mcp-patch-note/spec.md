## Purpose

Exposes a `patch_note` MCP tool that replaces specific text in a note with new text.

## Requirements

### Requirement: patch_note MCP tool exists
The system SHALL expose a `patch_note` tool via the MCP server. The tool SHALL accept `path` (string, required), `old_text` (string, required), `new_text` (string, required), and `base_hash` (string, optional) parameters.

#### Scenario: Tool is listed in MCP capabilities
- **WHEN** an MCP client lists available tools
- **THEN** `patch_note` appears with a description indicating it performs search-and-replace edits on notes

### Requirement: patch_note replaces exactly one occurrence
The tool SHALL find the exact occurrence of `old_text` in the note's current content and replace it with `new_text`. The match MUST be exact (case-sensitive, whitespace-sensitive).

#### Scenario: Successful single match
- **WHEN** user calls `patch_note` with `old_text: "Hello world"` and `new_text: "Hello universe"` on a note containing exactly one occurrence of "Hello world"
- **THEN** the occurrence is replaced with "Hello universe" and the tool returns success with the note path

#### Scenario: new_text is empty string (deletion)
- **WHEN** user calls `patch_note` with `old_text: "remove this"` and `new_text: ""` on a note containing exactly one occurrence
- **THEN** the matched text is deleted from the note

### Requirement: patch_note fails safely when old_text not found
The tool SHALL return an error and leave the document untouched when `old_text` does not exist in the note.

#### Scenario: old_text not found
- **WHEN** user calls `patch_note` with `old_text` that does not appear in the note
- **THEN** the tool returns an error message indicating the text was not found and the document is unchanged

### Requirement: patch_note fails safely on ambiguous matches
The tool SHALL return an error and leave the document untouched when `old_text` appears more than once in the note.

#### Scenario: Multiple matches
- **WHEN** user calls `patch_note` with `old_text` that appears 3 times in the note
- **THEN** the tool returns an error indicating the text matches 3 times and the caller should provide more surrounding context to make the match unique

### Requirement: patch_note rejects stale base_hash
When `base_hash` is provided, the tool SHALL compare it against the hash of the current document content. If they differ, the tool SHALL reject the edit.

#### Scenario: Hash mismatch
- **WHEN** user calls `patch_note` with a `base_hash` that does not match the current content hash
- **THEN** the tool returns a conflict error with the current hash, and the document is unchanged

#### Scenario: Hash matches
- **WHEN** user calls `patch_note` with a `base_hash` that matches the current content hash
- **THEN** the edit proceeds normally

#### Scenario: No base_hash provided
- **WHEN** user calls `patch_note` without `base_hash`
- **THEN** the edit proceeds without conflict detection

### Requirement: patch_note uses fuzzy path resolution
The tool SHALL resolve the `path` parameter using the same fuzzy resolution as `edit_note` (exact → case-insensitive → substring → search).

#### Scenario: Ambiguous path
- **WHEN** user calls `patch_note` with a path matching multiple notes
- **THEN** the tool returns an error listing the matching paths

### Requirement: patch_note tracks changes
The tool SHALL track the edit via `ChangeTrackingService` with a diff between old and new content, the same as `edit_note`.

#### Scenario: Change is tracked
- **WHEN** a `patch_note` edit succeeds
- **THEN** the change appears in `get_updates` with the correct diff
