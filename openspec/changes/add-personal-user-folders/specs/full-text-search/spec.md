## MODIFIED Requirements

### Requirement: FTS5 queries gate results by viewer visibility

`SearchService.search` SHALL accept a required `viewerEmail` argument. The FTS5 SQL SHALL include a predicate restricting results to paths where `path NOT LIKE '\_users/%' ESCAPE '\' OR path LIKE '\_users/' || ? || '/%' ESCAPE '\'` with the viewer's lowercased email bound. The same predicate SHALL apply to the `comments_fts` query.

#### Scenario: Search by non-owner omits foreign personal hits
- **WHEN** Alice has a personal note containing token `BODYTOK` and Bob calls `GET /api/files/search?q=BODYTOK`
- **THEN** the response contains zero results referencing `_users/alice@example.com/...`

#### Scenario: Search by owner returns own personal hits
- **WHEN** Alice has a personal note containing token `BODYTOK` and Alice calls `GET /api/files/search?q=BODYTOK`
- **THEN** the response includes the personal-note hit

#### Scenario: Comments FTS predicate parity
- **WHEN** Alice has a comment containing `COMMENTTOK` on a note in her personal folder and Bob calls `GET /api/files/search?q=COMMENTTOK`
- **THEN** the response contains zero comment hits referencing the personal note

#### Scenario: Ranking of shared-only result sets unchanged
- **WHEN** the predicate is applied and the result set contains no personal-folder rows for either viewer
- **THEN** the score-ordering and snippet output for shared-only matches is byte-identical to the pre-change implementation

### Requirement: Indexing is owner-blind; predicate runs at query time only

`SearchService.indexNote` and `removeNote` SHALL continue to index personal-note content into the global `notes_fts` and `comments_fts` tables. The visibility predicate SHALL apply only at query time, not at index time.

#### Scenario: Personal note content is indexed
- **WHEN** Alice creates a personal note
- **THEN** the corresponding `notes_fts` row is inserted as for any shared note

#### Scenario: Personal note removal updates the index
- **WHEN** Alice deletes a personal note
- **THEN** the corresponding `notes_fts` row is deleted as for any shared note
