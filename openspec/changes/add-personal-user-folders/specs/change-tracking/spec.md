## MODIFIED Requirements

### Requirement: Updates feed filters changes by viewer visibility

`ChangeTrackingService.getChangesSince` SHALL accept a `viewerEmail` argument and exclude every `note_changes` row whose `path` is not visible to the viewer. The exclusion SHALL apply to the `stats`, `starred`, and `other` groups in the response and SHALL prevent diff content from leaking.

#### Scenario: Non-owner update feed excludes foreign personal changes
- **WHEN** Alice creates and modifies a personal note, and Bob calls `GET /api/updates`
- **THEN** the response contains zero entries whose path begins with `_users/alice@example.com/` and zero diff strings derived from those entries

#### Scenario: Owner update feed includes own personal changes
- **WHEN** Alice calls `GET /api/updates`
- **THEN** the response includes her personal-note changes

### Requirement: Recently-edited list filters by viewer visibility

`ChangeTrackingService.getRecentlyEdited` SHALL accept a `viewerEmail` argument and exclude rows whose path is not visible.

#### Scenario: Non-owner recently-edited excludes foreign personal entries
- **WHEN** Bob calls `GET /api/updates/recently-edited` after Alice edits a personal note
- **THEN** the response does not include the personal-note path

### Requirement: MCP get_updates threads viewer email through

The MCP `get_updates` tool SHALL pass `user.email` into `getChangesSince` so foreign personal changes are excluded from the tool's response.

#### Scenario: MCP get_updates by non-owner excludes foreign personal changes
- **WHEN** Bob's MCP client invokes `get_updates` after Alice modifies a personal note
- **THEN** the tool response does not contain the personal-note path or its diff
