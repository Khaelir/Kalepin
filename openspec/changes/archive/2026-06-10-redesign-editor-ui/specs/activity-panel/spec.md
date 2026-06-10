## ADDED Requirements

### Requirement: Activity tab placeholder
The right rail SHALL include an "Activity" tab. Until the backend activity feed is implemented, the tab SHALL render an empty-state card indicating the feature is forthcoming, matching the visual language of other empty states.

#### Scenario: Open Activity tab
- **WHEN** the user clicks the Activity tab
- **THEN** the panel shows an empty-state card with iconography and copy (e.g., "Activity feed coming soon")

#### Scenario: No requests made
- **WHEN** the Activity tab is open
- **THEN** no API calls are made to the backend (no activity endpoint exists yet)

### Requirement: Activity tab contract (deferred)
The Activity tab's final contract — showing chronological events (edited / commented / resolved / renamed / linked / shared) with actor, action, target, time, and colored dot icon — SHALL be specified when the backend feed is added in a follow-up change.

#### Scenario: Deferred
- **WHEN** the Activity tab is reviewed for completeness
- **THEN** the placeholder state is accepted as the v1 behavior and a follow-up change will add the feed
