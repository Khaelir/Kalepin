## 1. Shared Color Utility

- [x] 1.1 Extract `getColorForUser()` and `COLORS` array from `PresenceIndicators.tsx` into a shared utility (e.g. `packages/frontend/src/utils/user-colors.ts`)
- [x] 1.2 Update `PresenceIndicators.tsx` to import from the shared utility

## 2. CollaborativeCursors TipTap Extension

- [x] 2.1 Create `packages/frontend/src/editor/extensions/collaborative-cursors.ts` — a TipTap extension wrapping a ProseMirror plugin that manages a `DecorationSet`
- [x] 2.2 Implement widget decoration for remote cursor carets (colored `<span>` with user label)
- [x] 2.3 Implement inline decoration for remote selection highlights (semi-transparent background)
- [x] 2.4 Expose a method to update remote user presence data (cursor, selection, email, color) that triggers a decoration re-render via transaction metadata

## 3. Broadcast Local Cursor Position

- [x] 3.1 Add `onSelectionUpdate` handler in `Editor.tsx` that sends a throttled `presence` message with current cursor position and selection range
- [x] 3.2 Implement 50ms throttle on outgoing presence messages

## 4. Wire Incoming Presence to Extension

- [x] 4.1 Listen for incoming `presence` messages in `Editor.tsx` and forward cursor/selection data to the CollaborativeCursors extension
- [x] 4.2 Listen for `presence:leave` messages and remove the departing user's decorations

## 5. Styling

- [x] 5.1 Add CSS for cursor carets (colored vertical bar, positioned inline, pointer-events: none)
- [x] 5.2 Add CSS for cursor labels (small pill above caret with user email, matching color, pointer-events: none)
- [x] 5.3 Add CSS for selection highlights (semi-transparent background using user color)
