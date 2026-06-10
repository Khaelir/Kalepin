## Purpose

Right-click context menu in the editor offering text-manipulation actions.

## Requirements

### Requirement: Right-click in editor opens context menu
Right-clicking inside the editor area SHALL open a contextual menu at the click position. The browser's default context menu SHALL be suppressed.

#### Scenario: Right-click shows context menu
- **WHEN** the user right-clicks inside the editor content area
- **THEN** a context menu appears at the cursor position
- **THEN** the browser's default context menu is suppressed

#### Scenario: Context menu closes on outside click
- **WHEN** the context menu is open and the user clicks outside of it
- **THEN** the context menu closes

### Requirement: Context menu provides clipboard actions
The context menu SHALL include Cut, Copy, and Paste actions that operate on the current text selection.

#### Scenario: Copy selected text
- **WHEN** the user has text selected and clicks "Copy" in the context menu
- **THEN** the selected text is copied to the clipboard

#### Scenario: Cut selected text
- **WHEN** the user has text selected and clicks "Cut" in the context menu
- **THEN** the selected text is cut to the clipboard and removed from the editor

#### Scenario: Paste from clipboard
- **WHEN** the user clicks "Paste" in the context menu
- **THEN** the clipboard content is inserted at the current cursor position

### Requirement: Context menu provides Add Comment action
The context menu SHALL include an "Add Comment" action when text is selected. This action SHALL create a new comment thread on the selected text using the existing comments system.

#### Scenario: Add Comment with text selected
- **WHEN** the user has text selected and clicks "Add Comment" in the context menu
- **THEN** a new comment thread is created for the selected text
- **THEN** the comments sidebar opens showing the new thread

#### Scenario: Add Comment without selection
- **WHEN** the user right-clicks without any text selected
- **THEN** the "Add Comment" option is NOT shown in the context menu

### Requirement: Context menu works only in rendered mode
The editor context menu with "Add Comment" SHALL only be available in rendered (WYSIWYG) mode. In raw markdown mode, the browser default context menu SHALL be used.

#### Scenario: Context menu in rendered mode
- **WHEN** the user right-clicks in the editor while in rendered mode
- **THEN** the custom context menu appears with clipboard and comment actions

#### Scenario: No custom context menu in raw mode
- **WHEN** the user right-clicks in the editor while in raw markdown mode
- **THEN** the browser's default context menu appears (no custom menu)
