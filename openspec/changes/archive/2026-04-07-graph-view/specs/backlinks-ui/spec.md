## MODIFIED Requirements

### Requirement: List/Graph toggle in BacklinksPanel
The BacklinksPanel SHALL include a toggle allowing users to switch between the existing list view and the graph visualization.

#### Scenario: Toggle from list to graph
- **WHEN** the user clicks the "Graph" option in the BacklinksPanel header toggle
- **THEN** the list view (backlinks, outgoing links, unlinked mentions) is replaced by the local graph visualization for the current note

#### Scenario: Toggle from graph to list
- **WHEN** the user clicks the "List" option in the BacklinksPanel header toggle
- **THEN** the graph visualization is replaced by the original list view with backlinks, outgoing links, and unlinked mentions

#### Scenario: Default view is list
- **WHEN** the BacklinksPanel opens for the first time
- **THEN** the list view is displayed by default

#### Scenario: Mode persists across note navigation
- **WHEN** the user has selected graph mode and navigates to a different note
- **THEN** the graph mode remains active, re-centered on the new note
