## MODIFIED Requirements

### Requirement: Graph data query endpoint
The system SHALL provide an API endpoint to retrieve graph data (nodes and edges) for visualization.

#### Scenario: Full vault graph
- **WHEN** a client sends `GET /api/links/graph` without query parameters
- **THEN** the system returns all notes as nodes and all links as edges, with each node containing: path, title, inbound link count, outbound link count, and last-modified timestamp

#### Scenario: Depth-limited local graph
- **WHEN** a client sends `GET /api/links/graph?path=notes/meeting.md&depth=2`
- **THEN** the system returns only nodes within 2 hops of `notes/meeting.md` and edges between those nodes

#### Scenario: Node metadata includes last-modified
- **WHEN** graph data is returned
- **THEN** each node includes a `lastModified` field derived from the most recent entry in the `note_changes` table for that path, or null if no changes are recorded

#### Scenario: Broken links included as nodes
- **WHEN** the graph data is generated and a link has `targetPath: null`
- **THEN** a ghost node is included with the `rawTarget` as its identifier, `isBroken: true`, and zero link counts

#### Scenario: Authentication required
- **WHEN** a client sends `GET /api/links/graph` without valid authentication
- **THEN** the system returns 401 Unauthorized
