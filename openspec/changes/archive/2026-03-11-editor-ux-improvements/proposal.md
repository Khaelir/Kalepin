## Why

The editor experience needs polish to feel more like a modern writing tool (similar to Microsoft Loop or Notion). Currently, the TipTap WYSIWYG editor has no way to view or edit raw Markdown, there's no editor-level context menu for common actions like copy/paste or adding comments, and sidebar file opening behavior may need adjustment for a smoother workflow.

## What Changes

- **Sidebar single-click open**: Ensure files open on single click (currently uses `onClick` — verify no competing behavior like selection-only-on-first-click). Remove any double-click requirement if present.
- **Dual-mode editor with rendered-first approach**: The editor opens in a rich/rendered Markdown view (TipTap WYSIWYG) by default. A mode selector allows toggling between "Rendered" mode (TipTap with slash commands) and "Raw Markdown" mode (plain text editor showing raw Markdown source). The rendered mode supports `/` commands as it does today.
- **Editor context menu**: Right-clicking inside the editor opens a contextual menu with standard actions (Cut, Copy, Paste) and an "Add Comment" action that creates a comment thread on the selected text, leveraging the existing comments system.

## Capabilities

### New Capabilities
- `editor-mode-toggle`: Dual-mode editor with a selector to switch between rendered (TipTap WYSIWYG) and raw Markdown text views
- `editor-context-menu`: Right-click context menu inside the editor with clipboard actions and "Add Comment" functionality

### Modified Capabilities

## Impact

- **Frontend components**: `Editor.tsx` needs a mode toggle and raw markdown view; new context menu component for editor area
- **Existing context menu**: The file tree `ContextMenu.tsx` can be reused or extended for the editor context menu
- **Comments integration**: The "Add Comment" action in the context menu ties into the existing comment thread system (backend + sidecar YAML storage)
- **Sidebar**: `FileTree.tsx` may need minor click behavior adjustments
- **No backend changes expected**: All changes are frontend-only, leveraging existing comment and file APIs
