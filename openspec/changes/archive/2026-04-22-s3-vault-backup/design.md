## Context

Kalepin stores vault data in two locations: the filesystem (markdown notes, `.collab` sidecars, `_attachments/` images) under `VAULT_PATH`, and a SQLite database at `DB_PATH` (users, sessions, version history, snapshots, links). There is currently no off-site backup mechanism. The server runs as a single Docker container with mounted volumes.

The project uses NestJS with a modular architecture. There are no existing scheduled jobs — cleanup tasks (attachment orphan cleanup, version history pruning) are called manually. Environment variables are loaded via raw `process.env` access with inline defaults.

## Goals / Non-Goals

**Goals:**
- Compressed full-vault backup (notes, sidecars, attachments, SQLite DB) uploaded to S3
- Configurable schedule via cron expression
- Retention policy to auto-delete old backups from S3
- Manual trigger and listing via admin API
- Startup validation of S3 credentials when backup is enabled
- Feature is opt-in: disabled when S3 env vars are absent

**Non-Goals:**
- Incremental/differential backups (full archive each time — vault sizes are manageable)
- Point-in-time restore UI or CLI (restore is a manual process: download archive, extract)
- Backup encryption beyond S3 server-side encryption
- Multi-cloud storage support (S3-only; S3-compatible providers like MinIO work via endpoint override)
- Backup of the frontend build or application code

## Decisions

### 1. Archive format: `.tar.gz` via Node.js streams

**Choice:** Use Node.js built-in `zlib` + a tar library (`tar`) to create a compressed tarball.

**Rationale:** `tar` is already battle-tested, supports streaming (low memory footprint), and produces a universally understood format. No need for `child_process` calls to system `tar`.

**Alternatives considered:**
- ZIP via `archiver`: Larger output, no streaming advantage over tar.gz
- Raw file-by-file upload to S3: More complex, harder to restore atomically, higher API call cost

### 2. SQLite backup: `.backup` command via `better-sqlite3`

**Choice:** Use `better-sqlite3`'s `.backup()` API to create a consistent database copy before including it in the archive.

**Rationale:** `better-sqlite3` exposes the SQLite online backup API, which produces a consistent snapshot even while the DB is in use. Copying the raw file risks corruption from concurrent writes.

### 3. S3 upload: multipart via `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`

**Choice:** Use the AWS SDK v3 `Upload` class from `@aws-sdk/lib-storage` for streaming multipart upload.

**Rationale:** Streaming upload avoids buffering the entire archive in memory. The `Upload` class handles multipart chunking and retries automatically. SDK v3 is modular (tree-shakeable), keeping the Docker image lean.

### 4. Scheduling: `@nestjs/schedule` with `@Cron()` decorator

**Choice:** Add `@nestjs/schedule` and use a `@Cron()` decorator on the backup method.

**Rationale:** Standard NestJS approach. The cron expression is read from `S3_BACKUP_SCHEDULE` env var (default: daily at 03:00 UTC). This runs in-process — no external scheduler needed.

**Alternatives considered:**
- External Kubernetes CronJob: Overkill for single-container deployment
- `node-cron`: Works but `@nestjs/schedule` integrates better with NestJS lifecycle

### 5. Backup key format: `{prefix}/{date}/{timestamp}.tar.gz`

**Choice:** S3 key pattern: `{S3_BACKUP_PREFIX}/kalepin-backup-{ISO-timestamp}.tar.gz`

**Rationale:** Flat listing with lexicographic sort by timestamp makes retention pruning simple (list, sort, delete oldest). ISO timestamp ensures uniqueness and sortability.

### 6. Opt-in activation

**Choice:** Backup feature is completely disabled when `S3_BACKUP_BUCKET` is not set. When set, the remaining S3 vars are validated at startup.

**Rationale:** Zero impact on existing deployments. No breaking change. Users opt in by adding env vars.

### 7. Temp file for archive creation

**Choice:** Write the archive to a temp file (in `/tmp`) before streaming to S3, then delete it.

**Rationale:** Allows reporting archive size in logs and the API response. The temp file is cleaned up in a `finally` block. For typical vault sizes (< 1 GB), this is fast and avoids the complexity of pipe-to-S3 streaming with backpressure handling.

## Risks / Trade-offs

- **Disk space during backup** → The temp archive requires free disk space equal to the compressed vault + DB. Mitigation: document this requirement; `/tmp` on most Docker hosts is memory-backed or on the host FS with ample space.
- **Backup duration blocks cron slot** → A long-running backup could overlap the next scheduled run. Mitigation: use a mutex lock (in-memory flag) so only one backup runs at a time; skip if already in progress.
- **S3 credentials in env vars** → Standard practice for containerized apps. Mitigation: document use of Docker secrets or IAM roles as alternatives.
- **SQLite backup consistency** → `better-sqlite3` backup API handles this correctly, but the vault filesystem could change during archiving. Mitigation: acceptable for backup purposes — files are individually consistent, and version history in the DB provides recovery for any mid-write notes.
- **No restore automation** → Restore is manual (download, extract, replace files). Mitigation: document restore procedure. Automated restore is a future enhancement.
