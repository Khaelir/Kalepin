## ADDED Requirements

### Requirement: Local graph visualization in right sidebar
The system SHALL display an interactive force-directed graph of the current note and its neighborhood (1-2 hops) within the right sidebar panel.

#### Scenario: Graph renders for current note
- **WHEN** the user opens the graph view in the BacklinksPanel for a note with links
- **THEN** the graph displays the current note as the center node and connected notes as surrounding nodes, with edges representing links

#### Scenario: Click node to navigate
- **WHEN** the user clicks a node in the local graph
- **THEN** the editor opens that note and the graph smoothly re-centers around it

#### Scenario: Labels on hover
- **WHEN** the user hovers over a node
- **THEN** the note title is displayed as a label. The current note's label is always visible regardless of hover state.

#### Scenario: Tooltip on hover
- **WHEN** the user hovers over a node
- **THEN** a tooltip displays the note title, inbound link count, outbound link count, and last-modified age

#### Scenario: Staleness coloring
- **WHEN** the graph renders nodes
- **THEN** nodes are colored on a gradient from bright (recently edited) to dim (stale), based on their last-modified timestamp from the note_changes table

#### Scenario: Ghost nodes for broken links
- **WHEN** a note contains a link to a non-existent target (targetPath is null)
- **THEN** the broken link appears as a ghost node with dimmed color and dashed outline, labeled with the raw link target text

#### Scenario: Super-hub protection
- **WHEN** the center note has 30 or more direct connections
- **THEN** only the 25 most relevant nodes are displayed (ranked by recency and link count), with a "+N more" indicator showing the count of hidden nodes

#### Scenario: Pop-out to full-screen
- **WHEN** the user clicks the pop-out button in the local graph panel
- **THEN** the view transitions to the full-screen global graph, centered on the same note

### Requirement: Global graph visualization (full-screen)
The system SHALL provide a full-screen view showing all notes and links in the vault as a force-directed graph.

#### Scenario: Full vault graph renders
- **WHEN** the user enters the full-screen graph view
- **THEN** all notes appear as nodes and all links appear as directed edges in a force-directed layout

#### Scenario: Orphan highlighting
- **WHEN** a note has zero inbound links
- **THEN** its node is rendered with a distinct visual treatment (hollow outline) to indicate it is an orphan

#### Scenario: Node size by degree
- **WHEN** the graph renders nodes
- **THEN** highly-connected notes appear larger than sparsely-connected notes, proportional to their total link count (inbound + outbound)

#### Scenario: Zoom and pan
- **WHEN** the user scrolls or drags on the full-screen graph
- **THEN** the graph zooms and pans accordingly, following standard canvas interaction patterns

#### Scenario: Click to navigate from global graph
- **WHEN** the user clicks a node in the full-screen graph
- **THEN** the system navigates to that note in the editor, switching back to workspace view

### Requirement: Directed edges with arrows
The system SHALL render edges as directed arrows indicating link direction.

#### Scenario: Arrow rendering
- **WHEN** note A links to note B
- **THEN** the edge is drawn from A to B with a subtle, small arrow at the target end

### Requirement: Live graph updates
The system SHALL update the graph when links change without requiring manual refresh.

#### Scenario: Debounced re-render on link change
- **WHEN** a link is added or removed in the editor
- **THEN** the graph re-fetches data and re-renders within 2-3 seconds, without interrupting user interaction
