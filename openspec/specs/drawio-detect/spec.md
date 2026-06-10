## Purpose

Detects draw.io content in notes — both raw XML inside code blocks (for which a guidance banner is shown) and draw.io metadata embedded in SVG attachments (which drives badge and Edit-action display).

## Requirements

### Requirement: Detect draw.io XML in code blocks
Code blocks containing raw draw.io XML SHALL display an inline hint banner guiding the user to export as SVG from draw.io instead.

#### Scenario: Code block contains mxfile XML
- **WHEN** a code block's text content contains `<mxfile` or `<mxGraphModel`
- **THEN** an informational banner is shown above or inside the code block
- **THEN** the banner text reads: "This looks like a draw.io diagram. Export as SVG from draw.io to see it rendered."
- **THEN** the raw XML is still visible beneath the banner

#### Scenario: Code block contains normal code
- **WHEN** a code block contains content that does not match draw.io XML patterns
- **THEN** no banner is shown; the code block renders normally

#### Scenario: Code block has explicit language set
- **WHEN** a code block has a language like `xml` or `html` and contains draw.io XML
- **THEN** the banner is still shown (detection is content-based, not language-based)

### Requirement: Detect draw.io metadata in SVG images
SVG images containing draw.io metadata in the `content` attribute SHALL be identified as draw.io diagrams.

#### Scenario: SVG with draw.io content attribute
- **WHEN** an SVG attachment is rendered and its root `<svg>` element has a `content` attribute containing `mxGraphModel` or `mxfile` data
- **THEN** the image is flagged as a draw.io diagram for badge and edit action display

#### Scenario: Regular SVG without draw.io metadata
- **WHEN** an SVG attachment is rendered and has no draw.io `content` attribute
- **THEN** the image is treated as a regular SVG image with no draw.io actions
