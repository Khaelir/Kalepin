# Spec delta: link-index (MODIFIED)

## MODIFIED Requirements

### Requirement: Wikilink and graph results skip E2E paths

The link-index SHALL skip parsing `isE2EEncrypted` paths and SHALL omit them from backlinks, outgoing links, autocomplete, and graph results — both as sources and as targets.

#### Scenario: E2E note has no backlinks visible
- **GIVEN** Alice has `_users/alice/notes/foo.md` containing `[[secret-note]]` and an E2E note `_users/alice/_secure/secret-note.md`
- **WHEN** Alice queries backlinks for `secret-note`
- **THEN** the result is empty (the link-index has no entry for the E2E target)
