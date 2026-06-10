## ADDED Requirements

### Requirement: Inline mention pills while typing
The comment reply editor SHALL render mentions as styled pills immediately upon selection, matching the appearance of mentions in submitted comments.

#### Scenario: Select a mention from autocomplete
- **WHEN** the user types `@pier` in the reply editor and selects "j.doe" from the dropdown
- **THEN** the typed `@pier` text is replaced with a styled mention pill showing `@j.doe` with the user's assigned color
- **AND** the cursor is placed after the pill with a trailing space

#### Scenario: Mention pill appearance matches submitted comments
- **WHEN** a mention pill is displayed in the reply editor
- **THEN** it uses the same color scheme as `renderCommentText()` pills (colored text + 15% opacity background via `getColorForUser`)

#### Scenario: Backspace deletes entire mention pill
- **WHEN** the cursor is immediately after a mention pill and the user presses Backspace
- **THEN** the entire mention pill is deleted (not character-by-character), because the mention is an atomic node

### Requirement: Mention autocomplete in reply editor
The comment reply editor SHALL trigger a mention autocomplete dropdown when the user types `@`.

#### Scenario: Trigger autocomplete
- **WHEN** the user types `@` preceded by a space, newline, or at the start of text
- **THEN** a dropdown appears showing available users

#### Scenario: Filter by query
- **WHEN** the user types `@pier`
- **THEN** the dropdown filters to users whose display name or email contains "pier" (case-insensitive)

#### Scenario: Keyboard navigation
- **WHEN** the dropdown is open
- **THEN** Arrow Up/Down navigates the highlighted item, Enter selects, Escape dismisses

#### Scenario: Mouse selection
- **WHEN** the dropdown is open and the user clicks on a user
- **THEN** the mention is inserted and the dropdown closes

#### Scenario: No matches
- **WHEN** the user types `@xyznonexistent` and no users match
- **THEN** the dropdown dismisses

### Requirement: Serialization to mention markdown on submit
The reply editor SHALL serialize its content to the existing `@[name](email)` markdown format when the user submits.

#### Scenario: Submit with mentions
- **GIVEN** the editor contains: text "hello ", mention pill for `j.doe@example.com` (display: "j.doe"), text " thoughts?"
- **WHEN** the user clicks Reply
- **THEN** the `onReply` callback receives the string `hello @[j.doe](j.doe@example.com) thoughts?`

#### Scenario: Submit with multiple mentions
- **GIVEN** the editor contains two mention pills and surrounding text
- **WHEN** the user clicks Reply
- **THEN** all mentions are serialized in document order using `@[displayName](email)` format

#### Scenario: Submit plain text (no mentions)
- **GIVEN** the editor contains only plain text with no mentions
- **WHEN** the user clicks Reply
- **THEN** the `onReply` callback receives the plain text string

#### Scenario: Empty submit is blocked
- **WHEN** the editor is empty or contains only whitespace
- **THEN** the Reply button does nothing (same behavior as today)

### Requirement: Reply editor behavior
The reply editor SHALL behave like a lightweight text input, not a full document editor.

#### Scenario: No formatting toolbar
- **WHEN** the reply editor is displayed
- **THEN** there is no toolbar, no formatting buttons, and no slash commands

#### Scenario: Plain text only
- **WHEN** the user pastes rich text (bold, links, etc.) into the reply editor
- **THEN** only plain text is preserved (formatting is stripped)

#### Scenario: Enter creates newline
- **WHEN** the user presses Enter in the reply editor
- **THEN** a new line is created (not a submit action). The Reply button remains the submit mechanism.

#### Scenario: Focus on open
- **WHEN** the user clicks "Reply" to open the reply form
- **THEN** the editor is focused and ready for typing

#### Scenario: Editor clears on submit
- **WHEN** the user submits a reply
- **THEN** the editor content is cleared and the reply form closes

## MODIFIED Requirements

### Requirement: CommentsPanel reply form uses editor instead of textarea
The `CommentsPanel` component SHALL use the new `CommentReplyEditor` component in place of the current `<textarea>` for reply inputs.

#### Scenario: Reply form renders editor
- **WHEN** the user clicks "Reply" on a comment thread
- **THEN** a `CommentReplyEditor` is shown (not a textarea) with placeholder text "Write a reply..."

#### Scenario: Cancel closes editor
- **WHEN** the user clicks "Cancel"
- **THEN** the reply editor is hidden and any typed content is discarded

## REMOVED Requirements

### Requirement: MentionAutocomplete component for comments
The `MentionAutocomplete.tsx` component SHALL be removed as it is fully replaced by the editor-integrated `MentionAutocompleteMenu`.
