## MODIFIED Requirements

### Requirement: Parse links from markdown content
The system SHALL extract all inter-note links from markdown content, supporting both wikilink and standard markdown link syntax. Wikilinks with heading fragments (`[[Page#Heading]]`) SHALL have the fragment stripped before indexing -- the raw target stored is the note name only.

#### Scenario: Parse wikilinks
- **WHEN** a note contains `[[Meeting Notes]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Meeting Notes`

#### Scenario: Parse wikilinks with alias
- **WHEN** a note contains `[[Meeting Notes|yesterday's meeting]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Meeting Notes` (the alias is ignored for indexing)

#### Scenario: Parse wikilinks with heading fragment
- **WHEN** a note contains `[[Architecture#API Design]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Architecture` (the `#API Design` fragment is stripped)

#### Scenario: Parse wikilinks with heading fragment and alias
- **WHEN** a note contains `[[Architecture#API Design|see API section]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Architecture` (both `#heading` and `|alias` are stripped)

#### Scenario: Parse same-page heading link
- **WHEN** a note contains `[[#Introduction]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target equal to the empty string or the current file (this is a self-reference) -- the link resolves to the source file itself

#### Scenario: Parse markdown links to local notes
- **WHEN** a note contains `[see here](../docs/architecture.md)`
- **THEN** the parser extracts a link with type `markdown` and raw target `../docs/architecture.md`

#### Scenario: Ignore external URLs
- **WHEN** a note contains `[Google](https://google.com)` or `[[https://example.com]]`
- **THEN** the parser does NOT extract these as inter-note links

#### Scenario: Ignore image embeds
- **WHEN** a note contains `![alt](image.png)` or `![[image.png]]`
- **THEN** the parser does NOT extract these as inter-note links (files without `.md` extension are skipped for markdown links; `![[` prefix is skipped for wikilinks)

### Requirement: Resolve wikilinks to file paths
The system SHALL resolve wikilink targets to actual file paths using shortest-unique-path matching consistent with Obsidian behavior. Heading fragments SHALL be stripped before resolution.

#### Scenario: Exact path match
- **WHEN** a wikilink target is `docs/Architecture` and `docs/Architecture.md` exists
- **THEN** the link resolves to `docs/Architecture.md`

#### Scenario: Basename match (unique)
- **WHEN** a wikilink target is `Architecture` and only one file named `Architecture.md` exists in the vault
- **THEN** the link resolves to that file's full path

#### Scenario: Ambiguous basename with same-directory preference
- **WHEN** a wikilink target is `Notes` and multiple files named `Notes.md` exist, and one is in the same directory as the source file
- **THEN** the link resolves to the same-directory file

#### Scenario: Unresolvable wikilink
- **WHEN** a wikilink target does not match any existing file
- **THEN** the link is stored with a null resolved path (dangling link)

#### Scenario: Wikilink with heading fragment resolves same as without
- **WHEN** a wikilink target is `Architecture#API Design`
- **THEN** the `#API Design` is stripped and the link resolves identically to `[[Architecture]]`

#### Scenario: Same-page link resolves to source file
- **WHEN** a note at `docs/overview.md` contains `[[#Introduction]]`
- **THEN** the link resolves to `docs/overview.md` (the source file itself)
