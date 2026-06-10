## Goals

1. **Per-user private namespace** at `_users/{email}/` (virtual) that is owner-only by construction, not by happy-path filtering alone.
2. **No leakage AT ALL** across HTTP, WebSocket, MCP, mention email, attachment URL, share-link mint, change feed, link/graph, or backup-zip surfaces. Verified by an exhaustive multi-user e2e safety net before the gates go live.
3. **DB-loss-tolerant identity**: the on-disk folder name is the email (the only stable identifier across DB rebuilds, since `id` is a fresh autoincrement after a recovery from vault-only state).
4. **Backups & admin export**: include all personal folders. Per-user `download-zip` includes only that user's personal subtree.
5. **Layout-B structural guarantee**: personal data lives at a separate physical root (`personal/`) so the bulk-export and shared-watcher code paths cannot include foreign personal data even if a filter has a bug.
6. **Cross-editor compatibility**: Obsidian and other editors pointed at `VAULT_PATH` see only the shared vault; `personal/` is a peer directory outside their scope.

## Non-Goals

- Anonymous-internet sharing of personal notes from inside the personal folder beyond the existing share-link feature (which remains, with a UI warn).
- Encryption-at-rest of personal content. Disk access still exposes everything; this change is about the API boundary, not storage encryption.
- Hard-delete on user removal. v1 uses soft-move to `personal/.deleted/`; admin restore is manual.
- Migration tooling for existing notes-into-personal-folders. New feature; users opt in by moving / creating notes there.
- Per-user vector / FTS partitions. The index remains global; the predicate enforces visibility at query emission time.

## On-disk and virtual layout

```
DATA_PATH/                                     virtual paths (codebase sees)
├── vault/      ← VAULT_PATH                   "" / "Notes/foo.md"
│   ├── _attachments/                          "_attachments/img.png"
│   ├── Notes/foo.md
│   └── (no `_users/` here — reserved)
└── personal/   ← PERSONAL_PATH (new)          "_users/alice@x/..."
    ├── alice@example.com/
    │   ├── _attachments/img.png               "_users/alice@example.com/_attachments/img.png"
    │   └── Diary.md                           "_users/alice@example.com/Diary.md"
    ├── bob@example.com/
    │   └── Scratch.md                         "_users/bob@example.com/Scratch.md"
    └── .deleted/
        └── carol@example.com-2026-04-30T…/
```

The virtual-path scheme `_users/{email}/...` is what the rest of the codebase (FTS keys, OT docIds, link-index, comments, share-links, change-tracking) uses unchanged. Only the storage adapter layer translates virtual → physical.

## RoutingStorageAdapter

Wraps two `LocalFSAdapter` instances:

```
class RoutingStorageAdapter implements StorageAdapter {
  constructor(
    private shared: LocalFSAdapter,    // VAULT_PATH
    private personal: LocalFSAdapter,  // PERSONAL_PATH
  ) {}

  private route(virtualPath: string): { adapter, physicalPath } {
    if (virtualPath.startsWith('_users/')) {
      // virtual: _users/alice@x/foo.md → physical (relative to PERSONAL_PATH): alice@x/foo.md
      return { adapter: this.personal, physicalPath: virtualPath.slice('_users/'.length) };
    }
    return { adapter: this.shared, physicalPath: virtualPath };
  }

  read(p)   { const { adapter, physicalPath } = this.route(p); return adapter.read(physicalPath); }
  write(p,c){ /* same shape */ }
  delete(p) { /* same shape */ }
  list(p)   {
    if (p === '' || p === '/') {
      // Combine the shared root listing with the requester's personal root only.
      // The list method here is owner-blind; callers pass the email separately and
      // the FilesController.tree handler unions the two listings.
      return this.shared.list(p);
    }
    if (p === '_users') return []; // nothing visible here without a user
    if (p.startsWith('_users/')) {
      const inner = p.slice('_users/'.length);
      return this.personal.list(inner).then(entries => entries.map(prefixWithUsersAnd(inner)));
    }
    return this.shared.list(p);
  }
  move(src, dest) { /* must reject crossing roots — see below */ }
  watch(cb) { /* shared watcher only — personal is per-user, see Watchers section */ }

  ensurePersonalFolder(email) { /* mkdir personal/{email} idempotent */ }
}
```

