## 1. Backend: Image Upload & Serving

- [x] 1.1 Create `attachments` module with controller and service (`packages/backend/src/attachments/`)
- [x] 1.2 Implement `POST /api/files/upload` endpoint: multipart form data with `multer`, MIME type validation (png, jpeg, gif, webp, svg+xml), 50MB size limit, SHA-256 hash naming, deduplication check, `_attachments/` auto-creation, return `{ name, relativePath }`
- [x] 1.3 Implement `GET /api/files/attachment?name=` endpoint: path traversal validation, binary file serving with correct Content-Type header, 404 for missing files
- [x] 1.4 Register the attachments module in the app module

## 2. Backend: Path Rewriting on File Move

- [x] 2.1 Update `FilesService.move()` to read `.md` file content after move, find all `_attachments/` relative references, recalculate relative paths based on new document location, and write updated content

## 3. Backend: Orphan Cleanup

- [x] 3.1 Add `POST /api/files/attachments/cleanup` endpoint to the attachments controller
- [x] 3.2 Implement orphan scan: read all `.md` files recursively, extract `_attachments/{filename}` references via regex, diff against actual files in `_attachments/`
- [x] 3.3 Implement soft-delete: move orphans to `_attachments/.trash/{ISO-timestamp}_{filename}`, auto-create `.trash/` directory
- [x] 3.4 Implement trash purge: delete `.trash/` entries older than 7 days based on timestamp prefix
- [x] 3.5 Return cleanup summary `{ orphansFound, movedToTrash, purgedFromTrash }`

## 4. Frontend: TipTap Image Extension & Rendering

- [x] 4.1 Add `@tiptap/extension-image` dependency
- [x] 4.2 Configure the image extension in the editor with custom `src` resolution: for `_attachments/` paths, fetch via authenticated API, convert to blob URL, and cache in a per-session in-memory map (`filename → blobURL`) to avoid redundant fetches
- [x] 4.3 Add image API helpers to `api.ts`: `uploadImage(file: File, docPath: string) → { name, relativePath }` and `fetchImageBlob(name: string) → string` (returns blob URL)

## 5. Frontend: Clipboard Paste Handler

- [x] 5.1 Add a TipTap extension or ProseMirror plugin that intercepts paste events containing image data (`clipboardData.files` or `clipboardData.items` with image MIME types)
- [x] 5.2 On image paste: upload via API, insert `![image](relativePath)` markdown at cursor position through the editor, which flows through OT as a normal text change

## 6. Frontend: Slash Command

- [x] 6.1 Add `/image` entry to `slashCommands` array in `slash-commands.ts` with a file picker action
- [x] 6.2 On file selection: upload via API, insert `![image](relativePath)` markdown at cursor position

## 7. Integration Testing

- [x] 7.1 Test image upload: valid file, duplicate file, oversized file, invalid MIME type
- [x] 7.2 Test image serving: existing file, missing file, path traversal attempt
- [x] 7.3 Test file move path rewriting: deeper directory, shallower directory, same directory rename
- [x] 7.4 Test cleanup: orphan detection, soft-delete to trash, trash purge, no-op cleanup
