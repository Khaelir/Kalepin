## ADDED Requirements

### Requirement: Milestone persistence
The system SHALL persist user-created milestones in a `note_milestones` table. Each row SHALL contain `id`, `path`, `name`, optional `description`, full markdown `content` (materialized at creation), `createdBy` (FK → User, ON DELETE SET NULL), `createdAt`, and the optional anchor fields `anchorChangeId` (FK → note_changes, ON DELETE SET NULL), `anchorChangeCreatedAt`, `anchorAuthorEmail`. A unique constraint SHALL apply to `(path, name)`.

#### Scenario: Milestone row stores full content at creation
- **WHEN** a milestone is created for a note whose current content is `C`
- **THEN** the inserted `note_milestones` row's `content` column equals `C` byte-for-byte

#### Scenario: Anchor fields denormalize change attribution
- **WHEN** a milestone is created from `note_changes` row `cid` authored by `alice@example.com` at time `T`
- **THEN** the milestone row sets `anchorChangeId = cid`, `anchorAuthorEmail = 'alice@example.com'`, `anchorChangeCreatedAt = T`

#### Scenario: Duplicate name rejected per-path
- **WHEN** a user attempts to create a second milestone with `name = 'v1'` for a path that already has a milestone named `v1`
- **THEN** the system returns a `409 Conflict` and does not insert a row

#### Scenario: Same name allowed across different paths
- **WHEN** a user creates a milestone named `v1` for `notes/a.md` and another named `v1` for `notes/b.md`
- **THEN** both inserts succeed

### Requirement: Milestones are pruning-immune
The system SHALL preserve milestones independently of the `note_changes` retention policy. Pruning of `note_changes` SHALL NOT delete `note_milestones` rows. When the anchored `note_changes` row is pruned, the FK SHALL be set to `NULL` and the milestone's `content` SHALL remain queryable.

#### Scenario: Anchored change pruned, milestone survives
- **WHEN** a milestone's `anchorChangeId` references a `note_changes` row that is pruned by `pruneVersionHistory()`
- **THEN** the milestone row is preserved, `anchorChangeId` is set to `NULL`, and `content`, `anchorAuthorEmail`, `anchorChangeCreatedAt` remain populated

#### Scenario: Milestone listing after retention exceeded
- **WHEN** `listByPath(path)` is called for a path whose `note_changes` rows have all been pruned
- **THEN** the returned list contains every milestone ever created for that path, with `anchorChangeId = null` for milestones whose anchors were pruned

### Requirement: Create milestone from current content
The system SHALL provide an API to create a milestone from the file's current on-disk content.

#### Scenario: Create from current via API
- **WHEN** a client sends `POST /api/files/milestones` with `{ path, name }` and no `fromChangeId`
- **THEN** the system reads the current content of `path` from disk, captures the most recent `note_changes` row for that path (if any) as the anchor, and inserts a new `note_milestones` row with the disk content materialized into `content`

#### Scenario: Create from current with no prior history
- **WHEN** the file has zero `note_changes` rows (newly created file, history pruned)
- **THEN** the milestone is created successfully with all `anchor*` fields set to `NULL`

### Requirement: Create milestone from a historical change
The system SHALL provide an API to create a milestone from any reachable historical change, materializing the reconstructed content into the milestone row.

#### Scenario: Create from historical change
- **WHEN** a client sends `POST /api/files/milestones` with `{ path, name, fromChangeId: 42 }`
- **THEN** the system reconstructs content for change 42 via the existing `version-reconstruction` service, captures change 42's author and `createdAt` as the anchor fields, and inserts a milestone with the reconstructed content

#### Scenario: Reconstruction failure on create
- **WHEN** reconstruction for the supplied `fromChangeId` fails
- **THEN** the system returns `422 Unprocessable Entity` with the reconstruction error and does not insert a row

### Requirement: List milestones by path
The system SHALL provide an API to list all milestones for a given path, ordered most-recent first, excluding the `content` column.

#### Scenario: List milestones for a path
- **WHEN** a client sends `GET /api/files/milestones?path=notes/a.md`
- **THEN** the system returns a JSON array of milestone records ordered by `createdAt` DESC, each containing `id`, `path`, `name`, `description`, `createdBy`, `createdByEmail`, `createdAt`, `anchorChangeId`, `anchorChangeCreatedAt`, `anchorAuthorEmail` — and explicitly NOT including `content`

#### Scenario: Empty list for a path with no milestones
- **WHEN** the path has zero milestone rows
- **THEN** the API returns an empty array `[]`

### Requirement: Get milestone with content
The system SHALL provide an API to fetch a single milestone including its full `content`.

#### Scenario: Get milestone by id
- **WHEN** a client sends `GET /api/files/milestones/:id`
- **THEN** the system returns the milestone row including `content`

#### Scenario: Get unknown milestone
- **WHEN** the supplied `id` does not exist
- **THEN** the system returns `404 Not Found`

### Requirement: Restore from milestone
The system SHALL provide an API to restore a file's current content from a milestone. The restore SHALL apply the milestone's `content` through the existing OT write path, recording a new `note_changes` row identical in structure to a history-based restore. The restore SHALL NOT delete the milestone or any pre-existing history.

