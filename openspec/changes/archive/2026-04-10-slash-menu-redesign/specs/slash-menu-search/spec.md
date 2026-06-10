## ADDED Requirements

### Requirement: Commands have keyword aliases
The `SlashCommand` interface SHALL support an optional `keywords` array of strings. Keywords provide alternative search terms for discoverability.

#### Scenario: Keyword aliases defined
- **WHEN** a command has `keywords: ["todo", "checkbox", "list"]`
- **THEN** those keywords SHALL be used during filtering in addition to name and label

### Requirement: Filter matches against keywords
When filtering commands, the search SHALL match the query against the command's `name`, `label` (case-insensitive), AND all entries in `keywords` (case-insensitive).

#### Scenario: Match by keyword
- **WHEN** user types `/todo`
- **THEN** the Task command (which has keyword "todo") SHALL appear in results

#### Scenario: Match by label
- **WHEN** user types `/code`
- **THEN** the Code Block command SHALL appear in results (label match)

#### Scenario: No keyword match
- **WHEN** user types `/spreadsheet` and no command has that keyword, name, or label substring
- **THEN** no commands SHALL match

### Requirement: Ranked search results
Filtered results SHALL be sorted by match quality in descending order. Match scoring: exact name match (highest), label starts with query, name/label contains query, keyword starts with query, keyword contains query (lowest). Ties SHALL preserve the original command definition order.

#### Scenario: Exact name ranks highest
- **WHEN** user types `/code`
- **THEN** the command with name "code" SHALL appear before commands where "code" is only a keyword or label substring

#### Scenario: Label prefix ranks above keyword
- **WHEN** user types `/tab`
- **THEN** "Table" (label starts with "tab") SHALL rank above "Table of Contents" (label contains "tab" later)
