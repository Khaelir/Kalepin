## 1. Content Hashing Utility

- [x] 1.1 Add `computeContentHash(content: string): string` helper to `files.service.ts` — MD5, first 8 hex chars
- [x] 1.2 Add `base_hash` validation helper `validateBaseHash(currentContent, baseHash)` that throws on mismatch

## 2. FilesService Methods

- [x] 2.1 Add `patchFile(path, oldText, newText, baseHash?)` method — read content, validate hash, find exactly one match, replace, write, track change
- [x] 2.2 Add `appendToFile(path, content, separator, baseHash?)` method — read content, validate hash, append separator + content, write, track change
- [x] 2.3 Add optional `base_hash` parameter to `createFile` for edit_note conflict detection

## 3. MCP Tool Registration

- [x] 3.1 Register `patch_note` tool with `path`, `old_text`, `new_text`, `base_hash` params — uses fuzzy path resolution and `patchFile`
- [x] 3.2 Register `append_to_note` tool with `path`, `content`, `separator`, `base_hash` params — uses fuzzy path resolution and `appendToFile`
- [x] 3.3 Update `read_note` response to include `contentHash: <hash>` line before the note content
- [x] 3.4 Add optional `base_hash` parameter to `edit_note` input schema and pass it through to `createFile`
- [x] 3.5 Update `edit_note` description to nudge toward `patch_note` for small/targeted edits

## 4. Session TTL

- [x] 4.1 Change `SESSION_TTL_MS` from `30 * 60 * 1000` to `8 * 60 * 60 * 1000`

## 5. Testing

- [x] 5.1 Test `patch_note`: successful single match, not found, multiple matches, empty new_text (deletion)
- [x] 5.2 Test `patch_note`: base_hash match, mismatch, and omitted
- [x] 5.3 Test `append_to_note`: default separator, custom separator, base_hash conflict, non-existent note
- [x] 5.4 Test `read_note` includes contentHash, and hash is deterministic
- [x] 5.5 Test `edit_note` with base_hash conflict detection