#### Scenario: Restore replaces current content via OT
- **WHEN** a client sends `POST /api/files/milestones/:id/restore`
- **THEN** the system writes the milestone's `content` to disk through the OT layer, records a new `note_changes` row with the diff, and returns `{ ok: true, newChangeId }`

#### Scenario: Milestone preserved after restore
- **WHEN** a milestone is restored
- **THEN** the milestone row is unchanged and remains listable via the list endpoint

#### Scenario: Restore from unknown milestone
- **WHEN** the supplied `id` does not exist
- **THEN** the system returns `404 Not Found`

#### Scenario: Restore visible in history timeline
- **WHEN** a milestone restore completes
- **THEN** the new `note_changes` row appears in the next call to `GET /api/files/history?path=…` with `action='modified'`

#### Scenario: Restore inherits restore-safety auto-snapshot
- **WHEN** a milestone restore is applied
- **THEN** the system auto-snapshots the pre-restore content (via the existing `restore-safety` mechanism) before applying the milestone content

#### Scenario: Restore is a no-op when content is identical
- **WHEN** the milestone's `content` is byte-identical to the file's current on-disk content and the user calls `POST /api/files/milestones/:id/restore`
- **THEN** no OT operation is issued, no new `note_changes` row is created, and the API returns `{ ok: true, newChangeId: null }`

### Requirement: Milestones excluded from search indexes
The system SHALL NOT include milestone `content` in the FTS5 full-text-search index or the semantic-search vector index. Search SHALL operate on current file content only.

#### Scenario: FTS row count unchanged by milestone creation
- **WHEN** a user creates 50 milestones across various files
- **THEN** the FTS5 row count for note content is unchanged from before the milestones were created

#### Scenario: Semantic-search vectors unchanged by milestone creation
- **WHEN** a user creates 50 milestones
- **THEN** the count of stored embedding vectors is unchanged from before the milestones were created

### Requirement: Delete milestone
The system SHALL provide an API to delete a milestone. Only the original `createdBy` user, or a user with admin privileges, SHALL be permitted to delete.

#### Scenario: Creator deletes their own milestone
- **WHEN** the user who created the milestone sends `DELETE /api/files/milestones/:id`
- **THEN** the row is hard-deleted and the API returns `{ ok: true }`

#### Scenario: Non-creator delete attempt
- **WHEN** a non-admin user who did not create the milestone sends `DELETE /api/files/milestones/:id`
- **THEN** the system returns `403 Forbidden` and the row is unchanged

#### Scenario: Admin deletes any milestone
- **WHEN** an admin user sends `DELETE /api/files/milestones/:id` for a milestone they did not create
- **THEN** the row is hard-deleted

### Requirement: Milestones follow file rename
When a file is renamed (detected by the chokidar correlation in `rename-tracking`), the rename-path service SHALL update `note_milestones.path` for every milestone of the old path so milestones move with the file. Folder renames SHALL propagate to descendant paths via prefix rewrite, identical to the existing behavior for `note_changes` and `starred_items`. The path update SHALL occur in the same transaction as the `note_changes` and `starred_items` updates.

#### Scenario: Rename moves milestones
- **WHEN** the file `notes/draft.md` is renamed to `notes/final.md` and has milestones `v1`, `v2`
- **THEN** after the rename completes, `listByPath('notes/final.md')` returns `v1` and `v2`, and `listByPath('notes/draft.md')` returns `[]`

#### Scenario: Folder rename propagates to milestones
- **WHEN** folder `projects/` is renamed to `archive/projects/` and milestones exist with paths like `projects/a.md` and `projects/sub/b.md`
- **THEN** those milestones are rewritten to `archive/projects/a.md` and `archive/projects/sub/b.md`

#### Scenario: Rename name collision auto-suffixes
- **WHEN** `notes/draft.md` is renamed to `notes/final.md`, the source has a milestone named `v1`, and the destination already has an orphaned milestone named `v1` (e.g., from a previously deleted file at `notes/final.md`)
- **THEN** the rename succeeds, the destination's pre-existing `v1` milestone is unchanged, and the source's milestone is renamed to `v1 (renamed)` (or `v1 (renamed 2)` if `v1 (renamed)` is also taken, etc.) at the new path. A warning is logged.

#### Scenario: Transactional consistency on rename
- **WHEN** the rename-path service fails partway through updating `note_changes` after already updating `note_milestones`
- **THEN** the transaction rolls back and `note_milestones.path` is left at the old value, matching the rolled-back `note_changes`

### Requirement: Edit milestone name and description
The system SHALL provide an API to update a milestone's `name` and/or `description`. The `content` and anchor fields SHALL NOT be modifiable. The endpoint SHALL be restricted to the milestone's `createdBy` user OR an admin.

#### Scenario: Creator updates name
- **WHEN** the user who created milestone `m1` sends `PATCH /api/files/milestones/:id` with `{ name: 'v1' }` (replacing previous `name: 'v1 '`)
- **THEN** the row's `name` is updated to `v1` and the API returns the updated milestone

