## ADDED Requirements

### Requirement: Auto-install plugin into vault
The system SHALL auto-install the Obsidian plugin by writing plugin files (`main.js`, `manifest.json`, `styles.css`) into `vault/.obsidian/plugins/kalepin-comments/`.

#### Scenario: Plugin auto-install on startup
- **WHEN** the Kalepin server starts and the vault has an `.obsidian/` directory
- **THEN** the system writes/updates the plugin files in `.obsidian/plugins/kalepin-comments/`

#### Scenario: Vault without Obsidian directory
- **WHEN** the vault does not have an `.obsidian/` directory
- **THEN** the system skips plugin auto-install (the vault is not configured as an Obsidian vault)

### Requirement: Display comments in Obsidian
The Obsidian plugin SHALL read `.collab` sidecar files and display comments inline in the Obsidian editor/preview.

#### Scenario: Open file with comments
- **WHEN** a user opens a markdown file in Obsidian that has a corresponding `.collab` sidecar file
- **THEN** the plugin reads the sidecar and displays comment indicators next to anchored blocks

#### Scenario: View comment thread
- **WHEN** a user clicks a comment indicator in Obsidian
- **THEN** the plugin shows the full comment thread (author, text, timestamp, resolved status)

#### Scenario: File without comments
- **WHEN** a user opens a markdown file with no sidecar file
- **THEN** the plugin shows no comment indicators (no errors)
