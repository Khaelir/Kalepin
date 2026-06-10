## ADDED Requirements

### Requirement: Search API returns comment results
The `GET /api/files/search` endpoint SHALL return comment matches alongside note matches. Comment results SHALL be distinguishable by a `type: 'comment'` field.

#### Scenario: Query matches comment text
- **WHEN** a user searches for a term that appears only in a comment
- **THEN** the search results SHALL include a result with `type: 'comment'`, the parent note's `path`, the `threadId`, the `commentAuthor`, and a snippet of the matching comment text

#### Scenario: Query matches both note and comment
- **WHEN** a user searches for a term that appears in a note's body AND in a comment on that same note
- **THEN** the results SHALL include both a `type: 'note'` result and a `type: 'comment'` result, ranked independently by RRF score

#### Scenario: Comment results participate in RRF merge
- **WHEN** a comment matches in FTS5 and/or vector search
- **THEN** the comment result SHALL be scored through the same RRF merge as note results, with comment FTS weighted at 1.0 (same as note FTS)

### Requirement: SearchResult type includes comment metadata
The `SearchResult` interface SHALL include optional fields for comment-specific metadata:
- `type?: 'note' | 'comment'` (defaults to `'note'` for backward compatibility)
- `threadId?: string`
- `commentAuthor?: string`

#### Scenario: Backward compatibility
- **WHEN** existing consumers read search results without checking the `type` field
- **THEN** results SHALL behave identically to the current format — all new fields are optional

### Requirement: Search modal displays comment results distinctly
The frontend search modal SHALL render comment results with a visual indicator distinguishing them from note results.

#### Scenario: Comment result rendering
- **WHEN** a search result has `type: 'comment'`
- **THEN** the modal SHALL display a comment icon, the author name, and the matching comment snippet, along with the parent note name

#### Scenario: Navigating to a comment result
- **WHEN** a user selects a comment result from the search modal
- **THEN** the system SHALL navigate to the parent note (using the result's `path`)