`move` MUST reject any pair where one end is under `_users/` and the other is not, or both ends are under different `_users/{X}` roots, or src is exactly `_users/{X}` (the root segment). The cross-namespace rejection is enforced both at the predicate layer (`assertWritableBy`) and at the adapter layer as defense-in-depth.

The `vault/_users` reservation is enforced by `FilesService.createDirectory` and `move(dest = "_users")` rejecting that exact target — `RoutingStorageAdapter` would route a path of `_users` to "personal root with empty inner key", which is meaningless.

## Email canonicalization and metacharacter safety

The email is the personal-folder identifier-of-record. It flows into SQL `LIKE` patterns, on-disk folder names, JS prefix compares, `Map` keys, and log strings. Any metacharacter that survives to a downstream site is a leak risk. The defense is **canonicalize once at the auth boundary, treat as trusted everywhere downstream**, plus per-class escaping where the medium has its own metacharacters.

### Canonical email

A single helper at the auth layer normalizes and validates. Every other call site treats `req.user.email` as already canonical and never re-validates.

```
// packages/backend/src/auth/email.ts
const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export function canonicalizeEmail(raw: string): string {
  const s = raw.normalize('NFC').trim().toLowerCase();
  if (s.length === 0)        throw new BadRequestException('email empty');
  if (s.length > 254)        throw new BadRequestException('email too long');   // RFC 5321 §4.5.3.1.3
  if (!EMAIL_RE.test(s))     throw new BadRequestException('email format');
  if (s.includes('..'))      throw new BadRequestException('email format');
  if (s.startsWith('.') || s.includes('.@')) throw new BadRequestException('email format');
  return s;
}
```

The regex is a strict subset of RFC 5322, deliberately: it rejects quoted local-parts (`"a@b"@x.com`), IDN/unicode local-parts, whitespace, and every filesystem-hostile or LIKE-hostile char that isn't `_` or `%` (those are RFC-legal and must be escape-handled at the SQL layer). OAuth and magic-link issuers in practice emit emails in this subset; closing it down is safer than handling every RFC edge case at every leaf site.

`canonicalizeEmail` runs at:
- `auth.service.ts` JWT issuance.
- `auth.service.ts` first-login / `ensurePersonalFolder` call.
- The MCP per-request `user` construction.

JWTs that arrive with a non-canonical email are normalized once at verification time. If normalization rejects, auth fails closed (`401`). The DB stores the canonical form. Soft-delete folder names use `-` in place of the ISO timestamp's `:` for Windows compatibility (`personal/.deleted/{email}-2026-04-30T14-30-00Z/`).

### LIKE-escape for the SQL predicate

Even after canonicalization, RFC-legal emails can contain `_` (e.g. `john_doe@x.com`) and `%` (e.g. `a%b@x.com`). In a SQL `LIKE` pattern these are wildcards: `LIKE '_users/john_doe@x.com/%'` matches `_users/johnxdoe@x.com/...` (a different user). Bind values are data, not code, so this is not classic SQL injection — it is **LIKE-pattern injection through a prepared parameter**, which most ORMs do not protect against.

The escape helper, used at every SQL site that concatenates the email into a `LIKE` pattern:

```
// packages/backend/src/auth/like-escape.ts
export function escapeLike(s: string): string {
  return s
    .replace(/\\/g, '\\\\')   // backslash FIRST or we double-escape
    .replace(/_/g, '\\_')
    .replace(/%/g, '\\%');
}
```

Bind the escaped value as the parameter; keep `ESCAPE '\'` in the SQL. Test that `john_doe@x.com` does not match `johnxdoe@x.com`'s rows.

**Sites that must use `escapeLike`:**

| Site | File / function | Pattern shape |
|---|---|---|
| `notes_fts` predicate | `SearchService.ftsSearch` | `path LIKE '\_users/' \|\| :email \|\| '/%' ESCAPE '\'` |
| `comments_fts` predicate | `SearchService.commentFtsSearch` | same |
| `getChangesSince` (if SQL-pushed later) | `ChangeTrackingService.getChangesSince` | same |
| `note_links` / `note_changes` LIKE filters (if added) | `LinkIndexService.getGraphData` | same |
| Any future LIKE on a path with embedded email | — | same |

