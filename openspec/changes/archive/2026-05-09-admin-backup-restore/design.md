## Admin Gating

### `ADMIN_EMAILS` env var

```
ADMIN_EMAILS=alice@example.com,bob@example.com
```

Parsed once at startup, trimmed, lowercased. Empty or unset = no admins (no one can create admin keys).

**Startup warning**: If `ADMIN_EMAILS` is unset, log a warning at boot:
```
WARN [AuthModule] ADMIN_EMAILS is not set — no users can create admin-scoped API keys. 
Backup REST endpoints and MCP tools will be inaccessible.
```
This prevents silent breakage on upgrade when `rw` keys lose `admin:*` permissions.

### Permission model change

```typescript
// permissions.ts
export type ApiKeyScope = 'ro' | 'rc' | 'rw' | 'admin';

export const SCOPE_PERMISSIONS: Record<ApiKeyScope, readonly Permission[]> = {
  ro: RO_PERMISSIONS,
  rc: RC_PERMISSIONS,
  rw: PERMISSIONS.filter(p => !p.startsWith('admin:')),
  admin: [...PERMISSIONS],
};
```

### Key creation gate

```typescript
// auth.controller.ts — createApiKey
if (scope === 'admin') {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase());
  if (!adminEmails.includes(req.user.email.toLowerCase())) {
    throw new ForbiddenException('Only admins can create admin-scoped keys');
  }
}
```

### Admin check helper

Extract a reusable helper for use in both the controller and MCP tool registration:

```typescript
// auth/admin.util.ts
export function isAdmin(email: string): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase());
}
```

---

## Backup Archive Optimization

### Strip derived tables

In `backup.service.ts`, after `db.backup()` and before tar:

```typescript
const backupDb = new Database(dbBackupPath);
backupDb.exec('DROP TABLE IF EXISTS note_embeddings');
backupDb.exec('DROP TABLE IF EXISTS notes_fts');
backupDb.exec('DROP TABLE IF EXISTS comments_fts');
backupDb.exec('VACUUM');
backupDb.close();
```

### Self-healing on restore

No restore-side code needed. Existing flow:
1. `SearchService.onModuleInit()` → `createFTSTables()` + `createEmbeddingsTable()`
2. Detects `embCount === 0` → triggers `reindexAll()`
3. FTS + embeddings rebuilt from vault files

---

## MCP Backup/Restore Tools

### Tool registration & gating

Tools are registered once at startup on the shared `McpServer` instance (not per-session). Admin tools are **always visible** but **gated at invocation time** — the handler checks the session's API key scope and returns a clear error for non-admin callers.

```
register list_backups, create_backup, restore_backup (always)

On invocation:
  → resolve session → check API key scope
  → if scope !== 'admin': throw "This tool requires an admin-scoped API key"
  → else: proceed
```

This is simpler than per-session McpServer instances and gives good UX — non-admins see the tools exist but get a clear message when they try to use them, similar to a grayed-out button.

### Tool: `list_backups`

```
Input:  (none)
Output: Array of { key, size, lastModified, age }
```

Delegates to existing `BackupService.listBackups()`. Formats output for LLM readability (human-friendly dates, sizes in MB).

### Tool: `create_backup`

```
Input:  (none)
Output: { key, size, duration }
```

Delegates to existing `BackupService.runBackup()`.

### Tool: `restore_backup`

```
Input:  { key?: string, nearTimestamp?: string }
Output: { restoredFrom, safetyBackupKey, restoredAt }
```

Flow:
1. If `nearTimestamp` provided, call `listBackups()` and find closest match
2. Create safety-net backup via `runBackup()`
3. Download archive from S3 (`GetObjectCommand`)
4. Extract to temp directory
5. Stop file watcher (prevent change-tracking noise)
6. Replace vault directory contents
7. Replace SQLite DB file
8. Restart file watcher
9. App detects missing embeddings/FTS on next query → re-indexes

### Restore strategy: process restart

Restore writes the new DB and vault, then **exits the process**. The container orchestrator (Docker restart policy, systemd) restarts the app. On boot, SearchService detects missing embeddings/FTS and re-indexes automatically.

Why restart instead of live DB swap:
- TypeORM's `DataSource` is injected into every repository/service — no clean way to reconnect without stale references
- Restore is a rare operation (disaster recovery), not a hot path
- Restart guarantees clean state: no stale OT sessions, no orphan file watchers, no half-swapped DB

Flow:
1. Create safety-net backup
2. Download target archive from S3
3. Extract to staging dir **within `/data`** (same filesystem as vault + DB, so renames are atomic)
4. Atomic vault swap:
   ```
   rename /data/vault       → /data/vault.old
   rename /data/staging/vault → /data/vault
   rm -rf /data/vault.old
   ```
   If step 2 fails (staging vault missing/corrupt), `/data/vault` is untouched.
   If step 3 fails, roll back: `rename /data/vault.old → /data/vault`.
5. Atomic DB swap: `rename /data/staging/kalepin.sqlite → /data/db/kalepin.sqlite`
6. Return result to MCP client
7. Schedule exit after response flushes:
   ```typescript
   setTimeout(() => process.exit(0), 1000);
   ```
   The 1s delay ensures the MCP response is fully written to the transport before shutdown. Using `app.close()` would be cleaner but requires injecting the `NestApplication` instance — not worth the plumbing for a once-a-year operation.
8. Container orchestrator restarts the app
9. On boot: SearchService rebuilds embeddings/FTS from vault

The MCP client sees a disconnection after the result is returned. On reconnect, the app is running with restored state.

### In-flight sessions

Active OT/WebSocket sessions are terminated by the restart. This is acceptable:
- Admin made an explicit, destructive choice
- Clients reconnect automatically
- No data loss — the restored state is the intended state

---

## Sequence Diagram

```
Admin via MCP                    Backend                          S3
     │                              │                              │
     │  list_backups                │                              │
     │─────────────────────────────▶│  ListObjectsV2Command        │
     │                              │─────────────────────────────▶│
     │                              │◀─────────────────────────────│
     │  [28 backups listed]         │                              │
     │◀─────────────────────────────│                              │
     │                              │                              │
     │  restore_backup              │                              │
     │  { nearTimestamp: "..." }    │                              │
     │─────────────────────────────▶│                              │
     │                              │  1. Find closest backup      │
     │                              │  2. Safety-net backup         │
     │                              │─────────────────────────────▶│
     │                              │◀─────────────────────────────│
     │                              │  3. Download target archive   │
     │                              │─────────────────────────────▶│
     │                              │◀─────────────────────────────│
     │                              │  4. Extract + replace         │
     │                              │  5. Reconnect DB              │
     │                              │  6. Re-index (async)          │
     │  { restoredFrom, safety }    │                              │
     │◀─────────────────────────────│                              │
```
