## ADDED Requirements

### Requirement: failed_searches table schema
The system SHALL maintain a `failed_searches` table with columns: `id` (INTEGER, auto-increment primary key), `query` (TEXT), `timestamp` (DATETIME, defaults to current time), `source` (TEXT — either 'frontend' or 'mcp').

#### Scenario: Table creation
- **WHEN** the application starts
- **THEN** the `failed_searches` table is created if it does not exist

### Requirement: Log searches with zero results
The system SHALL insert a row into `failed_searches` when a search query returns 0 results.

#### Scenario: Empty search result from frontend
- **WHEN** a frontend user searches for "quantum entanglement" and no results are found
- **THEN** a row is inserted with `query = "quantum entanglement"` and `source = "frontend"`

#### Scenario: Empty search result from MCP
- **WHEN** an MCP client calls `search_notes` and no results are found
- **THEN** a row is inserted with `query` set to the search query and `source = "mcp"`

#### Scenario: Search with results
- **WHEN** a search query returns 1 or more results
- **THEN** no row is inserted into `failed_searches`

### Requirement: Hard cap at 100 rows with FIFO eviction
The system SHALL enforce a maximum of 100 rows in `failed_searches`. When inserting a new row would exceed the cap, the oldest row (by timestamp) SHALL be deleted first.

#### Scenario: Table at capacity
- **WHEN** `failed_searches` has 100 rows and a new empty search occurs
- **THEN** the oldest row is deleted and the new row is inserted, maintaining exactly 100 rows

#### Scenario: Table under capacity
- **WHEN** `failed_searches` has fewer than 100 rows and a new empty search occurs
- **THEN** the new row is inserted without deleting any existing rows
