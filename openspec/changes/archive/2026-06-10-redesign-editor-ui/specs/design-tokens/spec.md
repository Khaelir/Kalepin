## ADDED Requirements

### Requirement: Kalepin-branded CSS custom properties
The system SHALL expose a complete set of design tokens as CSS custom properties prefixed with `--kalepin-` on `:root`, covering brand colors, status colors, surfaces, text, borders, typography, spacing, radii, and shadows.

#### Scenario: Tokens available at :root
- **WHEN** any stylesheet references `var(--kalepin-primary)` or `var(--kalepin-bg)`
- **THEN** the value resolves to the brand/surface color defined on `:root`

#### Scenario: No LuceApp/BH naming remains
- **WHEN** the global stylesheet is inspected
- **THEN** no CSS custom property starts with `--luce-`, and no visible BH Technologies wordmark or BH-specific branding appears

### Requirement: Light and dark themes
The system SHALL provide paired token values for light and dark themes, switched via `html[data-theme='light']` / `html[data-theme='dark']`, with dark as the default.

#### Scenario: Dark is default
- **WHEN** the app first loads with no stored theme preference and the user's OS is dark-mode
- **THEN** `html[data-theme]` is set to `dark` and dark-theme token values are applied

#### Scenario: Light theme override
- **WHEN** the user selects the light theme in the tweaks panel
- **THEN** `html[data-theme='light']` is applied and all surfaces, text, and borders repaint with light values

#### Scenario: OS preference tracked when no manual override
- **WHEN** no theme is stored in localStorage and the OS theme changes
- **THEN** `html[data-theme]` updates to match the new OS preference

### Requirement: Density variants
The system SHALL provide three density variants (compact, comfortable, spacious) that adjust row padding (`--kalepin-row-py`) and editor max-width (`--kalepin-editor-max`), selected via `html[data-density]`.

#### Scenario: Compact density
- **WHEN** `html[data-density='compact']` is set
- **THEN** `--kalepin-row-py` resolves to 3px and `--kalepin-editor-max` resolves to 720px

#### Scenario: Comfortable density (default)
- **WHEN** no density attribute is set
- **THEN** `--kalepin-row-py` resolves to 5px and `--kalepin-editor-max` resolves to 760px

#### Scenario: Spacious density
- **WHEN** `html[data-density='spacious']` is set
- **THEN** `--kalepin-row-py` resolves to 7px and `--kalepin-editor-max` resolves to 820px

### Requirement: Accent color variants
The system SHALL support switching the accent color (`--kalepin-primary` and `--kalepin-primary-rgb`) among at least five preset swatches via `html[data-accent]` (orange, blue, green, purple, rose), with orange as the default in light theme and blue as the default in dark theme.

#### Scenario: Orange default in light theme
- **WHEN** the theme is light and no accent is set
- **THEN** `--kalepin-primary` is the Kalepin orange (`#f77500`) and `--kalepin-primary-rgb` is `247, 117, 0`

#### Scenario: Blue default in dark theme
- **WHEN** the theme is dark and no accent is set
- **THEN** `--kalepin-primary` is Kalepin blue and `--kalepin-primary-rgb` matches

#### Scenario: User selects a non-default accent
- **WHEN** the user selects the "purple" accent in the tweaks panel
- **THEN** `html[data-accent='purple']` is applied and all primary-colored surfaces (highlights, active rows, tab indicators) repaint with the purple token

### Requirement: Editor font variants
The system SHALL support switching the editor prose font between a serif (Source Serif 4) and a sans (Lato) via `html[data-editor-font]`, applied only to `.kp-prose` content.

#### Scenario: Sans font applies to prose only
- **WHEN** `html[data-editor-font='sans']` is set
- **THEN** `.kp-prose` renders in Lato while UI chrome (sidebar, top bar) continues to use the UI font

#### Scenario: Serif font (default)
- **WHEN** `html[data-editor-font='serif']` is set or the attribute is absent
- **THEN** `.kp-prose` renders in Source Serif 4

### Requirement: Typography scale tokens
The system SHALL expose UI typography sizes as named CSS variables (`--kalepin-fs-micro` through `--kalepin-fs-title`) and SHALL define editor-prose sizes separately (body 16px, H2 24px, H3 18px) so that density or accent changes never accidentally rescale prose.

#### Scenario: UI uses scale tokens
- **WHEN** a UI class references `var(--kalepin-fs-body)`
- **THEN** the value resolves to 13px

#### Scenario: Prose sizes are independent
- **WHEN** density switches to compact
- **THEN** editor body text remains 16px (density affects row padding and editor-max, not prose sizes)
