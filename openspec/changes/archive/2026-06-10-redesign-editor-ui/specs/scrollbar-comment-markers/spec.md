## REMOVED Requirements

### Requirement: Gutter strip visibility
**Reason**: Superseded by the new `floating-minimap` capability, which renders comment markers inside a dedicated mini-map strip rather than on the native editor scrollbar. Drawing markers on the native scrollbar competed visually with the mini-map strip and caused sub-pixel alignment issues between the two.
**Migration**: No user data migration needed. The `floating-minimap` capability implements unresolved vs. resolved styling, click-to-navigate, and recalculation-on-change. The native-scrollbar gutter component and its associated styles are deleted.

### Requirement: Markers for unresolved comments only
**Reason**: Moved to `floating-minimap`.
**Migration**: Unresolved and resolved marker behavior is preserved in the new mini-map with the same semantics; see `floating-minimap` spec's "Comment markers" requirement.

### Requirement: Marker position reflects document position
**Reason**: Moved to `floating-minimap`, which uses the offsetParent-chain walk to compute positions accurately inside a scroll container with nested positioned ancestors.
**Migration**: Positioning is preserved; the new mini-map's math is more robust (accounts for gutter-handle paragraphs that have `position: relative`).

### Requirement: Mention distinction
**Reason**: Moved to `floating-minimap`. Unresolved markers remain in `--kalepin-primary`; mention-emphasis styling is deferred to a follow-up change (behavior kept simple in v1 of the mini-map).
**Migration**: Mention-emphasis on mini-map markers is not implemented in v1. Unresolved markers are all `--kalepin-primary`; the visual prominence of @mentions is surfaced via the Comments tab and notifications instead. A follow-up change can reintroduce mention-emphasis on the mini-map if needed.

### Requirement: Click to navigate
**Reason**: Moved to `floating-minimap`.
**Migration**: Click-to-navigate is preserved — clicking a comment marker on the mini-map invokes `focusThread(id)` which scrolls the editor and highlights the thread in the Comments tab.

### Requirement: Position recalculation
**Reason**: Moved to `floating-minimap`.
**Migration**: Recalculation on comment-change, content-change, and resize is preserved in the mini-map implementation.
