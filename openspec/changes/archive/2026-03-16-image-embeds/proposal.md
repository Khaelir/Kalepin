## Why

Kalepin has no support for images in documents. Users cannot paste screenshots, embed diagrams, or include any visual content. For a markdown editor, this is a fundamental gap. Standard markdown image syntax (`![alt](path)`) ensures files remain portable to Obsidian, VS Code, Typora, and GitHub.

## What Changes

- Add image upload endpoint with 50MB size limit and hash-based deduplication
- Add image serving endpoint for browser rendering
- Add TipTap image extension with clipboard paste and `/image` slash command
- Store all images in a global `_attachments/` folder at vault root with hash-based filenames
- Insert standard markdown `![alt](relative-path)` references via OT
- Rewrite image relative paths when documents are moved
- Add orphan cleanup: scan for unreferenced images, soft-delete to `_attachments/.trash/`, purge after 7 days

## Capabilities

### New Capabilities
- `image-embeds`: Image upload, storage, rendering, and markdown integration
- `attachment-cleanup`: Orphaned attachment detection, soft-delete, and trash purging

### Modified Capabilities

## Impact

- **Backend**: New upload/serve endpoints in files module, new cleanup module, changes to file move logic for path rewriting
- **Frontend**: New TipTap extension, paste handler, slash command entry, image rendering through API
- **Storage**: `_attachments/` directory created at vault root, `.trash/` subdirectory for soft deletes
- **Dependencies**: `multer` (or similar) for multipart uploads, `@tiptap/extension-image` for editor
- **Shared**: New types for image upload request/response
