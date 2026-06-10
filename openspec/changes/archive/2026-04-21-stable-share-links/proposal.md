## Why

Document URLs like `/doc/Eclairage%20public/Specs/Syndica/Syndicats.md` break when files are renamed or moved. This makes shared links unreliable — anyone who bookmarked or received a link gets a 404 after a reorganization. Users shouldn't need a special "share" button — the URL in the address bar should be stable and copy-pasteable.

## What Changes

- New `short_links` SQLite table mapping short codes to current file paths
- New URL scheme: `/d/<code>/<cosmetic-path>` replaces `/doc/<path>` as the primary URL format
  - `<code>` is the stable identifier (10-char base62), used for resolution
  - `<cosmetic-path>` is human-readable but ignored by the router — purely for readability
- IDs are assigned lazily on first open (not for every file in the vault)
- On file rename/move, the `short_links` path is updated — existing URLs keep working
- Fallback: if the code can't be resolved (e.g. DB wiped), the cosmetic path is used as a real path
- Legacy `/doc/<path>` URLs redirect to the new format for backwards compatibility
- Backend email notification links use the new URL format

## Capabilities

### New Capabilities
- `share-links`: Stable document identity — code generation, resolution, URL scheme, and lifecycle management

### Modified Capabilities
- `file-management`: File rename/move must update the `short_links` table to keep URLs valid

## Impact

- **Backend**: New entity, new service. Small addition to the existing `files.service.ts` rename flow. Notification service updated to use new URL format.
- **Frontend**: URL construction (`buildDocUrl`) and parsing (`filePathFromUrl`) updated. Internal link click handler updated. No new UI components needed — the address bar *is* the share link.
- **Database**: One new table (`short_links`). Auto-created by TypeORM synchronize. Included in admin backup/restore.
- **E2E tests**: URL references updated to new format.
