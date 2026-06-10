# Design — stable, opaque internal doc handles

## Goal

Decouple two URLs that today's codebase conflates:

| URL | Audience | Lifetime |
|---|---|---|
| `/s/<code>` (recipient) | external, anonymous-or-authed | until revoked / re-minted |
| `/doc/<id>` (internal) | authed users with read access | as long as the file exists |

The recipient URL is *disposable by design*. The internal URL must be *durable* (not break on share-link state changes, rename, or move) and *opaque* (not leak path or personal-folder email).

## Token shape

- 16-char base32 (`A-Z2-7`, no `0/O`, `1/I/L`). Crypto-random. Collision-checked on insert.
- Distinguishable from a path: pure `[A-Z2-7]{16}` with no `/`, no `.`. The frontend parser regex is `^[A-Z2-7]{16}$` for the segment after `/doc/`. Anything else falls through to the legacy `/doc/<path>` arm.
- Not user-typable, but URL-safe and copy-paste friendly.
- 16 chars × 5 bits = 80 bits of entropy — vastly enough for any vault size.

## Data model

```sql
CREATE TABLE doc_handles (
  id           VARCHAR(16) PRIMARY KEY,
  path         TEXT UNIQUE NOT NULL,    -- NULL only for tombstones (see below)
  created_at   INTEGER NOT NULL,
  tombstone_at INTEGER NULL              -- set on file delete; row preserved
);
CREATE INDEX idx_doc_handles_path ON doc_handles(path);
```

When a file is deleted, `tombstone_at` is set and `path` is cleared (or kept for audit — see open question 1). The row stays so a stale URL says "this note no longer exists" instead of 404.

## Lazy mint

Handles are minted on observation, not eagerly:

| Trigger | Action |
|---|---|
| File create via API | `findOrCreateForPath` returns new ID |
| First read of an unknown path | `findOrCreateForPath` |
| chokidar `add` for a file with no handle | mint |
| chokidar `unlink` | `tombstone(id)` |
| chokidar rename pair (correlator) | `updatePath(id, newPath)` |
| File rename/move via API | `updatePath` (transactional with the rename) |

Initial scan on boot is `ignoreInitial: true` today; we don't backfill at boot. Backfill is amortized across normal use.

## Resolve flow

```
GET /api/files/read?handle=ABCD2345EFGH6789
  → DocHandlesService.resolve(id)
      → row not found            → 404
      → row.tombstone_at != null → 410 { tombstoned: true }
      → row → assertReadableBy(user, row.path)
                  → 403 / read content / 200 with { content, handle, path, ... }
```

The legacy `?path=...` form keeps working and always returns `handle` in the response so the frontend can `replaceState` to `/doc/<id>`.

## Frontend URL handling

```
              parseDocUrl flow

   pathname starts with /doc/
     │
     ├── segment matches /^[A-Z2-7]{16}$/   →   { handleId }
     │
     └── otherwise                           →   { filePath } (legacy)

   pathname starts with /s/
     │
     └── any                                 →   { code } (cosmetic-arm removed)

   pathname starts with /d/
     │
     └── any                                 →   { code } (legacy)
```

`openFile` flow:

```
openFile(path | handleId | code):
  ┌─ if handleId: read by handle  → { content, handle, path }
  ├─ if path:     read by path    → { content, handle, path }
  └─ if code:     resolve code → handle → read by handle

  setActiveFile(path)
  replaceState('/doc/' + handle.id + querySuffix + hash)
```

Both `replaceState`-to-`/s/<code>` calls in the current codebase are removed (`App.tsx:1265-66`, `App.tsx:1878-79`). The cosmetic-fallback at `App.tsx:919-922` is removed.

## Address-bar normalization examples

```
   User clicks Slack link → lands on …/s/aB7Xq2#section-3
       │
       ├── unauthed:   GuestDocView renders /s/aB7Xq2 (unchanged)
       │
       └── authed:     resolve aB7Xq2 → handleId=K3M…XYZ → path=Notes/Foo.md
                       replaceState → /doc/K3M…XYZ#section-3
                       Cmd-L Cmd-C now copies the durable internal URL.

   User opens unshared file from sidebar
       │
       └── read by path → response.handleId=L9P…ABC
                       replaceState → /doc/L9P…ABC

   User mints a public link via the dialog
       │
       └── address bar stays /doc/<id>
           clipboard gets /s/<code> via buildShareLinkUrl
           (no replaceState to /s/<code>)
```

