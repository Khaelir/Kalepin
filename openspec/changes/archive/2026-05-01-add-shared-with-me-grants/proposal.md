# Add per-file user-to-user grants ("Shared with me" zone)

## Why

Today, Kalepin only knows two visibility states: "your personal stuff" (`_users/{email}/`) and "the shared vault" (`vault/`). There's no way for Alice to share a single document with Bob without either making it public (share-link) or putting it in the shared vault (visible to everyone). Users keep asking for direct, scoped grants — "share this one note with my collaborator, read-only".

The cheapest model that's actually useful: **per-file grants** (not per-folder). A grants table records `(grantor, grantee, path, permission)`. Bob's sidebar gains a "Shared with me" section listing files Alice has granted him. Sharing a folder is a UI bulk operation that mints N grants — there's no folder-level grant in the database.

Why per-file rather than per-folder: simpler predicate (exact match), safer-by-default (new files added to a "shared folder" are *not* auto-shared, preventing accidental exposure). The cost is a UX prompt: when Alice creates a new note inside a folder she's already shared, the UI offers to also share the new note.

## What Changes

- **New table `document_grants`**: `id INTEGER PK, grantor_email TEXT, grantee_email TEXT, path TEXT, permission TEXT, expires_at INTEGER NULL, created_at INTEGER, revoked_at INTEGER NULL`.
  - `permission` ∈ `'read' | 'comment' | 'write'`.
  - `expires_at`: nullable, perpetual by default.
  - Soft-delete via `revoked_at` rather than hard-delete (audit trail).
- **Visibility predicate evolves.** Today's `isVisibleTo(path, email)` becomes `visibilityFor(path, email) → 'owner' | 'shared_grant' | 'public_share' | 'denied'`. Every read/write site continues calling a unified `assertReadableBy` / `assertWritableBy`, which now accepts grants as well.
- **Sidebar gets a third section: "Shared with me"**. Lists all paths where `grantee_email = req.user.email` and `revoked_at IS NULL` and (`expires_at IS NULL` OR `expires_at > now`).
- **New endpoints**:
  - `POST /api/grants` — `{ grantee_email, path, permission, expires_at? }` — owner of the path mints a grant.
  - `DELETE /api/grants/:id` — revoke. Owner of the path or admin only.
  - `GET /api/grants?as=grantor|grantee` — list grants from either perspective.
  - `GET /api/files/shared-with-me` — convenience: tree-shaped list of paths granted to the requester.
- **Bulk folder share**: a UI dialog lists all files under a folder, shows checkboxes (default all checked), mints N grants on Apply. Surfaces "12 files will be shared with bob@x" before commit.
- **New-file-in-shared-folder prompt**: when a user creates a file inside a folder where any of their files are already shared with someone, show an inline toast with "Share with bob@x too?" buttons.
- **Stage-2 interaction**: sharing an E2E note requires per-user public keys for re-wrapping the CEK. Decision deferred to stage 2's design. In stage 1, granting on E2E paths is rejected with a clear error.
- **Tests**: leak sweep across every authenticated route — Alice grants `read` on `_users/alice/foo.md` to Bob; Bob can read but not write; revoking ends Bob's access; expiry ends access at the timestamp; admin can list and revoke; non-grantee non-owner non-admin gets 404.

## Capabilities

### New Capabilities

- `document-grants`: Per-file user-to-user permission grants with read/comment/write, optional expiry, perpetual default, owner+admin revocation, and a "Shared with me" zone in the sidebar.

### Modified Capabilities

- `file-management`: Read/write predicates consult grants. Sidebar tree includes a "shared with me" section.
- `full-text-search`: Search results include grant-visible paths.
- `link-index`: Backlinks/graph results include grant-visible paths.
- `share-links`: Mint endpoint clarifies — share-links remain orthogonal to grants (a public link bypasses the grant check, by design).
- `comments`: Comment creation requires `'comment'` or `'write'` permission on the path.

## Impact

- **Backend**: new module `packages/backend/src/grants/`. Predicate update across read/write controllers (one new code path: "is this user a grantee?").
- **Frontend**: "Shared with me" section in `FileTree.tsx`; share-dialog component; new-file-in-shared-folder toast.
- **DB**: one new table, two indexes (`(grantee_email, revoked_at)` for the per-user query; `(path, revoked_at)` for revocation cascades on path move/delete).
- **Risk**: predicate complexity — every authz check now considers three sources (ownership, public share, grants). Mitigated by centralizing in `visibilityFor` and unit-testing the truth table exhaustively.
- **Path renames/moves**: when a path is renamed, all grants for that path must be updated (or the grant becomes orphaned). Handled by a hook in `FilesService.move`.
- **Path deletion**: hard-delete cascades to grant rows (or sets `revoked_at`).
