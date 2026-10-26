# Spec delta: full-text-search (MODIFIED)

## ADDED Requirements

### Requirement: Tag filter tokens in search queries

The search query parser SHALL recognise `tag:<name>` tokens (case-insensitive prefix, optional leading `#` on the name, outside double quotes). Each token SHALL restrict results to notes carrying `<name>` or any `<name>/…` child tag; several tokens SHALL be combined with AND. The remaining text SHALL be searched with the usual hybrid pipeline, restricted to the tagged notes before ranking. A query made only of `tag:` tokens SHALL return the tagged notes visible to the caller, most recently modified first, each with a body excerpt as `snippet` and a `modifiedAt` timestamp. The REST search endpoint and the MCP `search_notes` tool SHALL share this parsing.

#### Scenario: Tag-only query
- **GIVEN** visible notes A (tagged `meeting`, modified yesterday) and B (tagged `meeting/weekly`, modified today), and C (untagged)
- **WHEN** a client sends `GET /api/files/search?q=tag:meeting`
- **THEN** the response lists B then A, each with `modifiedAt`, and not C

#### Scenario: Tag plus text
- **GIVEN** notes A (`#meeting`, body "budget review") and B (untagged, body "budget review")
- **WHEN** a client searches for `tag:meeting budget`
- **THEN** A is returned and B is not

#### Scenario: Multiple tags are ANDed
- **GIVEN** note A tagged `x` and `y`, and note B tagged `x` only
- **WHEN** a client searches for `tag:x tag:y`
- **THEN** only A is returned

#### Scenario: Quoted token is text
- **WHEN** a client searches for `"tag:x"`
- **THEN** no tag filter is applied and the phrase is searched as text

#### Scenario: Tag filter respects visibility
- **GIVEN** Alice's personal note is tagged `plan`
- **WHEN** Bob searches for `tag:plan`
- **THEN** Alice's note is not returned
