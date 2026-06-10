## ADDED Requirements

### Requirement: Default template for newly-created mermaid blocks
When a mermaid code block is created with empty source content, the editor SHALL automatically populate it with a default template containing valid, renderable mermaid syntax. The fill SHALL apply uniformly across all creation paths (slash command, markdown input rule, paste, programmatic insertion) via a single ProseMirror plugin so behavior cannot diverge between entry points.

The default template SHALL be `graph LR\n  A --> B`.

#### Scenario: Slash command inserts working diagram
- **WHEN** the user invokes the `/mermaid` slash command
- **THEN** a mermaid code block is inserted containing `graph LR\n  A --> B` with a real newline character and a literal `>` character
- **AND** the block immediately renders as a valid SVG diagram with no parse error

#### Scenario: Markdown fence creates working diagram
- **WHEN** the user types `​```mermaid` followed by Enter (triggering the markdown input rule) and the resulting code block has empty source
- **THEN** the editor populates the block with the default template
- **AND** the block renders as a valid SVG diagram

#### Scenario: Pasted empty mermaid fence is filled
- **WHEN** the user pastes a mermaid code fence whose body is empty (e.g., from a doc skeleton)
- **THEN** the editor populates the resulting code block with the default template

#### Scenario: Pasted mermaid fence with content is preserved
- **WHEN** the user pastes a mermaid code fence whose body already contains source content
- **THEN** the pasted content is preserved verbatim and the default template is NOT injected

#### Scenario: Default fill does not loop
- **WHEN** the auto-fill plugin appends its own transaction to insert the default template
- **THEN** that transaction is tagged with a meta flag and the plugin SHALL NOT re-trigger on its own follow-up transaction

### Requirement: Mermaid block insertion preserves source text faithfully
Programmatic insertion of mermaid code blocks SHALL preserve newlines, leading whitespace, and special characters (notably `>`) as literal text. The insertion SHALL use ProseMirror node structure rather than plain HTML strings, since string arguments to `insertContent` are HTML-parsed and collapse whitespace and entity-encode reserved characters.

#### Scenario: Slash command preserves arrow syntax
- **WHEN** the `/mermaid` slash command inserts the default template
- **THEN** the resulting node's `textContent` contains the literal characters `-->` (not `--&gt;`)
- **AND** the resulting node's `textContent` contains a real `\n` between `graph LR` and `  A --> B`
- **AND** the resulting node's `textContent` preserves the two leading spaces before `A`

#### Scenario: User-deleted content is not refilled
- **WHEN** the user selects all text inside an existing mermaid block and deletes it within the same editing session
- **THEN** the auto-fill plugin SHALL NOT re-inject the default template, because the block existed at this position before the deletion transaction

### Requirement: Cursor placement after default fill
After the editor auto-fills a newly-created mermaid block with the default template, the selection SHALL be placed at the end of the inserted text so the user can continue typing to extend the diagram.

#### Scenario: Cursor lands at end of template
- **WHEN** a mermaid block is auto-filled with the default template
- **THEN** the cursor is positioned at the end of the inserted text content
- **AND** the user's next keystroke appends to the template rather than replacing it

### Requirement: Empty mermaid block placeholder
When a mermaid code block has empty source AND is not in source-editing mode AND no previous valid SVG was rendered for it, the rendered view SHALL display a clickable empty-state placeholder that visually communicates the block exists and how to populate it. Clicking the placeholder SHALL switch the block to source-editing mode.

This requirement covers the case where an existing mermaid block is emptied by the user and then loses focus — the auto-fill plugin does not refill (since the block is not newly created), but the user should not see silent blank space.

#### Scenario: Existing block emptied and blurred shows placeholder
- **GIVEN** a mermaid block previously contained valid source and rendered an SVG
- **WHEN** the user deletes all source content and the block loses focus
- **THEN** the rendered view displays a placeholder with text indicating the block is an empty mermaid diagram and is clickable to edit

#### Scenario: Placeholder click enters edit mode
- **WHEN** the user clicks the empty-mermaid placeholder
- **THEN** the block switches to source-editing mode with focus inside the source `<pre>`

#### Scenario: Placeholder hidden when source non-empty
- **WHEN** a mermaid block has any non-whitespace source content
- **THEN** the placeholder is NOT shown (regular rendered view, error view, or stale-render view applies as before)
