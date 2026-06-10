## Tasks

### 1. Admin scope & gating
- [x] Create `auth/admin.util.ts` with `isAdmin(email)` helper
- [x] Add `admin` to `ApiKeyScope` type in `permissions.ts`
- [x] Move `admin:*` permissions out of `rw`, into `admin` scope
- [x] Gate `admin` scope creation in `auth.controller.ts` (403 if not admin)
- [x] Add `ADMIN_EMAILS` to `.env.example` and docker-compose
- [x] Update frontend scope picker to show `admin` conditionally
- [x] Add startup warning log when `ADMIN_EMAILS` is unset
- [x] Tests: non-admin can't create admin key, admin can

### 2. Backup archive optimization
- [x] Strip `note_embeddings`, `notes_fts`, `comments_fts` from backup DB copy
- [x] `VACUUM` the stripped DB before tar
- [x] Verify self-healing: boot with stripped DB → embeddings/FTS rebuilt
- [x] Update backup test to assert derived tables are absent from archive

### 3. MCP backup/restore tools
- [x] Add `list_backups` MCP tool (always registered, admin-gated at invocation)
- [x] Add `create_backup` MCP tool (always registered, admin-gated at invocation)
- [x] Add `restore_backup` MCP tool with safety-net backup
- [x] Implement closest-backup-by-timestamp logic
- [x] Restore uses atomic rename swap for vault and DB (stage within `/data`, rename, rollback on failure)
- [x] `setTimeout(() => process.exit(0), 1000)` after returning MCP response
- [x] Add admin scope check helper for MCP tool handlers
- [x] Tests: restore flow, permission checks, non-admin rejection
