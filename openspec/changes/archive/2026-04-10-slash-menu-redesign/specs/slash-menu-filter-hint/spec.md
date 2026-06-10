## ADDED Requirements

### Requirement: Filter hint bar displays current query
The slash menu SHALL display a hint bar at the top showing the current query prefixed with `/`. The hint bar SHALL be visible whenever the menu is open, including when the query is empty (showing just `/`).

#### Scenario: Empty query
- **WHEN** the slash menu opens and the user has typed only `/`
- **THEN** the hint bar SHALL display `/`

#### Scenario: Query with text
- **WHEN** the user has typed `/diag`
- **THEN** the hint bar SHALL display `/ diag`

### Requirement: Filter hint bar styling
The hint bar SHALL be styled as a subtle, non-interactive area at the top of the menu, visually separated from the command list below it.

#### Scenario: Visual separation
- **WHEN** the slash menu is open
- **THEN** the hint bar SHALL be separated from the commands list by a divider or distinct background

### Requirement: Dismiss affordance
The hint bar SHALL include a visual indicator (such as `✕` or Esc label) communicating that the menu can be dismissed.

#### Scenario: Dismiss indicator visible
- **WHEN** the slash menu is open
- **THEN** a dismiss affordance SHALL be visible in the hint bar area