Sites that **do NOT** need `escapeLike`:
- JS string compares (`startsWith`, `===`, `Map.get`) — after canonicalization the email contains no JS-special characters; literal compare is safe.
- Filesystem path concatenation — the canonical email rejects `/`, `\0`, `..`, control chars, so `path.join('personal', email, ...)` is safe.
- FTS5 `MATCH` expressions — the email is not concatenated into MATCH; the predicate runs as a regular SQL `WHERE path LIKE ...` outside the MATCH. (Confirmed by audit; locked in by a unit test that fails if MATCH ever sees the email.)

GLOB and regex must not be built from emails. If a future call site needs them, add a `escapeGlob` / `escapeRegExp` helper at that time; do not reuse `escapeLike`.

### Email metacharacter test vectors

Each row pins a class of attack. Bob is the requester; Alice is the target. The assertion: Bob receives `404` and Alice receives her content. Run against `canonicalizeEmail` (rejects), `escapeLike` (round-trips), and `isVisibleTo` (boundary).

| Alice's email (raw) | Bob's email | Class |
|---|---|---|
| `john_doe@x.com` | `johnxdoe@x.com` | LIKE `_` wildcard match |
| `a%b@x.com` | `axyzb@x.com` | LIKE `%` wildcard match |
| `a\b@x.com` | (rejected at canon) | LIKE escape char |
| `Alice@Example.COM` | `alice@example.com` | case folding race — must canonicalize to same identity |
| `alice@x.com` (NFC) | `alice@x.com` (NFD with combining) | Unicode normalization race |
| `  alice@x.com` | (rejected at canon) | Leading whitespace |
| `alice@x.com\0evil` | (rejected at canon) | Null-byte truncation |
| `../etc@x.com` | (rejected at canon) | Path traversal |
| `alice/bob@x.com` | (rejected at canon) | Path separator |
| `"a@b"@x.com` | (rejected at canon) | Quoted local-part |
| `alice@x.com\nINJECT` | (rejected at canon) | Log injection |
| `alice@x.com` repeated × 300 chars | (rejected at canon) | Length bomb |
| `` (empty) | (rejected at canon) | Empty → `_users/` matches all personal data |

Phase 1's helper unit-tests cover this matrix exhaustively. Phase 6's search tests cover the LIKE-escape rows end-to-end.

## The visibility predicate (single source of truth)

```
// packages/backend/src/auth/visibility.ts
const PERSONAL_PREFIX = '_users/';

export function personalRootFor(email: string): string {
  return PERSONAL_PREFIX + email.toLowerCase();
}

export function isUnderPersonalRoot(virtualPath: string): boolean {
  return virtualPath.startsWith(PERSONAL_PREFIX);
}

export function isVisibleTo(virtualPath: string, viewerEmail: string): boolean {
  if (!isUnderPersonalRoot(virtualPath)) return true;
  const root = personalRootFor(viewerEmail) + '/';
  return virtualPath === personalRootFor(viewerEmail) || virtualPath.startsWith(root);
}

export function assertReadableBy(virtualPath: string, viewerEmail: string): void {
  if (!isVisibleTo(virtualPath, viewerEmail)) throw new NotFoundException();
  // 404 always — never 403 — to avoid existence-leak via status code.
}

export function assertWritableBy(virtualPath: string, viewerEmail: string): void {
  if (!isVisibleTo(virtualPath, viewerEmail)) throw new NotFoundException();
}

export function isPersonalRootSegment(virtualPath: string): boolean {
  // exactly "_users/<email>" (no trailing slash, no children) — non-renamable, non-deletable
  if (!isUnderPersonalRoot(virtualPath)) return false;
  const tail = virtualPath.slice(PERSONAL_PREFIX.length);
  return tail.length > 0 && !tail.includes('/');
}
```