## Tombstones

`tombstone_at` is set, `path` cleared (or retained — see open question 1). Frontend renders a "this note no longer exists" card distinct from the `share-link-gone` 410 card:

```
┌────────────────────────────────────────────────┐
│  This note no longer exists                    │
│                                                │
│  The link you followed points to a note that   │
│  has been deleted. If you think this was a     │
│  mistake, ask the person who shared the link.  │
│                                                │
│  [Go to workspace]                             │
└────────────────────────────────────────────────┘
```

The existing `share-link-gone-card` styling can be reused; only the title and copy change.

## Why not reuse share-link codes for internal use?

Considered: `kind=internal` flag on `short_links`. Rejected:

- Share-links carry semantics that don't apply to internal handles (PIN, expiry, allow_guest_comments, mint/revoke gates, scoped tokens).
- Auto-minting an "internal share-link" for every file would muddy the explicit-mint property the public-sharing-overhaul change just hardened.
- Per-file durable IDs are conceptually different (one per file) from per-share grants (one per share). Conflating them makes both harder to reason about.

The `doc_handles` table is small, additive, and orthogonal to `short_links`.

## Why not HMAC-of-path (stateless)?

Considered: `/doc/<HMAC(path, server-secret)>`. No storage, no schema. Rejected because:

- Rename → different hash → URL breaks. Today's `/doc/<path>` already has this problem; a stable-handle change that *doesn't* fix rename is a wasted opportunity.
- Reusing a stored mapping additionally lets us tombstone deletes (HMAC has no row to mark gone).

Storage cost (one row per file, ~50 bytes) is negligible at any plausible scale.

## Why not encode in frontmatter / sidecar?

Storing IDs on disk (in YAML frontmatter or a `.kalepin/<filename>.id` sidecar) would survive a *partial* restore (e.g. `rsync` of just the vault directory without `kalepin.sqlite`). But:

- The supported backup is whole-archive: `s3-backup` packages vault + `kalepin.sqlite` together, and `admin-backup-upload-restore` atomically swaps both. `doc_handles` rides along — internal URLs survive backup→restore.
- Frontmatter changes are visible to Obsidian users — the on-disk encryption + Obsidian renegotiation tradeoff applies, and an extra `kalepin-id:` field is noise for users who don't care.
- Sidecar files double the file count on disk.

Defer. The only scenario this would help is unsupported partial-restore (vault without DB), which isn't worth the cost.

## Cosmetic path removal — intentional regressions

Two existing behaviours are dropped:

1. **`App.tsx:919-922` cosmetic-fallback.** Today: if a `/s/<code>` resolves 410 but the URL has a cosmetic suffix, an authed user with access opens that file via the cosmetic path. After: the 410 card renders for everyone, authed or not. An authed user with native access can find the file via the tree; the URL itself doesn't recover.
2. **`Editor.tsx` in-doc link handler `/s/<code>/<cosmetic>` arm.** Drops the cosmetic-path arm; only `/s/<code>` (and legacy `/d/<code>`) are recognised.

The cosmetic path was always a recovery affordance, not a navigation primitive. Its removal closes the structure leak in chat/email forwarding.

## Open questions

1. **Path on tombstone — keep or null?** Keeping `path` aids audit ("this handle pointed at `Notes/Foo.md` before deletion"). Nulling reduces metadata leak from the DB. Default: keep, since the DB is server-side and the tombstone surface to the frontend never includes path.
2. **Tombstone garbage collection.** Never prune today. A `prune_tombstones_after_days` admin setting could be added later if the table grows uncomfortably.
3. **Multi-vault future.** The handle is unique within one vault. If Kalepin ever supports multi-vault, the URL would need to incorporate a vault prefix. Out of scope.
