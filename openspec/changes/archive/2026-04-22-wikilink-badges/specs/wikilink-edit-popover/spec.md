## ADDED Requirements

### Requirement: Edit popover trigger
The system SHALL open an edit popover when the user double-clicks a wikilink badge or presses Enter on a selected badge.

#### Scenario: Double-click opens popover
- **WHEN** the user double-clicks a wikilink badge
- **THEN** a floating popover appears anchored to the badge, containing a text input pre-filled with the current target value

#### Scenario: Enter key opens popover
- **WHEN** a wikilink badge is selected (node selection) and the user presses Enter
- **THEN** the same edit popover appears anchored to the badge

#### Scenario: Ambiguous link click opens popover
- **WHEN** the user single-clicks an ambiguous wikilink badge (multiple basename matches)
- **THEN** the edit popover opens to allow disambiguation

### Requirement: Edit popover autocomplete
The edit popover SHALL provide the same autocomplete experience as wikilink creation, reusing existing suggestion UI and filtering logic.

#### Scenario: Input shows filtered suggestions
- **WHEN** the edit popover is open and the user types in the input field
- **THEN** note suggestions are filtered and displayed using the same logic and UI as the `[[` creation autocomplete

#### Scenario: Heading phase
- **WHEN** the user types `#` in the edit popover input after a note name
- **THEN** the suggestions switch to heading suggestions for that note, matching the `[[` creation autocomplete heading phase

#### Scenario: Pre-filled input
- **WHEN** the popover opens for a badge with `target: "Infra/Architecture#Overview"`
- **THEN** the input is pre-filled with `Infra/Architecture#Overview` and the cursor is at the end

### Requirement: Edit popover confirmation
The system SHALL update the wikilink node's target attribute when the user confirms an edit.

#### Scenario: Select suggestion to update
- **WHEN** the user selects a suggestion from the popover dropdown
- **THEN** the wikilink node's `target` attribute is updated via a ProseMirror transaction
- **AND** the popover closes

#### Scenario: Press Enter to confirm
- **WHEN** the user presses Enter with text in the input (no dropdown selection)
- **THEN** the wikilink node's `target` attribute is updated to the input value
- **AND** the popover closes

#### Scenario: Badge re-renders after update
- **WHEN** the wikilink node's target attribute is updated
- **THEN** the badge immediately re-renders with the new target text and re-evaluates its validity state

### Requirement: Edit popover dismissal
The system SHALL close the edit popover without changes on Escape or click-outside.

#### Scenario: Escape closes without change
- **WHEN** the edit popover is open and the user presses Escape
- **THEN** the popover closes and the wikilink node is unchanged

#### Scenario: Click outside closes without change
- **WHEN** the edit popover is open and the user clicks outside the popover
- **THEN** the popover closes and the wikilink node is unchanged

### Requirement: Edit popover rendering
The edit popover SHALL render as a floating element outside the ProseMirror DOM to avoid editor ownership conflicts.

#### Scenario: Popover positioning
- **WHEN** the edit popover opens
- **THEN** it renders as a React portal positioned below (or above if near bottom of viewport) the wikilink badge

#### Scenario: Popover does not steal editor focus permanently
- **WHEN** the edit popover closes
- **THEN** focus returns to the editor at the position of the edited wikilink badge
