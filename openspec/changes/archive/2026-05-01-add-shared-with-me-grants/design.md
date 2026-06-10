# Design: per-file user-to-user grants

## Schema

```sql
CREATE TABLE document_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grantor_email TEXT NOT NULL,
  grantee_email TEXT NOT NULL,
  path TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','comment','write')),
  expires_at INTEGER,                   -- nullable = perpetual
  created_at INTEGER NOT NULL,
  revoked_at INTEGER                    -- nullable = active
);
CREATE INDEX idx_grants_grantee_active ON document_grants (grantee_email, revoked_at, expires_at);
CREATE INDEX idx_grants_path_active ON document_grants (path, revoked_at);
CREATE INDEX idx_grants_grantor ON document_grants (grantor_email, revoked_at);
```

Soft-delete via `revoked_at` preserves audit history. The grantee-active index supports the "shared with me" query in O(log n).

## Predicate update

```ts
// New unified resolver
type Visibility =
  | { kind: 'owner' }
  | { kind: 'grant'; permission: 'read' | 'comment' | 'write' }
  | { kind: 'public_share'; code: string }
  | { kind: 'denied' };

function visibilityFor(path: string, email: string, ctx?: { shareCode?: string }): Visibility {
  // 1. Personal-folder owner
  if (isPersonalRootSegment(path) || isUnderPersonalRoot(path)) {
    if (path.startsWith(personalRootFor(email))) return { kind: 'owner' };
    // Foreign personal — check grants
  }
  // 2. Shared vault
  if (!isUnderPersonalRoot(path)) {
    // Non-personal paths: ownership is implicit (everyone has read+write to vault/)
    return { kind: 'owner' };  // legacy semantic preserved
  }
  // 3. Active grant
  const grant = grantsService.findActive(path, email);
  if (grant) return { kind: 'grant', permission: grant.permission };
  // 4. Public share (resolved by code, not path-driven)
  if (ctx?.shareCode && shareLinks.resolves(ctx.shareCode, path)) {
    return { kind: 'public_share', code: ctx.shareCode };
  }
  return { kind: 'denied' };
}
```

`assertReadableBy` and `assertWritableBy` map the visibility kind + permission level to allow/deny:

```
assertReadableBy:
  owner          → allow
  grant.read     → allow
  grant.comment  → allow
  grant.write    → allow
  public_share   → allow
  denied         → throw NotFound

assertWritableBy:
  owner          → allow
  grant.write    → allow
  grant.read     → throw Forbidden
  grant.comment  → throw Forbidden
  public_share   → throw Forbidden
  denied         → throw NotFound
```

The "throws NotFound, never Forbidden, for personal paths the user can't see" rule established by the personal-folders capability is preserved: `denied` for foreign personal paths surfaces as 404.

## Comment permission

`comments.controller.ts:create` calls `assertCommentableBy(path, email)` which maps:
- owner → allow
- grant.comment / grant.write → allow
- grant.read → throw Forbidden
- denied → throw NotFound

## "Shared with me" sidebar section

```
┌──────────────────────────────┐
│  RECENTLY OPENED 8           │
│  PERSONAL                    │
│    📁 alice@x.com 🔒          │
│  SHARED WITH ME              │  ◄── new
│    📁 from bob@x.com         │
│      📄 q4-plan.md (read)    │
│    📁 from carol@x.com       │
│      📄 design.md (write)    │
│  VAULT                       │
│    📁 Demo                   │
└──────────────────────────────┘
```

Grouped by grantor for clarity. Permission badge on each row.

## Move/rename cascades

When `FilesService.move(src, dest)`:
- All active grants where `path = src` are updated to `path = dest`.
- All active grants where `path STARTSWITH src + '/'` are updated.
- Audit row added to a `grants_audit_log` table (deferred — log via the existing access-log if `add-access-metadata` is shipped).

When `FilesService.delete(path)`:
- All active grants on `path` and descendants are revoked (`revoked_at = now`).

## Bulk folder share UX

Dialog opened from a folder context-menu item "Share folder…":

```
┌─ Share "q4-plan/" with… ─────────────────────────────┐
│  Recipient: [bob@x.com______________]                │
│  Permission: ( ) read  ( ) comment  (•) write        │
│  Expires:    [ never ▾ ]                             │
│                                                      │
│  Files to share (12):                                │
│   ☑ q4-plan/objectives.md                            │
│   ☑ q4-plan/timeline.md                              │
│   ☑ q4-plan/risks.md                                 │
│   ☑ q4-plan/_attachments/diagram.png                 │
│   …                                                  │
│                                                      │
│  [Cancel]                          [Share 12 files]  │
└──────────────────────────────────────────────────────┘
```

On Apply, mints N grant rows in a single transaction.

## New-file-in-shared-folder prompt

When `FilesService.create(path)` succeeds and the path's parent folder has any active grants where the grantor is the current user:

```
Frontend toast: "q4-plan/new-idea.md is private.
                Also share with bob@x.com? [No] [Share read]"
```

Click "Share read" mints a single grant for the new file with the same permission as the most-common existing grant on the folder.

## Stage-2 interaction

Granting on a path where `isE2EEncrypted(path)` returns true is rejected at mint time:

```
POST /api/grants → 400 Bad Request:
  "Cannot grant on E2E-encrypted paths.
   Move the note out of _secure/ first, or wait for E2E sharing
   support (add-e2e-secure-subfolder)."
```

Stage 2 will revisit: per-user public keys for grant-share require a separate design pass.

## Tests

Truth-table tests across all combinations:

| Path zone | Grant kind | Action | Expected |
|---|---|---|---|
| Personal owner's own | n/a | read | allow |
| Personal foreign, no grant | n/a | read | 404 |
| Personal foreign, read grant | read | read | allow |
| Personal foreign, read grant | read | write | 403 |
| Personal foreign, write grant | write | write | allow |
| Personal foreign, write grant | write | comment | allow |
| Personal foreign, expired grant | expired | read | 404 |
| Personal foreign, revoked grant | revoked | read | 404 |
| Shared vault | n/a | read | allow |
| Shared vault | n/a | write | allow |
| E2E path, any grant | rejected at mint | read | 404 (mint failed) |

## Dependencies

- Independent of encryption changes. Grants apply to paths regardless of zone.
- Stronger UX with `add-access-metadata`: owner sees who actually opened the granted note.
- PIN protection (`add-per-note-pin`) layers cleanly: a granted note may also require a PIN.
