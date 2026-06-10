## 1. Backend Entity & Service

- [x] 1.1 Create `ShortLink` TypeORM entity (`short_links` table: `code` PK, `path` unique, `createdAt`)
- [x] 1.2 Create `ShareLinksService` with `getOrCreate(path)` and `resolve(code)` methods
- [x] 1.3 Generate short codes using `crypto.randomBytes(8)` encoded as 10-char base62

## 2. Backend API Routes

- [x] 2.1 Create `ShareLinksController` with `POST /api/share-links` (body: `{ path }` → `{ code }`)
- [x] 2.2 Add `GET /api/share-links/resolve/:code` → `{ path }` resolution endpoint
- [x] 2.3 Register controller and service in the appropriate module

## 3. Rename & Delete Integration

- [x] 3.1 Update `files.service.move()` to update `short_links.path` on rename/move
- [x] 3.2 Update `RenameTrackingService.handleRename()` to update `short_links.path` (including folder prefix updates)
- [x] 3.3 Update file deletion flow to remove associated `short_links` row
- [x] 3.4 Handle external file deletion via chokidar watcher cleanup

## 4. Frontend URL Scheme

- [x] 4.1 Update `buildDocUrl(filePath, code, heading?, threadId?)` to produce `/d/<code>/<cosmetic-path>` URLs
- [x] 4.2 Add `buildCosmeticPath(filePath)` helper (strip `.md`, replace spaces with `-`)
- [x] 4.3 Update `filePathFromUrl()` to parse `/d/<code>/...` URLs and extract the code
- [x] 4.4 Keep legacy `/doc/<path>` parsing in `filePathFromUrl()` for backwards compatibility
- [x] 4.5 Add `createShareLink(path)` and `resolveShareLink(code)` API calls to `api.ts`

## 5. Frontend Navigation Flow

- [x] 5.1 Update `openFile()` to call `POST /api/share-links` (get or create code) and use code in URL
- [x] 5.2 On initial load with `/d/<code>/...` URL, resolve code via API before opening file
- [x] 5.3 Implement cosmetic path fallback: if code resolution fails, try decoding cosmetic path
- [x] 5.4 On initial load with legacy `/doc/...` URL, open file by path then upgrade URL to `/d/...` format
- [x] 5.5 Update `handlePopstate()` to handle both URL formats on browser back/forward

## 6. Satellite Updates

- [x] 6.1 Update `Editor.tsx` internal link click handler to recognize `/d/...` URLs
- [x] 6.2 Update `notification.service.ts` to construct `/d/<code>/<cosmetic-path>` links in emails
- [x] 6.3 Update E2E tests to use new URL format

## 7. Testing

- [x] 7.1 Test code generation (new + idempotent) and resolution (valid, unknown)
- [x] 7.2 Test path update on rename/move (API and external)
- [x] 7.3 Test folder rename updates all child share link paths
- [x] 7.4 Test cosmetic path fallback when code resolution fails
- [x] 7.5 Test legacy `/doc/...` URL backwards compatibility and upgrade