Two identical-behavior helpers (`assertReadableBy`, `assertWritableBy`) are kept distinct so that future writes-only restrictions (e.g. read-only personal areas) can be added without changing call sites.

## End-to-end leak-classes and their mitigations

| Class | Surface | Mitigation |
|---|---|---|
| Direct content read | `/api/files/read`, `/api/files/headings`, `/api/files/history`, `/api/files/version`, `/api/files/restore`, `/api/comments?path=` | `assertReadableBy(path, email)` at controller boundary |
| Direct write/delete/move | `/api/files/{create,delete,directory,move}`, `/api/vault/items` | `assertWritableBy` per supplied path; `move` checks both ends; reject root-segment rename/delete |
| Tree listing | `GET /api/files/tree` | post-filter to drop foreign `_users/{X}` subtrees; the requester's own personal subtree is unioned in |
| Bulk download | `GET /api/files/download-zip` | layout B: archive `vault/` plus owner's `personal/{email}/` only; foreign data is structurally absent |
| Search FTS | `GET /api/files/search`, comments FTS via search | SQL predicate on every query |
| Vector search | semantic search inside `SearchService` | skip-if-not-visible in cosine loop |
| Backlinks | `GET /api/links/backlinks` | filter results so foreign `sourcePath` are dropped (target visibility is upstream-gated) |
| Outgoing links | `GET /api/links/outgoing` | filter `targetPath`s in result so foreign personal targets are dropped |
| Unlinked mentions | `GET /api/links/unlinked-mentions` | inner FTS query gets the predicate; result list filtered |
| Graph | `GET /api/links/graph` | `note_changes`/`note_links` reads filter all paths through predicate; graph nodes/edges only include visible paths |
| Updates feed | `GET /api/updates`, `/recently-edited` | `getChangesSince` and `getRecentlyEdited` filter rows by predicate |
| MCP | every tool: `search_notes`, `list_files`, `read_note`, `read_note_preview`, `read_attachment`, `create_note`, `edit_note`, `patch_note`, `append_to_note`, `delete_note`, `get_updates`, `mcp_stats` | thread `user.email` into every leaf call; `wrapTool` enforces it via `assertVisibilityFor` registration check |
| WebSocket `doc:open` | OT session join | reject docId not visible to the connecting user; close with 1008 |
| WebSocket `file:tree-update` | `broadcastToAll` event on watcher add/unlink/addDir/unlinkDir | replace with `broadcastToVisible(event)`; per-recipient predicate |
| WebSocket `presence:*` | scoped to doc clients only — already gated upstream by doc:open | no extra change |
| File watcher | shared chokidar covers everything today | split: shared watcher on `vault/`, per-user watcher on `personal/{email}/` started at first WS connect for that email |
| Attachments | shared `_attachments/`, name-only access | per-namespace `_attachments/`; upload infers namespace from `docPath`; serve resolves namespace + checks `assertReadableBy` on the synthetic virtual path |
| Share-link mint | `POST /api/share-links` | `assertReadableBy(body.path, req.user.email)` before insert |
| Share-link resolve | `GET /share/:code` | unchanged — token IS the permission; UI warns owner at mint time |
| Mention notifications | `notifyMention`, `notifyDocMention`, `notifyThreadReply` (email out-of-band) | suppress when `notePath` is under `_users/{X}` and recipient ≠ X; surface inline UI warning at the editor |

## The "no leakage AT ALL" safety net

The change is gated by a Playwright e2e suite that runs *before* any production gate is enabled, in fail-closed mode (the suite must pass for CI to merge).

### Token-scan property

Alice creates a personal note with **four unique tokens** placed in distinct locations:
- `PATHTOK-{rand}` is part of the filename: `_users/alice@example.com/PATHTOK-abc.md`.
- `BODYTOK-{rand}` is in the body content of that note.
- `ATTACHTOK-{rand}` is the filename of an attachment uploaded against that note.
- `COMMENTTOK-{rand}` is the body of a comment on that note.

Then, as Bob:

1. Call **every authenticated HTTP route** with realistic params (the suite enumerates them from the Nest router metadata at test boot to avoid drift).
2. Open a **WebSocket connection**, send `doc:open` for every kind of docId reachable to Bob, and observe all server-pushed events for 30 seconds while Alice creates / edits / moves / deletes / comments.
3. Run **every MCP tool** with realistic params.
4. Trigger a `download-zip` and recursively scan its tar contents.

For each response, event payload, log line attributable to Bob's request id, and tar entry — recursively serialize and assert **none of the four tokens, nor `_users/alice@example.com`, appears anywhere**. Repeat the symmetric Alice-as-non-owner-of-Bob-data test.

Routes to enumerate are obtained programmatically from `app.getHttpAdapter().getInstance()._router.stack` (Express) and from the MCP tool registration list, so adding a new route or tool that doesn't gate visibility is caught structurally.

### Negative existence test

Bob calls `/api/files/read?path=_users/alice@example.com/PATHTOK-abc.md`. Expected: `404 Not Found`, identical body and headers to a request for a path that genuinely does not exist on either root. The test fixture asserts byte-equality of the response with a known-nonexistent path probe.

### Mention-leak test

Alice writes a comment in her personal note that mentions Bob. The notification dispatcher MUST NOT call `transporter.sendMail`. The test wires a spy on `notifyMention` / `notifyDocMention` / `notifyThreadReply` and asserts zero invocations targeting Bob.

### Share-link mint test

Bob calls `POST /api/share-links` with `{ path: '_users/alice@example.com/PATHTOK-abc.md' }`. Expected: `404 Not Found`, no row inserted in `short_links`. Test asserts the absence of the row by direct DB query.

### Watcher-broadcast test

Two WS clients (Alice + Bob, both connected). Alice creates `_users/alice@example.com/NEW.md`. Bob's WS receives no `file:tree-update` event. Bob's WS DOES still receive `file:tree-update` for shared-vault changes.

### Backup symmetry test

Run a full S3 backup → wipe local roots → restore. Assert both `vault/` and `personal/` are bit-identical to pre-backup state. Run the leak-token property suite again post-restore.

## Watchers

Today `chokidar` watches the entire vault and `OTGateway.broadcastToAll` fans tree updates to every connected client. Layout B forces a split:

- **Shared watcher**: scoped to `VAULT_PATH`, fires `file:tree-update` to every connected client (no leak — shared paths are visible to all).
- **Per-user watchers**: each `personal/{email}/` is watched lazily — started on the first WebSocket connection for `email`, stopped when the last connection closes. Events from the personal watcher fan out only to WS clients with that email.

`OTGateway` keeps a `Map<email, Set<WebSocket>>` from connected client → email. Personal watcher → `personalEvent → forEach ws in clientsByEmail.get(email): ws.send(...)`.

## Attachments

The single shared `_attachments/` directory becomes per-namespace:

```
vault/_attachments/<name>             ← all shared notes' attachments
personal/{email}/_attachments/<name>  ← that user's attachments
```

Upload: `AttachmentsService.upload(file, docPath, userEmail)` examines `docPath`; if it starts with `_users/{userEmail}/`, the file lands in `personal/{userEmail}/_attachments/{name}`. Otherwise in `vault/_attachments/{name}`.

### Serve URL — backward-compatible doc-context hint

Every existing markdown note in production embeds attachment URLs of the shape `/api/files/attachment?name=X` (no namespace). Making `namespace` a required parameter would 404 every legacy embed on day 0. Instead the new endpoint accepts an **optional** `doc` hint:

```
GET /api/files/attachment?name=X              ← legacy shape, resolves to shared
GET /api/files/attachment?name=X&doc=<path>   ← new shape, namespace derived from doc
```

Resolution:

1. If `doc` is absent → serve from `vault/_attachments/X`. This preserves the legacy contract bit-for-bit; every existing embed keeps working.
2. If `doc` is present → run `assertReadableBy(doc, req.user.email)` first (404 if the doc is not visible to the requester, including foreign personal docs). Then derive the namespace from the doc's prefix:
   - `doc` starts with `_users/{requester-email}/` → serve from `personal/{requester-email}/_attachments/X`.
   - otherwise → serve from `vault/_attachments/X`.

