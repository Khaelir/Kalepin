## ADDED Requirements

### Requirement: maxLength parameter
`read_note` SHALL accept an optional `maxLength` parameter (positive integer, in characters).

#### Scenario: No maxLength provided
- **WHEN** `read_note` is called without `maxLength`
- **THEN** the full note content is returned (current behavior)

#### Scenario: Content under maxLength
- **WHEN** `read_note` is called with `maxLength: 2000` on a note with 500 characters of content
- **THEN** the full note content is returned (no truncation needed)

#### Scenario: Long note with headings exceeds maxLength
- **WHEN** `read_note` is called with `maxLength: 500` on a note with 7000 characters and markdown headings
- **THEN** the response contains: `contentHash`, heading outline (extracted from `^#{1,6}\s+` lines, indented by level), first paragraph of the note, `fullLength` (total character count), comment summary (thread count, open vs resolved), attachment metadata
- **AND** the full markdown body is NOT included

#### Scenario: Long note without headings exceeds maxLength
- **WHEN** `read_note` is called with `maxLength: 500` on a note with 5000 characters and no markdown headings
- **THEN** the response contains: `contentHash`, the first `maxLength` characters of content as preview, `fullLength`, comment summary, attachment metadata

### Requirement: Heading extraction from markdown
The system SHALL extract headings by matching lines against the pattern `^#{1,6}\s+(.+)` in the raw markdown content. Lines inside fenced code blocks (between ` ``` ` markers) SHALL be excluded.

### Requirement: Resolved comments hidden by default
`read_note` SHALL omit resolved comment threads from MCP responses by default.

#### Scenario: Note with mixed comment threads
- **WHEN** `read_note` is called without `include_resolved`
- **THEN** only unresolved comment threads are included in the Comments section

#### Scenario: Explicit include_resolved
- **WHEN** `read_note` is called with `include_resolved: true`
- **THEN** all comment threads (resolved and unresolved) are included
