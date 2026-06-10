## MODIFIED Requirements

### Requirement: Backlinks are filtered by viewer visibility

`LinkIndexService.getBacklinks` SHALL accept a `viewerEmail` argument and exclude any result whose `sourcePath` is not visible to that viewer.

#### Scenario: Personal source backlink hidden from non-owner
- **WHEN** Alice's personal note links to a shared note `Notes/topic.md`, and Bob calls `GET /api/links/backlinks?path=Notes/topic.md`
- **THEN** the response does not contain Alice's personal source path

#### Scenario: Owner sees own personal backlink
- **WHEN** Alice calls `GET /api/links/backlinks?path=Notes/topic.md`
- **THEN** the response includes her personal note as a backlink source

### Requirement: Outgoing links exclude foreign personal targets

`LinkIndexService.getOutgoingLinks` SHALL accept a `viewerEmail` argument and exclude entries whose `targetPath` is not visible to the viewer.

#### Scenario: Foreign personal target hidden in outgoing list
- **WHEN** a shared note links to `_users/alice@example.com/Diary.md`, and Bob calls `GET /api/links/outgoing?path=Notes/source.md`
- **THEN** the response does not contain the personal target path

### Requirement: Unlinked-mentions inherit FTS visibility predicate

`LinkIndexService.getUnlinkedMentions` SHALL run its inner FTS query with the same viewer-visibility predicate as `full-text-search`.

#### Scenario: Personal mention candidate excluded from unlinked-mentions
- **WHEN** Alice's personal note contains the title of a shared note, and Bob calls `GET /api/links/unlinked-mentions?path=Notes/target.md`
- **THEN** the response does not contain Alice's personal note as a candidate

### Requirement: Graph data filters nodes and edges by viewer visibility

`LinkIndexService.getGraphData` SHALL accept a `viewerEmail` argument and exclude every node whose path is not visible to the viewer. Edges SHALL be excluded if either endpoint is excluded.

#### Scenario: Non-owner graph excludes foreign personal nodes
- **WHEN** Bob calls `GET /api/links/graph` and Alice has personal notes with links into the graph
- **THEN** the response contains zero nodes whose path begins with `_users/alice@example.com/` and zero edges referencing such paths

#### Scenario: Owner graph includes own personal nodes
- **WHEN** Alice calls `GET /api/links/graph`
- **THEN** the response contains her personal notes as nodes and any links into / out of them as edges
