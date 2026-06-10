## Why

The current version history panel shows a diff view (red/green line-level diff) when a user selects a historical version. This is developer-oriented and unintuitive for most users. Users want to see what the document actually looked like at a point in time, not a patch. Additionally, the restore flow needs a safety net — currently restoring overwrites content with no easy way back.

## What Changes

- **Remove** the diff view (`computeLineDiff` and diff rendering) from the version history panel entirely
- **Replace** with full document preview: selecting a history entry renders the reconstructed document in the editor area using TipTap's `editable: false` mode with a visual "read-only / viewing historical version" treatment
- **Add** version scrubbing: clicking different history entries swaps the preview in-place without extra confirmation
- **Add** auto-snapshot before restore: before overwriting content, the system force-creates a snapshot of the current state so the user can always "undo" by selecting that snapshot from history
- **Update** panel close behavior: closing the panel (without having edited) returns the editor to the current live document

## Capabilities

### New Capabilities
- `version-preview`: Read-only document preview mode when viewing historical versions, replacing the diff view
- `restore-safety`: Auto-snapshot current content before restore so history acts as undo

### Modified Capabilities
- `version-history-ui`: Remove diff view, update panel interactions for preview mode and version scrubbing

## Impact

- **Frontend**: `VersionHistoryPanel.tsx` — remove `computeLineDiff`, diff rendering, and "View full version" button. Add read-only preview state management.
- **Frontend**: `App.tsx` — editor must switch to `editable: false` with reconstructed content when a version is previewed, and restore to live content on panel close.
- **Frontend**: `styles.css` — new visual treatment for read-only historical preview (banner, dimmed/grayed appearance).
- **Backend**: `version-history.service.ts` or `files.controller.ts` — restore endpoint must force-snapshot current content before applying the restored version.
