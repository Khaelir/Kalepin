## 1. Backend — Restore Safety

- [x] 1.1 Add auto-snapshot logic to the restore endpoint: before applying restored content, read current file content, create a `note_changes` row (action: `modified`) and a `note_snapshots` row with the current content
- [x] 1.2 Add early return when restored content is identical to current content (no-op restore)

## 2. Frontend — Preview State Management

- [x] 2.1 Add `previewingVersion` state to `App.tsx` (holds reconstructed content + selected entry, or null)
- [x] 2.2 Wire editor to switch to `editable: false` and display preview content when `previewingVersion` is set
- [x] 2.3 Wire editor to restore live content and `editable: true` when `previewingVersion` is cleared
- [x] 2.4 Clear `previewingVersion` when the version history panel is closed (return to live editing)

## 3. Frontend — Panel Simplification

- [x] 3.1 Remove `computeLineDiff` function and all diff rendering (diff-add, diff-del markup, `<pre>` diff block) from `VersionHistoryPanel.tsx`
- [x] 3.2 Remove "View full version" button (preview is now the default behavior)
- [x] 3.3 Update `handleSelectEntry` to call `onViewVersion` directly with reconstructed content (preview swaps in-place on each click)
- [x] 3.4 Update panel to refresh history list after a successful restore

## 4. Frontend — Visual Treatment

- [x] 4.1 Add a read-only banner above the editor when previewing a historical version (shows timestamp of the version being viewed)
- [x] 4.2 Add dimmed/reduced-opacity styling to the editor area during preview mode
- [x] 4.3 Style the "Restore this version" button and confirmation dialog within the panel (no diff section, just timeline + actions)
