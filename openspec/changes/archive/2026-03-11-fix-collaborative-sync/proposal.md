## Why

Live collaboration between two clients produces content divergence and cursor instability. When typing in a shared document, the editor content drifts between clients (especially around tables) and cursors jump or blink erratically. The root cause is that every remote operation triggers a full `editor.commands.setContent(markdown)` which re-parses the entire document — the markdown roundtrip through TipTap's parser can normalize structure differently than the original, creating spurious diffs that accumulate over time.

## What Changes

- **Shadow re-sync after setContent**: After applying remote content via `setContent`, immediately re-read `getMarkdown()` and update the shadow to match what TipTap actually produced. This breaks the drift feedback loop that causes content divergence.
- **Cursor position transformation**: Transform local cursor `{from, to}` against incoming OT operations (walk retain/insert/delete components and adjust positions) instead of restoring raw numeric positions after content replacement.
- **Remote cursor transformation**: Transform remote presence cursor positions against local pending operations so collaborative cursors render at correct positions.
- **Table serialization stabilization**: Tighten the markdown table serializer to produce more idempotent output across parse/serialize cycles, reducing the structural boundary shifts that trigger divergence.

## Capabilities

### New Capabilities
- `ot-cursor-transform`: Cursor position transformation against OT operations — a utility to adjust ProseMirror positions based on retain/insert/delete op components, used for both local cursor preservation and remote cursor rendering.

### Modified Capabilities
- `sync-perf`: The shadow re-sync mechanism changes how the OT bridge maintains state after remote operations. The shadow markdown must always reflect what TipTap actually parsed, not the raw result of applying OT ops to the previous shadow.

## Impact

- `packages/frontend/src/editor/Editor.tsx` — remote op callback, cursor save/restore logic
- `packages/frontend/src/editor/ot-bridge.ts` — potential addition of cursor transform utility
- `packages/frontend/src/editor/extensions/collaborative-cursors.ts` — remote cursor position adjustment
- `packages/frontend/src/editor/ot-client.ts` — may need to expose pending ops for cursor transformation
- No backend changes expected — the OT protocol and server-side transform remain unchanged
- No breaking changes to the Obsidian plugin or any external clients
