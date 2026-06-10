## Context

Documents are identified by their filesystem path throughout the stack. URLs like `/doc/Eclairage%20public/Specs/Syndica/Syndicats.md` break when files are renamed or moved.

The URL scheme is centralized in 3 functions in `App.tsx` (`DOC_PREFIX`, `filePathFromUrl()`, `buildDocUrl()`), with a few satellite references in `Editor.tsx` (internal link clicks), `notification.service.ts` (email links), and E2E tests. The rest of the stack (API calls, WebSocket, DB, file tree) uses file paths directly and is untouched.

The system already handles rename cascading — `files.service.ts:move()` rewrites wiki-links via `linkIndex.rewriteLinksOnRename()`, and `RenameTrackingService` detects external renames (Obsidian). Adding a `short_links` table update to these existing flows is straightforward.

## Goals / Non-Goals

**Goals:**
- Stable URLs that survive file renames and moves — no separate "share" action needed
- Human-readable URLs (cosmetic path suffix)
- Graceful degradation if the DB is wiped (fallback to cosmetic path)
- Backwards compatibility with existing `/doc/...` URLs

**Non-Goals:**
- Embedding IDs in markdown files or frontmatter
- Access control on links (same auth as the app)
- Custom/vanity short codes
- Assigning IDs to every file eagerly (only on first open)

## Decisions

### 1. URL format: `/d/<code>/<cosmetic-path>`

```
/d/k7x9Qm2pAb/Eclairage-public/Specs/Syndicats
   └── stable     └── human-readable, ignored by router
```

The router extracts the code, resolves it to a file path via `short_links`, and opens the document. The cosmetic path is for human readability only — it's not used for resolution.

**Why include the cosmetic path?** Two reasons:
1. Readability — you can tell what document a URL points to
2. Fallback — if the code can't be resolved (DB wiped), decode the cosmetic path and use it directly

**Cosmetic path encoding:** Path segments joined with `/`, spaces replaced with `-`, `.md` extension stripped. Purely cosmetic — no round-trip fidelity needed since it's only a fallback.

### 2. Short code format: 10-char base62 via `crypto.randomBytes`

Use `crypto.randomBytes(8)` encoded as base62 (a-zA-Z0-9), truncated to 10 characters. No new dependency needed.

~59 bits of entropy — collision probability is negligible at any realistic scale.

### 3. Lazy ID assignment: on first open

When a document is opened and has no entry in `short_links`, a new code is generated and stored. The URL in the address bar is immediately updated to the `/d/<code>/...` format.

Files that are never opened in Kalepin (e.g., only edited in Obsidian) don't get IDs. This is fine — they don't have URLs to share.

### 4. Frontend URL resolution flow

```
Browser navigates to /d/k7x9Qm2pAb/Eclairage-public/Specs/Syndicats
         │
         ▼
   SPA loads, filePathFromUrl() extracts code "k7x9Qm2pAb"
         │
         ▼
   openFile() calls API: GET /api/share-links/resolve/k7x9Qm2pAb
         │
         ├── 200 {path: "Eclairage public/Specs/Syndicats.md"}
         │     → open file, update cosmetic path in URL if stale
         │
         └── 404 (code not found — DB wiped?)
               → decode cosmetic path from URL, try opening that
               → if file exists, assign new code, update URL
               → if file doesn't exist either, show 404 page
```

**Why resolve on the frontend (not server-side redirect)?** The SPA already handles all routing client-side. A server-side redirect would require the SPA to reload. Instead, the frontend resolves the code via a lightweight API call during the normal `openFile()` flow.

### 5. Backend API

- `POST /api/share-links` with `{ path }` → `{ code }` — get or create a code for a path
- `GET /api/share-links/resolve/:code` → `{ path }` — resolve a code to a path

Both are simple DB lookups. The `POST` endpoint is called when opening a file that doesn't have a code yet. The `GET` endpoint is called when navigating to a `/d/...` URL.

### 6. Legacy `/doc/...` URL support

`filePathFromUrl()` detects the old `/doc/` prefix and extracts the path directly (current behavior). The app opens the file normally. Optionally, after the file opens and has a code, `replaceState` the URL to the new `/d/...` format. This provides seamless backwards compatibility — old bookmarks keep working and silently upgrade.

### 7. Rename integration: hook into existing flows

After `this.storage.move(src, dest)` in `files.service.ts`, update `short_links` rows where `path = src` to `path = dest`. Same pattern as the existing `linkIndex.rewriteLinksOnRename()` call.

For external renames detected by `RenameTrackingService`, the same update runs in `handleRename()`. Folder renames use prefix-based update (`path LIKE 'old-prefix/%'`).

### 8. File deletion: delete the share link

When a file is deleted, its `short_links` row is also deleted. Dead codes return 404 → cosmetic path fallback → 404 page.

### 9. Notification emails use new URL format

`notification.service.ts` constructs doc links for email notifications. These switch to `/d/<code>/<cosmetic-path>` format, making notification links stable across renames too.

### 10. Backup: included automatically

The `short_links` table is a regular SQLite table — not a derived index. It's included in admin backup/restore automatically (unlike `notes_fts` and `note_embeddings` which are stripped). No special handling needed.

## Risks / Trade-offs

- **[Extra API call on navigation]** → One lightweight DB lookup per page load to resolve code → path. Negligible latency for SQLite. Could be avoided by including the path in the file tree data, but not worth the complexity yet.
- **[DB loss = codes reset]** → Fallback to cosmetic path means links degrade gracefully instead of breaking completely. After DB restore from backup, all codes are preserved.
- **[Orphaned codes after external delete]** → Chokidar watcher detects external deletes; clean up the `short_links` row. Minor orphans are harmless.
- **[Cosmetic path staleness]** → After a rename, old URLs have a stale cosmetic suffix. The code still resolves correctly; the app can optionally `replaceState` the URL to show the current path.
