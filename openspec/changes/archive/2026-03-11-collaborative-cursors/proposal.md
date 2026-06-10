## Why

Kalepin supports real-time collaborative editing via OT, and the presence infrastructure already broadcasts cursor positions and selections between clients. However, remote users' cursors and selections are not visually rendered in the editor — users can't see where others are editing. Adding collaborative cursors makes multi-user editing tangible and avoids conflicting edits in the same area.

## What Changes

- Broadcast cursor/selection position from the editor on every selection change via the existing `presence` WebSocket message
- Render remote cursors as colored carets in the editor using ProseMirror decorations
- Render remote selections as colored highlight ranges
- Reuse the existing deterministic color assignment from `PresenceIndicators.tsx`
- Show a small username label on the cursor caret

## Capabilities

### New Capabilities
- `collaborative-cursors`: Real-time rendering of remote users' cursor positions and text selections in the TipTap editor, built on the existing presence WebSocket infrastructure

### Modified Capabilities

_(none — the presence message format already carries cursor/selection data)_

## Impact

- **Frontend**: New TipTap extension (ProseMirror plugin) for cursor/selection decorations, new CSS for cursor styling, changes to `Editor.tsx` to send presence on selection change
- **Backend**: No changes needed — presence broadcast already works
- **Dependencies**: No new packages — uses ProseMirror's built-in `Decoration` API via TipTap
