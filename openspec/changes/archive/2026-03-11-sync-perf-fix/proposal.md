## Why

The OT sync system has a feedback loop: when it flushes document content to disk, chokidar picks up the write as an "external" file change. This triggers a `file:changed` broadcast, causing every connected client to do a full HTTP reload of the document, a toast notification ("File changed externally: ..."), and a complete editor re-render. On large documents this causes multi-second freezes every 3 seconds of inactivity. Secondary issues (naive op composition, O(n) diff per keystroke) compound the problem for large files and rapid collaborative editing.

## What Changes

- **Suppress self-triggered file change events**: The OT gateway will skip broadcasting `file:changed` for documents with an active OT session, since the OT system itself caused the write.
- **Proper OT operation composition**: Replace the naive array concatenation in `composeOps()` with real OT composition that merges adjacent operations, preventing unbounded op growth during rapid typing.
- **Profile-driven diff optimization** (conditional): After the above fixes, profile large document editing. If the prefix/suffix scan in `diffMarkdownToOps` is a measurable bottleneck, optimize it.
- **Surgical remote op application** (conditional): If collaboration on large docs is still slow, replace `editor.commands.setContent()` with targeted ProseMirror transaction updates derived from OT op positions.

## Capabilities

### New Capabilities

_None — this is a fix to existing behavior._

### Modified Capabilities

_No spec-level requirement changes. The external edit detection behavior remains the same for actual external edits. The fix ensures OT-originated writes are correctly identified as internal._

## Impact

- `packages/backend/src/ot/ot.gateway.ts` — file change event filtering
- `packages/backend/src/ot/ot-session-manager.ts` — session lookup exposed to gateway
- `packages/frontend/src/editor/ot-client.ts` — composeOps rewrite
- `packages/frontend/src/editor/ot-bridge.ts` — potential diff optimization
- `packages/frontend/src/editor/Editor.tsx` — potential remote op application optimization
- No API changes, no database changes, no breaking changes
