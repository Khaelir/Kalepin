## Context

Kalepin uses a custom OT engine for real-time collaborative editing. The backend already broadcasts `presence` messages containing `cursor` (numeric position) and `selection` (`{from, to}`) between connected clients via WebSocket. The frontend `PresenceIndicators.tsx` renders user avatars with deterministic hash-based colors, but no cursor or selection is rendered inside the editor.

TipTap (ProseMirror) provides a `Decoration` API that supports widget decorations (for carets) and inline decorations (for selection highlights) — the same primitives that `@tiptap/extension-collaboration-cursor` uses internally.

## Goals / Non-Goals

**Goals:**
- Render colored carets for each remote user's cursor position in the editor
- Render colored selection highlights for each remote user's active selection
- Show a small label (user name/email) on each caret
- Broadcast local cursor/selection changes via the existing presence WebSocket channel
- Reuse the existing color palette and hashing from `PresenceIndicators.tsx`

**Non-Goals:**
- Replacing the OT engine with Yjs/CRDT
- Adding `@tiptap/extension-collaboration` or `@tiptap/extension-collaboration-cursor` as dependencies
- Cursor smoothing or animation
- Showing cursors for users viewing different documents

## Decisions

### 1. Custom TipTap extension using ProseMirror Decorations

Build a `CollaborativeCursors` TipTap extension that wraps a ProseMirror plugin. The plugin manages a `DecorationSet` with:
- **Widget decoration** at each remote user's cursor position → renders a colored caret `<span>` with a name label
- **Inline decoration** over each remote user's selection range → applies a semi-transparent background color

**Why not use `@tiptap/extension-collaboration-cursor`?** It's tightly coupled to Yjs's awareness protocol. Our presence data comes from a custom WebSocket channel. Building a lightweight extension is simpler than adapting the Yjs-based one.

### 2. Presence data flow via editor transaction metadata

On each TipTap `onSelectionUpdate`, send a `presence` message with the current `selection.from` and `selection.to` (or `selection.anchor` as cursor when collapsed). This uses the existing WebSocket `send({ type: 'presence', docId, cursor, selection })` path.

Incoming presence messages update a shared state (React ref or extension storage), then trigger a ProseMirror transaction with metadata to re-render decorations.

### 3. Throttle outgoing presence updates

Cursor movements can fire very rapidly. Throttle outgoing presence messages to ~50ms to avoid flooding the WebSocket. This is fast enough to feel real-time but limits message volume.

### 4. Shared color utility

Extract `getColorForUser()` and the `COLORS` array from `PresenceIndicators.tsx` into a shared utility so both the avatar indicators and the cursor decorations use the same colors consistently.

## Risks / Trade-offs

- **Stale cursors on disconnect** → The backend already broadcasts `presence:leave` on disconnect; the extension removes decorations for departed users.
- **Position drift after remote OT ops** → Cursor positions are ProseMirror document positions. After a remote operation changes the document, previously received cursor positions may be stale. Mitigation: remote users re-broadcast their position on each selection change, so stale positions self-correct quickly. We do not attempt to transform cursor positions through OT ops.
- **Performance with many users** → DecorationSet is efficient for small numbers of decorations. With 10+ concurrent editors this could need optimization, but that's an unlikely scenario for now.
