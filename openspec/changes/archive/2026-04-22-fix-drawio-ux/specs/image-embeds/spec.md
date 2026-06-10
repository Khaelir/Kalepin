## ADDED Requirements

### Requirement: Draw.io image display styling
The image embed system SHALL apply a white background to images identified as draw.io diagrams (wrapper has `.drawio-image` class) to ensure visibility across all themes.

#### Scenario: Draw.io SVG rendered in dark theme
- **WHEN** an image with the `.drawio-image` wrapper class is rendered in the editor
- **THEN** the `<img>` element within the wrapper SHALL have `background: white` applied via CSS