#### Scenario: Creator updates description
- **WHEN** the creator sends `PATCH /api/files/milestones/:id` with `{ description: 'sent to Marc 2026-04-15' }`
- **THEN** the description is updated; the `name` and other fields are unchanged

#### Scenario: PATCH content is rejected
- **WHEN** any user sends `PATCH /api/files/milestones/:id` with a body that includes a `content` key
- **THEN** the system returns `400 Bad Request` with an error explaining that `content` is immutable, and no row is modified

#### Scenario: PATCH anchor fields is rejected
- **WHEN** a request includes any of `anchorChangeId`, `anchorChangeCreatedAt`, `anchorAuthorEmail`, `createdBy`, `createdAt`
- **THEN** the system returns `400 Bad Request` and no row is modified

#### Scenario: PATCH name conflict
- **WHEN** the creator attempts to PATCH `name` to a value that already exists on another milestone for the same path
- **THEN** the system returns `409 Conflict` and the row is unchanged

#### Scenario: Non-creator PATCH attempt
- **WHEN** a non-admin user who did not create the milestone sends `PATCH /api/files/milestones/:id`
- **THEN** the system returns `403 Forbidden` and the row is unchanged

### Requirement: Name normalization
The system SHALL trim leading and trailing whitespace from `name` on create and on PATCH. After trimming, an empty string SHALL be rejected as `400 Bad Request`. The trimmed value is what is persisted and what participates in the unique `(path, name)` constraint.

#### Scenario: Whitespace trimmed on create
- **WHEN** the user creates a milestone with `name = '  v1  '`
- **THEN** the persisted row has `name = 'v1'`

#### Scenario: Empty name rejected
- **WHEN** the user creates a milestone with `name = ''` or `name = '   '`
- **THEN** the system returns `400 Bad Request` and no row is created

#### Scenario: Trimmed names collide
- **WHEN** a milestone named `v1` already exists for a path and the user attempts to create `name = '  v1  '`
- **THEN** the system trims to `v1`, detects the duplicate, and returns `409 Conflict`

### Requirement: Visibility and authorization
The system SHALL enforce the following authorization model on milestone operations:
- **List, get, restore**: any user with read access to the file's path SHALL be permitted (same as the existing file/history read access).
- **Create**: any user with write access to the file's path SHALL be permitted.
- **Edit (PATCH), delete**: only the milestone's `createdBy` user OR a user with admin privileges SHALL be permitted.

#### Scenario: Other-user can list and restore
- **WHEN** user Bob (who did not create any milestone for `notes/a.md`) requests `GET /api/files/milestones?path=notes/a.md` and `POST /api/files/milestones/:id/restore`
- **AND** Bob has read+write access to `notes/a.md`
- **THEN** both requests succeed; Bob sees milestones created by other users and can restore them

#### Scenario: Other-user cannot edit
- **WHEN** Bob sends `PATCH /api/files/milestones/:id` for a milestone created by Alice, and Bob is not an admin
- **THEN** the request returns `403 Forbidden`

### Requirement: createdBy preserved on user deletion
When a User is deleted, milestones created by that user SHALL be preserved with `createdBy = NULL`. The milestone's other fields SHALL be unchanged.

#### Scenario: Creator's account deleted
- **WHEN** Alice creates a milestone and Alice's User row is later deleted
- **THEN** the milestone row remains, `createdBy` is set to `NULL`, and `content` / `name` / `createdAt` are unchanged

#### Scenario: Orphan milestone is still readable and restorable
- **WHEN** a milestone has `createdBy = NULL` and any user with file read access calls `GET /api/files/milestones/:id` or `POST /api/files/milestones/:id/restore`
- **THEN** the operation succeeds; the API response includes `createdBy: null` and `createdByEmail: null`

#### Scenario: Orphan milestone deletable by admin
- **WHEN** an admin sends `DELETE /api/files/milestones/:id` for a milestone with `createdBy = NULL`
- **THEN** the row is hard-deleted

### Requirement: Milestones survive file deletion
When a file is deleted, the system SHALL preserve `note_milestones` rows for that path. Milestone rows SHALL NOT be cascade-deleted with the file.

#### Scenario: File deletion preserves milestones
- **WHEN** the file `notes/draft.md` is deleted via any path (UI, API, MCP)
- **THEN** `note_milestones` rows for `path = 'notes/draft.md'` remain in the database and are still queryable via `getById`

#### Scenario: Editor panel hides orphaned milestones
- **WHEN** no file is open at a path that has milestone rows (because the file was deleted)
- **THEN** the editor's version history panel does not surface those milestones (no editor view of a non-existent file)

### Requirement: No on-disk milestone artifacts
The system SHALL NOT write any milestone-related content to the vault filesystem. Milestones SHALL exist exclusively in the database.

#### Scenario: Vault directory unchanged by milestone creation
- **WHEN** a user creates 10 milestones across 3 different files
- **THEN** the vault directory contains zero new files, zero new directories, and zero modifications to existing markdown files (no frontmatter additions, no sidecar files, no hidden folders)
