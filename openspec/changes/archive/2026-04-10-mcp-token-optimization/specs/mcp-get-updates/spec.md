## MODIFIED Requirements

### Requirement: Summary-by-default response
`get_updates` SHALL return a compact summary by default: `period`, `stats` (created/modified/deleted counts), and a flat file list under `starred` and `other` keys. Each file entry contains `path`, `action`, `changes` (revision count), `lastChangedAt`, and `user`.

#### Scenario: Default call
- **WHEN** `get_updates` is called without `include_diffs`
- **THEN** the response contains `period`, `stats`, `starred`, `other` — no `diffs` arrays on file entries

#### Scenario: With include_diffs
- **WHEN** `get_updates` is called with `include_diffs: true`
- **THEN** file entries include a `diffs` array with unified diff strings (current behavior)

### Requirement: Remove by_folder duplication
The `by_folder` key SHALL be removed from the `get_updates` response in both MCP and REST API.

#### Scenario: Response shape
- **WHEN** `get_updates` is called
- **THEN** the response contains `period`, `stats`, `starred`, `other` — no `by_folder` key

### Requirement: Filter binary and XML diffs
When `include_diffs: true`, diffs for files matching `*.svg`, `*.png`, `*.xml` patterns or containing draw.io XML content SHALL be replaced with a placeholder string (e.g., `"[binary/diagram diff omitted — N chars]"`).

#### Scenario: Draw.io file in diffs
- **WHEN** `get_updates` is called with `include_diffs: true` and a changed file contains draw.io XML
- **THEN** the diff entry is replaced with a size placeholder instead of the raw XML diff
