## ADDED Requirements

### Requirement: Help button in editor toolbar
The system SHALL render a `?` button in the editor header bar (alongside the search button and backlinks button). The button SHALL be always visible when a document is open.

#### Scenario: Document is open
- **WHEN** a user has a file open in the editor
- **THEN** a `?` button is visible in the editor header

### Requirement: Help button dropdown
Clicking the `?` button SHALL open a small dropdown listing all available tours from the registry. Each entry shows the tour name and a completion indicator (checkmark if completed, empty if not). Clicking a tour entry starts or restarts that tour. The dropdown closes when a tour is selected or when clicking outside.

#### Scenario: User clicks ? button
- **WHEN** the user clicks the `?` button
- **THEN** a dropdown appears listing all tours (e.g., "Getting Started ✓", "Comments", "Search")

#### Scenario: User selects a completed tour
- **WHEN** the user clicks "Getting Started ✓" in the dropdown
- **THEN** the essentials tour starts from step 1 (replay)

#### Scenario: User selects an uncompleted tour
- **WHEN** the user clicks "Comments" (no checkmark) in the dropdown
- **THEN** the comments tour starts from step 1

### Requirement: Settings tutorials section
The Settings page SHALL include a "Tutorials" section below the existing "API Keys" section. It SHALL list all tours with their name, description, completion status, and a [Replay] button. Completed tours show a checkmark and the [Replay] button. Uncompleted tours show a [Start] button.

#### Scenario: Settings page with tours
- **WHEN** the user navigates to Settings
- **THEN** a "Tutorials" section shows all available tours with status and action buttons

#### Scenario: User clicks Replay on a completed tour
- **WHEN** the user clicks [Replay] next to "Getting Started" in Settings
- **THEN** the view switches to workspace and the essentials tour starts from step 1

#### Scenario: User clicks Start on an uncompleted tour
- **WHEN** the user clicks [Start] next to "Comments" in Settings
- **THEN** the view switches to workspace and the comments tour starts from step 1
