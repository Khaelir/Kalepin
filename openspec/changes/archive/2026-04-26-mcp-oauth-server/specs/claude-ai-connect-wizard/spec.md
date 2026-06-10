## ADDED Requirements

### Requirement: Settings exposes a "Connect to Claude.ai" affordance

The Settings page SHALL display a "Connect to Claude.ai" call-to-action in the Connections section, alongside the existing "New API key" affordance. Activating it SHALL open a wizard explaining the handoff to claude.ai's connector UI.

#### Scenario: Affordance visible on Settings
- **WHEN** the user opens the Settings page
- **THEN** the Connections section shows two side-by-side cards: "Claude.ai (web)" with a Connect button, and "Claude Code (CLI)" with a New API key button

#### Scenario: Activating the wizard
- **WHEN** the user clicks "Connect" on the Claude.ai card
- **THEN** a modal or inline panel opens displaying the three-step wizard

### Requirement: Wizard guides the user through the handoff

The wizard SHALL display three steps: (1) open claude.ai's connector page, (2) copy and paste Kalepin's MCP URL, (3) expect to be redirected back for consent. Each step SHALL be visually distinct and ordered.

#### Scenario: Wizard step 1 — open claude.ai
- **WHEN** the wizard is open
- **THEN** step 1 displays a button labeled "Open Claude.ai connectors" that links to claude.ai's connector settings (using `target="_blank" rel="noopener"`)

#### Scenario: Wizard step 2 — copy MCP URL
- **WHEN** the user views step 2
- **THEN** the wizard displays Kalepin's MCP URL (`<base_url>/mcp`) inside a read-only field with a copy-to-clipboard button; clicking copy gives confirmation feedback

#### Scenario: Wizard step 3 — expect redirect
- **WHEN** the user views step 3
- **THEN** the wizard displays an explanation that claude.ai will redirect them back to Kalepin to grant access, and reassures them that "You'll see a consent screen — that's normal."

### Requirement: Wizard surfaces plan-gating caveat

The wizard SHALL display a clearly visible note that custom connectors may require a paid claude.ai plan, with a link to the relevant Anthropic documentation.

#### Scenario: Plan-gating note shown
- **WHEN** the wizard is open
- **THEN** above or below the steps, a note in muted styling reads "Adding custom connectors in Claude.ai may require a Pro, Max, Team, or Enterprise plan." with an inline link "Learn more"

### Requirement: Wizard is dismissible and reopenable

The wizard SHALL be closable by the user (close button or backdrop click) and SHALL be reopenable from the Settings affordance without losing layout state.

#### Scenario: Close and reopen
- **WHEN** the user closes the wizard and reopens it
- **THEN** the wizard reopens at step 1 with the MCP URL pre-filled

### Requirement: Wizard is keyboard-accessible

The wizard SHALL be operable with a keyboard. Focus SHALL move into the wizard on open and SHALL return to the triggering element on close. The Escape key SHALL close the wizard.

#### Scenario: Keyboard navigation
- **WHEN** the user activates the wizard via keyboard and presses Tab
- **THEN** focus cycles through the action elements (step 1 button, copy button, close button) in order

#### Scenario: Escape closes
- **WHEN** the wizard is open and the user presses Escape
- **THEN** the wizard closes and focus returns to the triggering "Connect" button
