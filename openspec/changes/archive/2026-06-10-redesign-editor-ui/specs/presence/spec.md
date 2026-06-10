## MODIFIED Requirements

### Requirement: Presence indicators in UI
The system SHALL display presence avatars in two surfaces: a top-bar stack (up to 4 avatars visible with "+N" overflow) and an editor-left-gutter column (up to 4 avatars aligned to the doc-header title). Each 24px avatar MUST have a 2px ring in the user's assigned color and show a hover card with the user's name and current editing location.

#### Scenario: Top-bar stack with few users
- **WHEN** three users are viewing the same document
- **THEN** three 24px avatars are shown in the top-bar presence stack, each with a 2px user-color ring

#### Scenario: Top-bar stack overflows
- **WHEN** six users are viewing
- **THEN** four avatars are shown in the top-bar stack followed by a "+2" bubble

#### Scenario: Editor gutter mirror
- **WHEN** three users are viewing
- **THEN** up to four 24px avatars are also shown in the editor's left gutter aligned near the doc title, as a visual reinforcement of who is present in the doc

#### Scenario: Hover card
- **WHEN** the user hovers a top-bar avatar
- **THEN** a card pops up with the user's name (email short form) and their current editing location (e.g., "editing on line 42")

#### Scenario: Click gutter avatar scrolls to user
- **WHEN** the user clicks an editor-gutter avatar
- **THEN** the editor scrolls to that user's cursor position
