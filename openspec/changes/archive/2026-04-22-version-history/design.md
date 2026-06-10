## Context

Kalepin tracks every note change in `note_changes` (path, action, unified diff, userId, timestamp). The OT system also stores per-revision operations in `ot_operation_history`. Currently, this data serves only the "What's Changed" panel — a feed-level view of recent activity. There is no way to inspect the history of a single note, view past content, or restore a previous version.

The change tracking service prunes records older than 90 days or the oldest user's `lastActiveAt`. This pruning policy needs to coexist with version history — users expect history to persist longer than a change feed.

Notes are markdown files on disk, edited collaboratively via OT. Any restore action must flow through OT to avoid conflicts with concurrent editors.

## Goals / Non-Goals

**Goals:**
- Let users browse the full edit history of any note (who changed what, when)
- Reconstruct and display any historical version of a note
- Compare historical versions against the current document
- Restore a past version safely through OT (non-destructive, collaborative-aware)
- Keep reconstruction fast even for notes with long edit histories

**Non-Goals:**
- Git-backed version history (the Git adapter is optional and not universally available)
- Branching/forking (this is linear history only)
- Version history for attachments or non-markdown files
- Inline "track changes" / suggestion mode (different feature)
- Version history across renames (a renamed file starts fresh in history view; underlying data is preserved but not linked)

## Decisions

### 1. Snapshot-based reconstruction over full diff replay

**Decision**: Store periodic full-content snapshots in a new `note_snapshots` table. Reconstruct any version by finding the nearest earlier snapshot and replaying diffs forward.

**Alternatives considered**:
- *Full diff replay from creation*: Simple but O(n) on the total number of edits. A note with 500 edits would require replaying all 500 diffs to see the latest history entry. Unacceptable for interactive use.
- *Store full content on every change*: Simple reconstruction but massive storage cost. A 10KB note edited 500 times = 5MB of redundant storage per note.

**Rationale**: Snapshots every N changes (e.g., every 20 changes) cap the replay cost at O(20) while adding only ~5% storage overhead. The snapshot interval is configurable.

### 2. Use `note_changes` as the version source, not OT operations

**Decision**: Build version history on the `note_changes` table (coarser, meaningful save-points) rather than `ot_operation_history` (per-keystroke granularity).

**Alternatives considered**:
- *OT operations*: Character-level granularity, but creates overwhelming noise in a history timeline (hundreds of entries per editing session). Also requires OT-aware replay logic.
- *Hybrid*: Show OT ops within a change entry. Adds complexity without clear user value.

**Rationale**: `note_changes` entries correspond to logical save events — the right granularity for "version history." OT operations are an implementation detail of real-time sync, not user-visible versions.

### 3. Separate retention policy for version history

**Decision**: Version history data (changes + snapshots) uses a longer retention window than the "What's Changed" feed. Introduce a `VERSION_HISTORY_RETENTION_DAYS` env var (default: 365). The existing pruning in `ChangeTrackingService` will be split: the feed prunes aggressively (90 days / last-active), but `note_changes` rows are kept for the history retention period.

**Alternatives considered**:
- *Same retention*: Users lose history after 90 days, which defeats the purpose.
- *Infinite retention*: Storage grows unbounded. Not practical for self-hosted instances.

**Rationale**: A year of history covers most real use cases. Self-hosted users can tune the retention via env var.

### 4. Restore as an OT edit, not a file overwrite

**Decision**: Restoring a version submits the reconstructed content as a regular OT operation. This means concurrent editors see the restore happen in real-time, and the restore itself is recorded in history.

**Alternatives considered**:
- *Direct file write*: Bypasses OT, could cause conflicts with active sessions and data loss.

**Rationale**: OT is the single source of truth for writes. All mutations must go through it for consistency.

### 5. History panel as a right sidebar, not a modal

**Decision**: Version history opens as a sidebar panel in the editor (like the comments panel), not as a full-screen modal or separate page.

**Alternatives considered**:
- *Modal*: Blocks interaction with the editor, can't cross-reference.
- *Separate route*: Loses editor context, adds navigation complexity.

**Rationale**: Users want to see the history alongside the current document. A sidebar keeps the editor accessible and follows the existing pattern (comments panel).

### 6. API design — path-based, not ID-based routing

**Decision**: History endpoints use the file path as the identifier: `GET /api/files/history?path=...` and `GET /api/files/version?path=...&changeId=...`.

**Rationale**: Consistent with the existing files API which is path-based. The `changeId` (from `note_changes.id`) identifies a specific point in history.

## Risks / Trade-offs

**[Diff application failures]** → Diffs may fail to apply if the chain is corrupted (e.g., a change was pruned mid-chain, or an external editor modified the file without tracking). Mitigation: snapshots act as recovery points. If diff replay fails, fall back to the nearest snapshot and show a warning that some intermediate versions are unavailable.

**[Snapshot storage growth]** → For vaults with thousands of notes, snapshots add meaningful storage. Mitigation: configurable snapshot interval; snapshots are pruned along with their corresponding changes when retention expires. Could also compress snapshots (gzip) in a future iteration.

**[Pruning race condition]** → The existing prune job could delete changes that are being displayed in a history panel. Mitigation: the history API loads all needed data in a single query before rendering. Pruning is infrequent (runs on startup / daily) so the window is negligible.

**[Rename tracking]** → If a note is renamed, its history under the old path becomes disconnected. Mitigation: explicitly a non-goal for v1. The `RenameTrackingService` already updates `note_changes` paths on rename, so future versions could link histories. For now, history follows the current path.
