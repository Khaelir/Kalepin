## Context

Kalepin is a collaborative markdown editor backed by a filesystem vault. Documents sync via OT over WebSocket. The storage layer is pluggable (LocalFS or Git adapter), and all content is plain `.md` files. There is currently no support for binary assets — the `StorageAdapter` interface only handles text via `read()`/`write()` (string-based). The frontend uses TipTap with a markdown serialization layer.

External editors (Obsidian, VS Code, Typora) may open the same vault, so image references must use standard markdown syntax with relative file paths.

## Goals / Non-Goals

**Goals:**
- Users can embed images via clipboard paste or `/image` slash command
- Images stored as files in `_attachments/` at vault root with hash-based names
- Standard `![alt](relative-path)` markdown syntax for cross-editor compatibility
- All connected clients see images immediately after upload
- Orphaned images can be cleaned up with soft-delete and grace period
- 50MB upload size limit

**Non-Goals:**
- Drag & drop support (future)
- Image resizing, cropping, or optimization
- Obsidian wikilink `![[]]` syntax
- Per-folder or per-document attachment directories
- Image CDN or external storage backends

## Decisions

### 1. Binary storage bypasses StorageAdapter

**Decision**: Image upload/serve uses direct filesystem operations (`fs/promises`), not the `StorageAdapter` interface.

**Rationale**: The `StorageAdapter.write()` accepts `string`, not `Buffer`. Adding binary support would require changing the interface and both adapter implementations for a single use case. Direct fs operations are simpler — `_attachments/` is always at `VAULT_PATH/_attachments/` regardless of adapter.

**Alternative considered**: Extending `StorageAdapter` with `writeBinary()`/`readBinary()` — rejected as over-abstraction for a directory that's structurally different from user documents (flat, hash-named, no OT).

### 2. Hash-based naming using SHA-256 prefix

**Decision**: Files are named `{first-16-chars-of-sha256}.{ext}` (e.g., `a3f2b1c9d4e5f6a7.png`).

**Rationale**: 16 hex chars = 64 bits of entropy, collision probability negligible for a single vault. Gives automatic deduplication — uploading the same image twice produces the same hash, skips the write. Preserves original file extension for MIME type inference and external editor compatibility.

**Alternative considered**: Full SHA-256 (64 chars) — rejected as unnecessarily long in markdown references. UUID — rejected as it doesn't deduplicate.

### 3. Image serving through a dedicated API endpoint

**Decision**: `GET /api/files/attachment?name=hash.ext` serves binary files from `_attachments/`.

**Rationale**: The frontend is served by Vite (dev) or a static server (prod), not from the vault directory. Images on disk can't be referenced by relative path in the browser. The API endpoint resolves this, applies auth gating, and centralizes path validation. TipTap renders `![](relative-path)` but the image extension rewrites `src` to the API URL at render time.

### 4. Markdown stores relative paths, editor resolves via authenticated blob URLs

**Decision**: The markdown on disk contains `![alt](../_attachments/hash.ext)` (relative path from the document to `_attachments/`). The TipTap image extension extracts the filename from `_attachments/` references, fetches the image via `GET /api/files/attachment?name=hash.ext` with the JWT auth header, converts the response to a blob URL (`URL.createObjectURL(blob)`), and sets that as the `<img src>`. Blob URLs are cached in a per-session in-memory map (`filename → blobURL`) to avoid redundant fetches.

**Rationale**: Browser `<img src>` requests don't carry the JWT auth header. Rather than introducing cookie-based auth (a second auth mechanism), fetching via JS preserves the existing JWT-in-header approach. The blob URL cache ensures each image is fetched only once per session, making the extra fetch negligible. Cross-editor compatibility is preserved — the markdown on disk uses standard relative paths.

**Alternative considered**: Cookie-based JWT for `<img>` requests — rejected because it introduces a parallel auth mechanism alongside the existing header-based JWT, increasing surface area and complexity.

### 5. File move rewrites image paths in document content

**Decision**: When `FilesService.move()` relocates a `.md` file, it reads the content, finds all `_attachments/` references, recalculates relative paths from the new location, and writes the updated content.

**Rationale**: Since `_attachments/` is global and images never move, only the relative path prefix changes (e.g., `../_attachments/` → `../../_attachments/`). This is a simple string replacement based on directory depth. The move endpoint already handles sidecar files, so this extends the same pattern.

### 6. Upload endpoint with multipart form data

**Decision**: `POST /api/files/upload` accepts `multipart/form-data` with fields: `file` (the image binary) and `docPath` (the document inserting the image, for relative path calculation). Returns `{ name: "hash.ext", relativePath: "../_attachments/hash.ext" }`.

**Rationale**: Multipart is the standard for file uploads. Including `docPath` lets the server compute the correct relative path in one round-trip. The client inserts the returned `relativePath` directly into the markdown.

### 7. Orphan cleanup: scan + soft-delete + 7-day purge

**Decision**: `POST /api/files/attachments/cleanup` scans all `.md` files for `_attachments/` references, diffs against actual files in `_attachments/`, moves unreferenced files to `_attachments/.trash/{timestamp}_{filename}`, and purges `.trash/` entries older than 7 days.

**Rationale**: On-demand (admin-triggered) keeps it simple — no background jobs or schedulers. Soft-delete with grace period protects against false positives (e.g., user is mid-edit and hasn't saved yet, or undo removes then re-adds a reference). 7 days is generous enough for any reasonable workflow.

### 8. Allowed image types and size validation

**Decision**: Accept `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`. Reject files over 50MB. Validate both MIME type (from multipart header) and file extension.

**Rationale**: These cover the vast majority of image use cases. SVG is included for diagrams. 50MB is generous for images while preventing abuse. Double validation (MIME + extension) prevents trivial bypasses.

## Risks / Trade-offs

- **[Risk] External editor adds image outside `_attachments/`** → Kalepin won't manage or clean up these images, but will render them if the relative path resolves correctly. This is acceptable — Kalepin manages what it creates.
- **[Risk] Hash collision** → At 64 bits, probability is ~1 in 10^18 for a pair. Acceptable for a single-vault use case. If the file already exists and hashes match, it's the same image — safe to skip.
- **[Risk] Large vaults slow down orphan scan** → The scan reads all `.md` files to find references. For very large vaults this could be slow. Mitigation: the scan is on-demand and can be optimized later with caching or indexing if needed.
- **[Trade-off] Direct fs ops vs StorageAdapter** → Images won't benefit from Git adapter's auto-commit. Mitigation: The Git adapter's `commitAll()` already commits everything in the vault directory, so `_attachments/` files will be included in the next commit cycle.
