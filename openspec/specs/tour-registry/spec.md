## Purpose

Declarative registry of tour definitions that the tour engine loads at runtime.

## Requirements

### Requirement: Declarative tour definitions
Each tour SHALL be defined as a typed TypeScript object with the following fields: `id` (unique string), `version` (integer, bumped when content changes significantly), `name` (display name), `description` (one-line summary), and `steps` (ordered array of step definitions).

#### Scenario: Tour definition structure
- **WHEN** a developer creates a new tour
- **THEN** they define a `TourDefinition` object with id, version, name, description, and steps array

### Requirement: Step definition structure
Each step SHALL have: `id` (unique within tour), `type` ('passive' | 'active'), `target` (CSS selector string or null for centered card), `title` (short heading), `body` (description text), `position` (preferred tooltip position), and optionally: `waitFor` (action ID for active steps), `illustration` (React node), `onEnter` / `onExit` callbacks.

#### Scenario: Passive step definition
- **WHEN** a step has `type: 'passive'` and `target: '.header-search-btn'`
- **THEN** the coach mark highlights the search button and shows [Next] to advance

#### Scenario: Active step definition
- **WHEN** a step has `type: 'active'` and `waitFor: 'slash-menu-opened'`
- **THEN** the coach mark waits for the user to trigger the slash menu before advancing

### Requirement: Tour registry as importable module
All tour definitions SHALL be collected in a registry (array or map) that the tour engine imports. Adding a new tour SHALL require only creating a tour definition file and adding it to the registry — no changes to the engine or coach mark component.

#### Scenario: Adding a new feature tour
- **WHEN** a developer adds a new `TourDefinition` for "backlinks" and registers it
- **THEN** the tour appears in the [?] dropdown and Settings > Tutorials without any other code changes

### Requirement: Version-based newness detection
The registry SHALL support comparing a user's completed tour versions against the registry's current versions to determine which tours are new or updated.

#### Scenario: Tour version bumped
- **WHEN** the "comments" tour version is bumped from 1 to 2 and the user has completed version 1
- **THEN** the system identifies "comments" as having a new version available