The requester's email is taken from `req.user`, never from the query string. A foreign personal attachment is unreachable because:
- Without `doc`, the resolver only ever serves from shared.
- With a crafted `doc=_users/{victim}/...`, `assertReadableBy` returns 404 before the file is touched.
- With `doc=_users/{requester}/...`, the file resolves only inside the requester's own namespace, where the foreign file does not exist.

The frontend renders the attachment URL with the doc context it already knows:

- Inside a shared note → emit `?name=X` (legacy shape; same as today).
- Inside a personal note → emit `?name=X&doc=<encoded current doc path>`.

Because the namespace is *not* in the URL as a separately-asserted token, the URL never carries a contradiction the server has to detect — there is one source of truth for namespace, namely the doc's prefix.

### Move across the personal/shared boundary relocates attachments

When a note moves from shared to personal (or back), its `_attachments/` references are relative paths inside the doc's directory; the embedded URLs do not change. But the physical attachment file is in the source namespace's `_attachments/`. Without relocation:

- After a shared→personal promote, the doc renders `?name=X&doc=_users/me/...`, the BE resolves namespace=personal, looks for `personal/me/_attachments/X`, fails. Broken render.
- After a personal→shared demote, the doc renders `?name=X` (legacy), the BE resolves shared, looks for `vault/_attachments/X`, fails. Broken render.

`FilesService.move`, when crossing the boundary, copies every referenced attachment from the source namespace's `_attachments/` to the destination namespace's `_attachments/`. v1 does NOT delete the source-side copy — leftover orphans are reaped by the existing `attachment-cleanup` capability on its next sweep, which is now namespace-aware (walks both shared and per-user attachment dirs).

### Backward-compatibility audit

