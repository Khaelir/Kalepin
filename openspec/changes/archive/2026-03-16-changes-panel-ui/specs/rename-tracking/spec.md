## rename-tracking

Update starred item paths and change history paths when files are renamed or moved on disk.

### Requirements

- When chokidar detects a file rename (unlink event followed by add event within a 300ms debounce window, with matching file content), update:
  - `starred_items.path` where `path = oldPath`
  - `note_changes.path` where `path = oldPath`
- Folder renames: when a folder is renamed, update all starred items and note changes whose path starts with the old folder prefix
- Content matching: compare file content (or file size + first 1KB as a fast check) to correlate unlink/add pairs
- If no matching add is found within the debounce window, treat as a genuine delete (no path update)
- If multiple adds match, prefer the one with identical content (byte-for-byte match)

### Integration Point

Hook into the existing chokidar file watcher in `LocalFSAdapter` (and `GitAdapter` if applicable). The rename correlation logic should be a standalone utility that the storage adapter calls, which then delegates DB updates to a service.

### Edge Cases

- File deleted and recreated with same name: not a rename, no path update (timestamps differ, debounce window handles this)
- Two files swapped: ambiguous — pick the content-matching pair, or skip if ambiguous
- Case-only renames (e.g., `README.md` → `readme.md`): handled the same as any rename on case-sensitive filesystems; on macOS (case-insensitive), chokidar may not emit separate events — test and document behavior
