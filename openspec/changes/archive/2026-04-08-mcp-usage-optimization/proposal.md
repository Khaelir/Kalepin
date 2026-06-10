## Why

MCP tool usage is higher than expected because every note edit — even a single-word fix — requires the AI client to send the entire document content back via `edit_note`. This means a read→rewrite cycle costs 2× the document size in tokens. Additionally, sessions expire after 30 minutes, causing frequent re-initializations with redundant tool discovery.

## What Changes

- **New `patch_note` tool**: Search-and-replace editing — find an exact text match and swap it. Fails safely if not found or ambiguous. Reduces edit token cost from full-document to just the changed fragment.
- **New `append_to_note` tool**: Append content to the end of a note without reading or rewriting existing content. Covers the common "add a section" pattern.
- **Content hashing on `read_note`**: Returns a `contentHash` with every read. Write tools accept an optional `baseHash` to detect conflicts without verification re-reads.
- **Updated `edit_note` description**: Strongly nudges AI clients toward `patch_note` for small/targeted edits. Full-content `edit_note` remains available for complete rewrites.
- **Session TTL bump**: 30 minutes → 8 hours. Eliminates frequent session re-initializations. Memory footprint per session is ~10-20KB, negligible even at scale.

## Capabilities

### New Capabilities
- `mcp-patch-note`: Search-and-replace tool for targeted note edits with safe failure modes
- `mcp-append-note`: Append-only tool for adding content to existing notes
- `mcp-content-hash`: Content hashing on reads with optimistic concurrency on writes

### Modified Capabilities
- `get-updates-mcp`: `edit_note` description updated to nudge toward `patch_note`; `read_note` response format changes to include `contentHash`

## Impact

- **Backend**: `mcp.service.ts` (new tool registrations, read_note response change, TTL constant), `files.service.ts` (new `patchFile` and `appendToFile` methods)
- **API contract**: `read_note` response gains a `contentHash` field (additive, non-breaking). Two new tools added (non-breaking). `edit_note` description text changes (non-breaking).
- **No frontend changes, no schema migrations, no dependency additions.**
