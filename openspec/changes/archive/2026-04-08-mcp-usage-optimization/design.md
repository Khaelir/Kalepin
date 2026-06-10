## Context

The Kalepin MCP server exposes tools for AI clients (Claude Desktop, etc.) to read and edit notes. Currently, `edit_note` accepts the full document content as input and writes it via `filesService.createFile()`, which does a complete file overwrite. Every edit — even a one-word fix — costs 2× the document size in tokens (one read, one full write). Sessions expire after 30 minutes, causing re-initialization overhead.

Key files:
- `packages/backend/src/mcp/mcp.service.ts` — tool registration, session management
- `packages/backend/src/files/files.service.ts` — file CRUD, change tracking integration

## Goals / Non-Goals

**Goals:**
- Reduce token usage per edit cycle by 40-80% for typical small/targeted edits
- Maintain zero-corruption guarantees — edits either apply cleanly or fail safely
- Add optimistic concurrency control via content hashing
- Reduce session re-initialization frequency

**Non-Goals:**
- Real-time collaborative editing (OT/CRDT) via MCP — that's a separate system
- Changing the MCP transport protocol or authentication flow
- Multi-operation atomic batching (e.g., edit + comment in one call)
- Deprecating or removing `edit_note` — it remains for full rewrites

## Decisions

### 1. Search-and-replace for `patch_note` (not unified diff, not line-range)

**Choice**: `old_text` / `new_text` exact string matching, must match exactly once.

**Alternatives considered**:
- *Unified diff*: AI models can generate malformed patches. Partial application corrupts documents. Too fragile for prod.
- *Line-range replacement*: Line numbers drift if the document changes between read and edit. Race condition risk without locking.
- *Search-and-replace*: Impossible to corrupt — if `old_text` isn't found or is ambiguous, the operation fails and the document is untouched. This is the same pattern as Claude Code's Edit tool, so AI models are well-trained on it.

**Implementation**: New `patchFile(path, oldText, newText, baseHash?)` method on `FilesService`. Reads current content, validates hash if provided, finds exactly one occurrence of `oldText`, replaces with `newText`, writes via `storage.write()`, tracks change.

### 2. Content hash using MD5 truncated to 8 hex chars

**Choice**: `crypto.createHash('md5').update(content).digest('hex').slice(0, 8)`

**Rationale**: We need a short, human-readable hash for AI clients to pass back. MD5 is fast, and collision risk at 8 hex chars (32 bits) is negligible for this use case — we're comparing one document's content at two points in time, not a large corpus. SHA-256 would work too but is slower for no practical benefit here.

The hash is **optional** on write tools. When provided, it enables optimistic concurrency. When omitted, writes proceed without conflict detection (backwards compatible).

### 3. Append with configurable separator

**Choice**: `append_to_note` accepts optional `separator` (default `"\n\n"`).

**Rationale**: Different append patterns need different separators — a new section wants `"\n\n"`, a list item wants `"\n"`, a horizontal rule wants `"\n\n---\n\n"`. Defaulting to double-newline covers the most common case.

**Implementation**: New `appendToFile(path, content, separator, baseHash?)` method on `FilesService`. Reads current content, validates hash, appends `separator + content`, writes, tracks change.

### 4. `edit_note` description nudge

**Choice**: Update the tool description to explicitly say: *"For small or targeted edits, prefer patch_note (search-and-replace) which is faster and safer. Use edit_note only when you need to completely rewrite a note."*

This is a soft nudge — AI clients read tool descriptions to decide which tool to use. A strong description is the simplest and most effective way to redirect behavior without breaking anything.

### 5. Session TTL: 8 hours

**Choice**: Bump `SESSION_TTL_MS` from `30 * 60 * 1000` to `8 * 60 * 60 * 1000`.

**Rationale**: Each session is ~10-20KB (transport + server instance + closures). Even 100 concurrent sessions would be ~2MB. Sessions are tied to authenticated API keys which can be revoked independently. 8 hours covers a full workday without re-initialization.

## Risks / Trade-offs

- **`old_text` matching brittleness** → If the AI sends slightly wrong whitespace or a stale `old_text`, the patch fails. Mitigation: clear error messages that include a snippet of the actual content near the expected match point, so the AI can retry with corrected text.
- **Hash collisions (theoretical)** → 32-bit hash has a collision probability of ~1 in 4 billion for any two different contents. For single-document optimistic concurrency this is effectively zero. If this ever matters, we can extend to 16 hex chars.
- **Longer sessions = stale auth** → An API key revoked during an active 8h session would remain usable until the session expires. Mitigation: acceptable for current scale. If needed later, add key-revocation event that invalidates associated sessions.
- **AI clients ignoring the description nudge** → Some clients may still use `edit_note` for small edits. Mitigation: monitor via existing usage analytics; consider making `edit_note` return a hint in its response if the content is mostly unchanged.
