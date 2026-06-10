## Why

Backup and restore currently only exist as MCP tools and S3 REST endpoints — there's no way for an admin to download a backup archive or restore from one through the web UI. This change adds a frontend admin section in Settings with download/upload archive flows that work independently of S3.

## What Changes

- New `GET /api/admin/backup/download` endpoint that creates a light `.tar.gz` archive (vault + DB stripped of embeddings/FTS) and streams it as a file download
- New `POST /api/admin/backup/restore` endpoint that accepts a `.tar.gz` upload, validates its structure (must contain `vault/` and `kalepin.sqlite`), performs an atomic vault + DB swap, then restarts the app
- New `restoreFromArchive(filePath)` method on `BackupService` that reuses the atomic swap logic from `restoreFromS3` but operates on a local file
- New "Backup & Restore" admin-only section in the frontend Settings page with:
  - Download button (shows loading state while archive is created)
  - File picker + Restore button with double confirmation
  - Post-restore overlay that polls `GET /api/health` and auto-reloads when the server comes back
- No safety-net backup before restore
- No upload size limit
- No S3 listing or S3-based restore in the UI

## Capabilities

### New Capabilities
- `admin-backup-download`: Stream a light backup archive to the browser via REST
- `admin-backup-upload-restore`: Upload a `.tar.gz` archive and restore vault + DB via REST
- `admin-backup-settings-ui`: Admin-only backup & restore section in the frontend Settings page

### Modified Capabilities

(none)

## Impact

- **Backend**: `backup.controller.ts` (2 new endpoints), `backup.service.ts` (new `restoreFromArchive` method), multer config for multipart upload
- **Frontend**: `SettingsPage.tsx` (new admin section), `api.ts` (new download + restore API functions)
- **No new env vars** — works independently of S3 configuration
- **No breaking changes** — additive only
