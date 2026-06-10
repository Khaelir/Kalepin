## Why

Kalepin already records every change to every note (diffs, user attribution, timestamps) in the `note_changes` table — but none of this data is surfaced to users. There's no way to see what a note looked like yesterday, compare two points in time, or recover from an accidental edit. In a collaborative tool where multiple people edit the same documents, version history is the safety net that lets users edit confidently. Without it, the change tracking data is write-only infrastructure with no user-facing value.

## What Changes

- New **version history panel** in the editor sidebar showing a chronological list of changes for the currently open note, with user attribution and timestamps
- Ability to **view any past version** as a reconstructed read-only document
- **Diff comparison** between any historical version and the current document (unified format)
- **Restore** from a historical version — applies as a new edit through OT, preserving history (non-destructive)
- New backend endpoints to **query change history per file** and **reconstruct document state** at any point by replaying diffs forward from creation
- **Snapshot storage** to avoid replaying long diff chains — periodic full-content snapshots stored alongside diffs

## Capabilities

### New Capabilities
- `version-reconstruction`: Backend logic to reconstruct full document content at any historical point by chaining diffs, with periodic snapshots for performance
- `version-history-ui`: Editor sidebar panel showing change timeline, read-only version preview, diff view, and restore action

### Modified Capabilities

## Impact

- **Backend**: New controller/service for version history endpoints, new snapshot entity/table, modifications to `ChangeTrackingService` to store snapshots on significant edits
- **Frontend**: New `VersionHistoryPanel` component, integration with the editor toolbar, read-only TipTap viewer for historical versions
- **Database**: New `note_snapshots` table for periodic full-content snapshots
- **API**: New `GET /api/files/:path/history` and `GET /api/files/:path/version/:id` endpoints
- **OT integration**: Restore action flows through OT as a regular edit, so collaborators see it in real-time
