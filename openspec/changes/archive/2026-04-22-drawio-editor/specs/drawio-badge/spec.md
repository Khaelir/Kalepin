## ADDED Requirements

### Requirement: draw.io badge on SVG images
SVG images identified as draw.io diagrams SHALL display a "draw.io" badge on hover, alongside existing image actions.

#### Scenario: Hover on draw.io SVG
- **WHEN** the user hovers over an SVG image that contains draw.io metadata
- **THEN** a "draw.io" badge is visible in the image action bar
- **THEN** an "Edit" button is shown alongside the existing maximize and download actions

#### Scenario: Hover on regular image
- **WHEN** the user hovers over a non-draw.io image (PNG, JPEG, regular SVG)
- **THEN** only the standard maximize and download actions are shown
- **THEN** no draw.io badge appears

### Requirement: Edit action opens draw.io editor
The "Edit" action on a draw.io SVG SHALL open the fullscreen draw.io editor modal.

#### Scenario: Click Edit on draw.io SVG
- **WHEN** the user clicks the "Edit" button on a draw.io SVG image
- **THEN** the SVG content (including draw.io metadata) is extracted
- **THEN** the fullscreen draw.io editor modal opens with the diagram loaded
