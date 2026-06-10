## Context

Kalepin uses a custom OT (Operational Transformation) system operating on markdown strings. The architecture is:

1. Local edits: TipTap `onTransaction` → serialize to markdown → diff against shadow → generate OT ops → send to server
2. Remote ops: receive OT ops → apply to shadow markdown string → `editor.commands.setContent(newMarkdown)` → restore cursor

The `setContent` call is a full document replacement that re-parses markdown through TipTap. This roundtrip is not idempotent — TipTap may normalize structure differently (especially tables with the HTML fallback path), causing the shadow to drift from the editor's actual state. Each drift generates spurious OT ops that accumulate into visible content divergence.

Cursor positions are saved as raw `{from, to}` numbers before `setContent` and restored after, without transformation against the incoming operations.

### Constraints
- Markdown-based OT protocol must be preserved (Obsidian plugin compatibility)
- Markdown files on disk are the source of truth
- No backend protocol changes

## Goals / Non-Goals

**Goals:**
- Eliminate content divergence between clients caused by markdown roundtrip normalization
- Preserve correct cursor position when remote operations change document content
- Render remote collaborative cursors at correct positions
- Reduce visual disruption when applying remote operations

**Non-Goals:**
- Migrating to Yjs or CRDT-based collaboration (deferred — see memory)
- Changing the OT protocol or server-side transform logic
- Handling offline/disconnection recovery (separate concern)
- Optimizing for large documents or high-frequency edits (performance tuning)

## Decisions

### Decision 1: Re-sync shadow after setContent

**Choice**: After `editor.commands.setContent(newMd)`, immediately call `editor.storage.markdown.getMarkdown()` and overwrite `shadowRef.current` with the result.

**Why**: The shadow must always match what TipTap would serialize. If TipTap normalizes the markdown differently during parse (e.g., reorders table whitespace, collapses empty cells), the shadow must reflect that — otherwise the next local edit will diff against a stale shadow and produce spurious ops.

**Alternative considered**: Normalize markdown before diffing (run it through a parser/serializer first). Rejected — adds latency to every keystroke and the normalization would need to exactly match TipTap's behavior, which is the problem in the first place.

### Decision 2: Cursor transformation utility in ot-bridge.ts

**Choice**: Add a `transformPosition(pos: number, ops: OTOperation): number` function to `ot-bridge.ts` that walks an OT operation array and adjusts a position based on retains, inserts, and deletes occurring before it.

**Algorithm**:
```
cursor = original position
offset = 0 (tracks position in the old document)

for each op component:
  if retain(n):
    offset += n
  if delete(n):
    if offset + n <= cursor:
      cursor -= n          // deletion entirely before cursor
    elif offset < cursor:
      cursor = offset      // deletion spans cursor — collapse to start
    offset += n
  if insert(text):
    if offset <= cursor:
      cursor += text.length  // insertion before/at cursor pushes it forward
```

**Why in ot-bridge.ts**: It's a pure function operating on OT ops and positions — fits naturally alongside `diffMarkdownToOps` and `applyOpsToMarkdown`. No ProseMirror dependency.

**Note**: This transforms **markdown character positions**. ProseMirror positions differ from markdown positions (structural nodes add invisible positions). However, since we're using `setContent` which rebuilds the doc from markdown, and cursor save/restore happens around that call, the markdown-level transformation is the right granularity. The cursor positions saved from `editor.state.selection` won't perfectly map to markdown positions, but the transformation direction (shift by insert/delete length) is the same at both levels.

### Decision 3: Transform remote presence cursors

**Choice**: When rendering remote cursors in `collaborative-cursors.ts`, the positions received via presence messages are relative to the sender's document state. If the local client has pending (unacknowledged) operations, remote cursor positions may be stale. We will clamp positions to valid doc bounds (already done) but not attempt full cross-client cursor transformation.

**Why**: Full cursor transformation would require knowing the remote client's document revision and transforming through the operation log — significantly more complex. The shadow re-sync fix (Decision 1) will reduce the divergence that makes remote cursors appear in wrong places. Clamping is sufficient for now.

### Decision 4: Keep setContent for now, don't attempt surgical ProseMirror transactions

**Choice**: Continue using `editor.commands.setContent(markdown)` for applying remote operations rather than translating OT ops into ProseMirror transactions.

**Why**: Mapping markdown string positions to ProseMirror doc positions is fundamentally hard (tables, images, block boundaries create position gaps). The setContent approach, combined with shadow re-sync, is correct — the visual "blink" from full replacement is a cosmetic issue that can be addressed later if needed. Getting correctness right first matters more.

## Risks / Trade-offs

**[Risk] Shadow re-sync may generate different markdown than what was applied** → This is actually the point. If TipTap normalizes `| col1 | col2 |` to `| col1  | col2  |`, the shadow must match the normalized form. The risk is that the re-sync itself triggers a spurious `onTransaction` — mitigated by the existing `isRemoteRef` guard.

**[Risk] Cursor transform operates on markdown positions, not PM positions** → The shift amounts (insert length, delete count) are the same regardless of position model. The absolute position may be slightly off, but the adjustment direction and magnitude are correct. This is strictly better than no transformation.

**[Risk] Table HTML fallback still produces non-idempotent roundtrips** → The shadow re-sync breaks the feedback loop even if the roundtrip isn't perfectly stable. However, we should investigate the `isMarkdownSerializable` check to ensure it's not overly aggressive in falling back to HTML.

**[Trade-off] setContent still causes full DOM rebuild** → Accepted for now. Correctness over aesthetics. Can revisit with surgical PM transactions later if the visual disruption bothers users.