| Surface | URL today | After change | Breakage |
|---|---|---|---|
| Embedded attachments in legacy markdown notes | `?name=X` | unchanged in stored content; BE serves from shared | none |
| Mobile / cached PWA clients | `?name=X` | BE accepts | none |
| Backups containing notes with embedded URLs | `?name=X` | BE serves from shared on restore | none |
| Public share-link rendering of shared notes | `?name=X` | BE serves from shared | none |
| New attachments uploaded inside personal notes | (didn't exist) | FE renders `?name=X&doc=_users/...` | n/a |
| Promote/demote a note that has attachments | (didn't exist) | move relocates the file; render works | requires the move-time copy step |
| Attachment-cleanup orphan walker | walks `vault/_attachments/` | walks both roots' `_attachments/` | additive |

## Mention-notification policy

Today `notifyMention`, `notifyDocMention`, `notifyThreadReply` send emails containing the note title and the comment / reply body to mentioned users (`packages/backend/src/comments/notification.service.ts`). When the source path is under `_users/{X}/`, an email to anyone other than `X` is an out-of-band content leak — the recipient gets the title and quoted text without any visibility check.

Policy: when `notePath` is under `_users/{X}/`, the dispatcher MUST suppress notifications to recipients other than `X`. The suppression is logged at INFO with the suppressed recipient and source path. The frontend, at comment-creation time inside a personal note, surfaces an inline warning: "Mentions inside your personal folder do not send notifications."

This is stricter than "filter the email body" because it removes the side-channel entirely. Future work could relax this with explicit user consent ("share this comment with @bob"), but v1 is closed-by-default.

## Move semantics across the boundary

`POST /api/files/move` with `{src, dest}`:

- If `src === '_users/{me}'` exactly → `400 Bad Request` ("Personal folder cannot be renamed").
- If `src` is under any `_users/{!me}/` → `404 Not Found` (existence is not observable).
- If `dest` is under any `_users/{!me}/` → `404 Not Found`.
- If `src` is shared and `dest` is under `_users/{me}/...` → ALLOWED (promote a shared note to personal). All link-index, FTS, vector, comments, share-links rows follow the new path via existing rename-tracking.
- If `src` is under `_users/{me}/...` and `dest` is shared → ALLOWED (demote a personal note to shared). Same.
- If both ends are under `_users/{me}/...` → ALLOWED (rename within personal).
- If `dest` is `_users` exactly or `_users/{X}` exactly → `400 Bad Request`.

The link-rewriting on rename (`linkIndex.rewriteLinksOnRename`) already runs at `FilesService.move` boundaries; no additional changes there. But: rewriting links from a shared note that pointed into a soon-to-be-renamed personal note (or vice-versa) is fine since the rewrite is path-keyed and cares only about path equality.

## Soft-delete on user removal

When a `User` row is deleted (today: cascading deletes don't touch the personal folder because there's no relation):

```
mv personal/alice@example.com  personal/.deleted/alice@example.com-{ISO timestamp}
```

`personal/.deleted/` is invisible to `RoutingStorageAdapter` routing — paths starting with `_users/.deleted/...` are rejected as out-of-domain (no real user has email `.deleted`). Admin recovery is a manual `mv` for v1; a future change can add an admin restore endpoint.

If the same email re-registers later, the existing `.deleted/{email}-{ts}` is preserved; a fresh `personal/{email}/` is created on first login. No automatic merge.

**Implementation status**: shipped as the utility method `RoutingStorageAdapter.softDeletePersonalFolder(email)`. No user-deletion UI or admin endpoint exists today, so the call site is **TODO**: when an admin user-deletion flow is added (UI or CLI), wire it to call this method *before* removing the User row from the DB. Until then, ops can invoke it via direct service access or a future admin route gated by the `admin:backup` scope.

## Frontend tree

`FileTree.tsx` (or the equivalent renderer) gets a top-of-tree pseudo-section "Personal" — visually distinct from shared root nodes — populated from `tree` filtered to the requester's `_users/{email}/...` subtree. The root node:

- Hides Rename, Delete, Move-to-trash actions.
- Hides drag-handle on the root segment (children remain draggable).
- Carries a lock-icon affordance with the tooltip "Only you can see this folder".

A drop target check rejects drops onto another `_users/X/` root client-side (the backend rejects too, defense-in-depth).

## Migration and rollout

- Day 0: ship behind no flag (additive). On boot, `RoutingStorageAdapter.ensurePersonalFolder(email)` is called lazily on first authenticated request; no upfront migration of existing users' folders since no personal folder existed before.
- Day 0 deploy step (operations): create `PERSONAL_PATH` directory with the same ownership/permissions as `VAULT_PATH`. Document in README.
- The leak-token e2e suite gates merge — fails closed.
- Rollback: revert removes the new endpoints, the `RoutingStorageAdapter`, and switches `FilesService` back to the shared adapter. `personal/` remains on disk untouched; users lose access to it through the API but no data is destroyed.

## Risks

- **Frontend cache invalidation on personal-folder events**: if the per-user watcher's `file:tree-update` arrives before the WS auth identifies the user, events could be dropped. Mitigation: the per-user watcher is started AFTER the first WS auth completes; events emitted before that are not generated for that connection.
- **Email change**: if a user's email changes (no UI today), the on-disk folder name diverges from the new email. Either: (a) forbid email changes while a personal folder exists, (b) on rename, move `personal/{old}/` → `personal/{new}/` and rewrite all `note_links`, `note_changes`, `comments`, `short_links`, `note_embeddings`, `notes_fts` paths via prefix rewrite (same logic the file-rename path already does, just at a different prefix). v1 picks (a): forbid until we ship a maintenance flow.
- **Case-sensitivity collisions**: emails are case-insensitive (RFC 5321 §2.4 for the local part is technically case-sensitive but in practice never relied on). We lowercase on write and on lookup; the on-disk folder name is always lowercase. Edge case: a filesystem that's case-insensitive (macOS HFS+, Windows) would equate `Alice@x` and `alice@x` anyway; on case-sensitive filesystems (Linux ext4) we never write the mixed-case form.
- **`_users/` folder accidentally created in shared vault by raw FS access**: layout B prevents this from being routed into the personal namespace (`_users/` doesn't exist physically in `vault/`), but the file-watcher would see it as a regular shared folder. We add a startup check that warns + refuses to start if `vault/_users/` exists on disk.
- **Vector cache memory growth across users**: the global vector cache contains every user's personal chunks. For a small team (~10 users) this is identical to today's footprint; for larger deployments the same scaling concern applies as documented in `semantic-search`. Out of scope for this change.

## Phase 4 leak-token harness (implementation notes)

Lives at `packages/e2e/tests/leak-tokens.spec.ts`. Plant happens once per run:

- `PATHTOK-{rand}` becomes the filename of `_users/alice@example.com/PATHTOK-{rand}.md`.
- `BODYTOK-{rand}` is in the body of that note.
- `ATTACHTOK-{rand}.png` is uploaded against the note (lands in `personal/alice@example.com/_attachments/`).
- `COMMENTTOK-{rand}` is the body of a comment on that note.

The literal `_users/alice@example.com` is also a banned string — a response that surfaces the existence of Alice's namespace without exposing tokenized content is still a leak.

### Route discovery

The backend exposes a test-only controller at `api/__test/routes` (loaded only when `EXPOSE_TEST_ENDPOINTS=1`). The handler walks Express's router stack via `httpAdapter.getInstance()._router.stack`, recursing into mounted sub-routers, and returns every `(method, path)` tuple. It also returns the static `McpService.getRegisteredTools()` list. The harness asserts the discovered list includes a sentinel from each controller (`/api/files/tree`, `/api/comments`, `/api/share-links`, `/api/links/`, `/api/updates`, `/api/search`, plus a non-empty MCP-tool list); a new controller mounted without a route the test recognises fails the suite immediately rather than silently going unscanned.

### The token-scan invariant

For each surface, the harness recursively walks the response (object keys + values), the headers map, and any embedded byte-streams (download-zip entries' filenames + contents) and asserts none of `BANNED = [PATHTOK, BODYTOK, ATTACHTOK, COMMENTTOK, '_users/alice@example.com']` appears anywhere. The assertion message lists each violation as `METHOD path @ trail contains "TOKEN"` so failures point directly at the offending field.

### Adding a new HTTP route, MCP tool, or WS event

1. **HTTP**: add the controller; no test change needed for property coverage. If the route accepts a `path` parameter and is not already covered by a fixture key in `fixturesForPath`, add an entry that supplies `ALICE_NOTE` (foreign personal) so Bob's call exercises the visibility gate.
2. **MCP**: add the tool name to `McpService.REGISTERED_TOOLS` (the existing `mcp.tool-registration.test.ts` will fail loudly if you forget). Add a fixtures entry under `fixturesForTool` if the tool takes a path.
3. **WS event**: extend the `4.5 + 4.11` test's collected-events filter — the property is "no event payload Bob receives mentions Alice's personal-root path" — usually no test change needed.

### Test-only counters in NotificationService

`bumpEmitted` / `bumpSuppressed` mutate counters only when `EXPOSE_TEST_ENDPOINTS=1`. They run on the actual emission path (after the `isCrossPersonalMention` early-return) and on the suppression path respectively, so the e2e assertion `emittedTo[bob] === 0 && suppressedTo[bob] >= 1` proves both that the dispatcher saw the mention and that no email was dispatched.

### Why this is a Playwright file (and not a backend integration test)

Several of the sub-checks need a fully-wired stack: the WS gateway, the file watcher, the OAuth/CombinedAuth guard chain, and the SQLite DB on disk. Playwright's `webServer` block boots the backend in the same way production does and the test process talks to it over HTTP/WS — exactly the surface attackers see. Backend integration tests cover the predicates in isolation; this file is the *system-level* property assertion.

## Test plan summary

1. **Unit**: `isVisibleTo`, `assertReadableBy`, `assertWritableBy`, `isPersonalRootSegment`, `RoutingStorageAdapter` routing edges, attachment namespace inference.
2. **Integration**: every controller's owner / non-owner / cross-owner code path; every MCP tool's owner / non-owner code path; `getChangesSince` + `getRecentlyEdited` row filtering; mention notification suppression spy.
3. **Property/e2e**: the four-token recursive-scan suite; existence-byte-equality; share-link mint negative; watcher fanout negative; backup symmetry round-trip.
4. **Manual QA**: tree UI, drag/drop into and out of personal folder, lock icon, share-link UX warn, MCP via Claude Desktop with two users.
