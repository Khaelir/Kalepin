## Why

Backups exist (daily S3 cron, manual trigger via REST) but there's no way to **restore** from them, no way to browse available backups conversationally, and no admin gating — any `rw` key gets `admin:backup` for free. Meanwhile, the backup archive carries ~30 MB of regenerable embeddings and FTS indexes that compress poorly, inflating S3 costs for no reason.

This change adds:
1. An **admin scope** gated by `ADMIN_EMAILS` env var, so only designated users can create keys with admin privileges
2. **MCP backup/restore tools** so an admin can manage backups conversationally ("list backups", "restore from yesterday")
3. **Leaner archives** by stripping derived data (embeddings, FTS) before archiving

## What Changes

### Admin scope (`admin`)

- New `admin` scope added alongside `ro | rc | rw` (extends `api-key-scopes` change)
- `rw` scope **loses** `admin:*` permissions — clean separation of user vs admin capabilities
- Only users whose email is in `ADMIN_EMAILS` env var can create `admin`-scoped keys
- `POST /api/auth/api-keys { scope: 'admin' }` returns 403 if caller is not an admin
- Frontend scope picker shows `admin` option only when the logged-in user is an admin

### MCP backup/restore tools (admin-only)

Three new MCP tools, registered only for `admin`-scoped sessions:

| Tool | Description |
|------|-------------|
| `list_backups` | List available S3 backups with dates and sizes |
| `create_backup` | Trigger an on-demand backup, return key/size/duration |
| `restore_backup` | Download and restore a specific backup (vault + DB) |

`restore_backup` behavior:
- Accepts a backup key or a target timestamp (finds closest backup)
- Creates an automatic pre-restore backup ("safety net")
- Extracts vault and DB from archive, replaces current state
- App self-heals: SearchService detects missing embeddings/FTS on next boot and re-indexes
- Returns summary of what was restored and the safety-net backup key

### Leaner backup archives

Between `db.backup()` and tar creation, strip regenerable tables from the backup copy:
- `DROP TABLE IF EXISTS note_embeddings`
- `DROP TABLE IF EXISTS notes_fts`
- `DROP TABLE IF EXISTS comments_fts`
- `VACUUM` to reclaim disk space

No restore-side logic needed — the app already creates these tables on boot and re-indexes when they're empty.

**Size impact** (estimated at 500 notes):
- Before: ~8 MB per archive (embeddings dominate, compress poorly)
- After: ~200 KB per archive (text-only DB compresses 90%+)
- 30-day retention: ~9 GB → ~6 MB of S3 storage

## Capabilities

### New Capabilities
- `admin-scope`: Admin API key scope gated by `ADMIN_EMAILS` env var
- `mcp-backup-tools`: MCP tools for listing, creating, and restoring backups (admin-only)

### Modified Capabilities
- `api-key-scopes`: Add `admin` to scope enum; `rw` no longer includes `admin:*` permissions
- `s3-vault-backup`: Strip derived tables before archiving; add restore functionality

## Impact

- **Backend**: `permissions.ts` (new scope + permission split), `auth.controller.ts` (admin gate on key creation), `backup.service.ts` (strip tables + restore logic), `mcp.service.ts` (new tools)
- **Frontend**: Scope picker shows `admin` conditionally based on user role
- **Config**: New `ADMIN_EMAILS` env var
- **Breaking**: Existing `rw` keys lose `admin:backup` permission. Intentional — principle of least privilege.

## Non-goals

- User roles stored in DB (env var is sufficient for ~20 users)
- Selective file restore ("restore just this one note") — full restore only for now
- Backup diffing or incremental backups
