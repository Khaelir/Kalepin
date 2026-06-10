## Context

The version history panel currently shows a line-level diff (red/green) when a user selects a historical version. This is developer-oriented and unhelpful for most users. The "View full version" button exists but opens in a separate view rather than replacing the editor content. We want to replace the diff entirely with an in-editor read-only preview of the reconstructed document, and add a safety net for restores.

The existing infrastructure — snapshot storage, diff replay via `reconstructVersion`, the history timeline panel, and the restore endpoint — all remain. This change is purely about the **presentation layer** and **restore safety**.

## Goals / Non-Goals

**Goals:**
- Replace diff view with full document preview rendered in the TipTap editor in read-only mode
- Make version scrubbing frictionless (click entry → preview swaps immediately)
- Ensure closing the panel returns to live editing without data loss
- Auto-snapshot before restore so history itself acts as undo

**Non-Goals:**
- Changing the backend reconstruction algorithm or snapshot strategy
- Adding side-by-side comparison views
- Adding a dedicated "undo restore" UI element (history IS the undo)

## Decisions

### 1. Preview via TipTap `editable: false` on the existing editor instance

Rather than rendering a second TipTap instance or a raw markdown block, we set the existing editor to `editable: false` and replace its content with the reconstructed markdown. This reuses all existing rendering (headings, lists, code blocks, images) and avoids layout duplication.

**Alternative considered:** Separate read-only TipTap instance in a split pane. Rejected — adds layout complexity and doesn't match the "seeing the document as it was" mental model. The user should feel like they're looking at the document, not a comparison view.

### 2. State management: `previewingVersion` state in App

A new piece of state in `App.tsx` tracks whether we're in preview mode and holds the reconstructed content. When set:
- Editor switches to `editable: false`
- Editor content is replaced with the preview content
- A banner appears over the editor indicating read-only historical view
- The version history panel highlights the selected entry

When cleared (panel close, "Back to current", or after restore):
- Editor restores live content and `editable: true`

The live content is never lost — it remains in the OT session. The preview is purely a visual overlay.

### 3. Auto-snapshot before restore via backend

The restore endpoint (`POST /api/files/restore`) will, before applying the historical content:
1. Read the current file content
2. Force-create a snapshot with the current content + a new `note_changes` row (action: `modified`)
3. Then apply the restored content as usual via OT

This ensures the pre-restore state always appears in history. No frontend changes needed for "undo" — the user just selects that entry from the timeline.

### 4. Remove `computeLineDiff` and all diff rendering

The entire diff computation (`computeLineDiff` LCS algorithm) and diff rendering (`diff-add`, `diff-del` CSS classes, `<pre>` diff block) are removed from `VersionHistoryPanel.tsx`. The panel becomes a pure timeline + action buttons.

## Risks / Trade-offs

- **Risk: Editor content flicker during preview swap** → Mitigation: Set content and editable state in a single React render cycle. Consider a brief fade transition.
- **Risk: User edits while in preview mode (shouldn't be possible but edge case)** → Mitigation: TipTap's `editable: false` is the hard guard. Banner is visual reinforcement only.
- **Risk: Large document reconstruction is slow, blocking preview** → Mitigation: Already handled by existing "Reconstructing version..." loading state. No change needed.
- **Trade-off: Losing diff view entirely** → Accepted per user decision. Diffs are dev-oriented; full preview is more intuitive. If needed later, could be re-added as a secondary toggle.
