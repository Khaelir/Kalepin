## ADDED Requirements

### Requirement: Draw.io diagrams render with white background in all themes
The system SHALL display a white background behind draw.io diagram images in the note view, regardless of the active Kalepin theme (light or dark).

#### Scenario: Dark theme user views a draw.io diagram
- **WHEN** a user with dark theme enabled views a note containing a draw.io SVG diagram
- **THEN** the diagram SHALL be displayed with a white background so all text and shapes are visible

#### Scenario: Light theme user views a draw.io diagram
- **WHEN** a user with light theme enabled views a note containing a draw.io SVG diagram
- **THEN** the diagram SHALL be displayed with a white background (matching existing behavior)

### Requirement: Draw.io editor popup menus appear below the menu bar
The draw.io embedded editor SHALL NOT override the default CSS `position` property on popup menus. Menus triggered from the menu bar (File, Edit, View, etc.) SHALL appear directly below the menu item that was clicked.

#### Scenario: User clicks File menu
- **WHEN** a user clicks the "File" menu item in the draw.io editor menu bar
- **THEN** the dropdown menu SHALL appear directly below the "File" menu item, within the top 30% of the editor viewport

### Requirement: Draw.io editor cell text editing positions correctly
The draw.io embedded editor SHALL NOT interfere with mxGraph's `scrollCellToVisible()` behavior. When a user double-clicks a shape to edit text, the cell editor overlay SHALL appear on top of the shape.

#### Scenario: User double-clicks a rectangle to edit text
- **WHEN** a user double-clicks a shape (e.g., rectangle) in the draw.io editor
- **THEN** the text editor overlay SHALL appear positioned over the shape
- **AND** the editor cursor SHALL be visible within the shape bounds

### Requirement: Extras menu is hidden in embedded editor
The draw.io embedded editor SHALL hide the "Extras" menu item from the menu bar, as its options are not functional in embed mode.

#### Scenario: User views the draw.io editor menu bar
- **WHEN** the draw.io editor loads in embedded mode
- **THEN** the "Extras" menu item SHALL NOT be visible in the menu bar
