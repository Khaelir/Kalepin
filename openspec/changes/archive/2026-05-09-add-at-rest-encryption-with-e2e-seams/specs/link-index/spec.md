# Spec delta: link-index (MODIFIED)

## MODIFIED Requirements

### Requirement: Wikilink parsing consults `shouldIndexPlaintext`

The system SHALL gate every backlink/forward-link extraction call by `shouldIndexPlaintext(path)`. When the predicate returns false for a source path, the source SHALL not be parsed and its outgoing links SHALL not be persisted. When it returns false for a target path, the target SHALL be hidden from autocomplete and graph results.

#### Scenario: Stage-2 contract test (source side)
- **GIVEN** the predicate is stubbed to return false for path `P`
- **WHEN** content at `P` is updated
- **THEN** no rows in the wikilinks index reference `P` as a source

#### Scenario: Stage-2 contract test (target side)
- **GIVEN** the predicate is stubbed to return false for path `P`
- **WHEN** another note `Q` contains `[[P]]`
- **THEN** `Q`'s outgoing-links list does not include `P` for visibility purposes
