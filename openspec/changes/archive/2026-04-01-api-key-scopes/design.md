## Context

API keys (`kp_<hex>`) currently grant unrestricted access — identical to the owning user's JWT session. The `CombinedAuthGuard` resolves the user from the key hash but attaches no scope metadata. Every controller guarded by `CombinedAuthGuard` (files, comments, stars, links, attachments, backups, MCP) is fully accessible with any valid key.

The codebase uses TypeORM with `synchronize: true` on SQLite, so schema changes via entity modifications are applied automatically on restart — no migration files needed.

## Goals / Non-Goals

**Goals:**
- Introduce 3 scope profiles for API keys: `ro`, `rc`, `rw`
- Enforce scope at the backend guard level (hard gate) so no HTTP client can bypass it
- Have the MCP server filter its registered tools based on key scope (soft gate) for better UX
- Backwards-compatible: existing keys become `rw`, no breakage

**Non-Goals:**
- Custom per-permission granularity (future work)
- Scope in the key prefix (DB is source of truth)
- Revoking or downgrading existing keys automatically
- Rate limiting per scope

## Decisions

### 1. Scope stored as a string enum column on `ApiKey` entity

The `scope` column stores one of `'ro' | 'rc' | 'rw'` with a default of `'rw'`. TypeORM `synchronize` adds the column automatically.

**Alternative considered**: Bitmask or join table for arbitrary permissions. Rejected — too complex for 3 profiles, and we want to keep the door open for custom permissions later without painting ourselves into a bitmask corner.

### 2. Permission map as a plain constant

A `SCOPE_PERMISSIONS` map in a shared file (e.g. `packages/backend/src/auth/permissions.ts`) maps each scope to its set of permission strings. The permission atoms are:

```
notes:read, notes:search, notes:create, notes:edit, notes:delete,
comments:read, comments:write,
links:read, stars:read, stars:write, updates:read,
attachments:read, attachments:write,
admin:backup, users:read
```

This map is the single source of truth for what each profile allows.

### 3. `@RequiredScope()` decorator on controller methods

A custom NestJS `SetMetadata` decorator marks each route with the permission it requires (e.g. `@RequiredScope('notes:edit')`). Routes without the decorator default to requiring no specific scope (any authenticated key works) — but we SHALL annotate all `CombinedAuthGuard` routes.

### 4. Guard enforcement in `CombinedAuthGuard`

After resolving the user from the API key, the guard reads the key's `scope` from the DB result, looks up the allowed permissions via `SCOPE_PERMISSIONS`, and checks against the route's `@RequiredScope` metadata. If the permission is not in the set, throw `ForbiddenException` (403).

JWT-authenticated requests (non-`kp_` tokens) bypass scope checks — they have full access as today.

**Alternative considered**: Separate guard for scope. Rejected — adding a second guard creates ordering issues and splits auth logic across two places.

### 5. `verifyApiKey` returns scope alongside user payload

Currently `verifyApiKey` returns `{ sub, email }`. It will now return `{ sub, email, scope }` so the guard has the scope without an extra DB query.

### 6. `/api/auth/api-keys/whoami` endpoint

A GET endpoint authenticated by `CombinedAuthGuard` that returns `{ scope, permissions[] }` for the current key. For JWT-authenticated requests, returns `{ scope: 'rw', permissions: [...all...] }`.

The MCP server calls this on startup to discover which tools to register.

### 7. MCP server tool filtering

On startup, the MCP server calls `/whoami`, receives the permissions list, and conditionally registers tools:

| Tool | Required permission |
|------|-------------------|
| `search_notes` | `notes:search` |
| `read_note` | `notes:read` |
| `list_files` | `notes:read` |
| `create_note` | `notes:create` |
| `edit_note` | `notes:edit` |
| `delete_note` | `notes:delete` |
| `list_comments` | `comments:read` |
| `add_comment` | `comments:write` |
| `get_updates` | `updates:read` |

Tools whose permission is not in the list are simply not registered — the MCP client never sees them.

### 8. Frontend scope picker

The create-key form adds a radio group for scope selection. The key list shows a scope badge next to each key name. The `createApiKey` API call sends `scope` in the request body.

## Risks / Trade-offs

- **[TypeORM synchronize adds nullable column]** → Existing rows get `NULL` for `scope`. The entity default (`'rw'`) only applies to new inserts via TypeORM. Mitigation: `verifyApiKey` treats `NULL` scope as `'rw'` explicitly.
- **[MCP server startup depends on /whoami]** → If the backend is unreachable at startup, the MCP server can't determine scope. Mitigation: fail startup with a clear error (same as current behavior when the key is invalid).
- **[Scope check adds a small overhead to every API-key-authenticated request]** → Negligible: it's an in-memory map lookup on data already loaded from DB.
