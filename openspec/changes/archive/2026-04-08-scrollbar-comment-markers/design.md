## Context

The editor uses TipTap/ProseMirror inside a `.editor-container` div with `overflow-y: auto` and `position: relative`. Comment threads arrive as a `CommentThread[]` prop. The `CommentHighlights` extension already resolves each unresolved thread's position in the document by searching for `quotedText` and picking the closest match to `positionHint`. The current user's email is extracted from the JWT in `App.tsx`.

The existing scrollbar is a 6px-wide webkit-styled bar. There is no existing overlay or gutter system.

## Goals / Non-Goals

**Goals:**
- Provide spatial awareness of where unresolved comments are in long documents
- Visually distinguish threads that mention the current user
- Allow one-click navigation from marker to comment
- Keep it minimal — no tooltips, no extra chrome

**Non-Goals:**
- Replacing or modifying the native scrollbar
- Showing resolved comments
- Showing any information beyond position and mention status (no previews, no author info)
- Adding markers for other entities (search results, headings, etc.) — though the component could be generalized later

## Decisions

### 1. Gutter strip as a separate overlay element (not scrollbar decoration)

A thin `position: absolute` div pinned to the right edge of `.editor-container`, spanning its full visible height. Pills are positioned as a percentage of `scrollHeight`.

**Why not CSS scrollbar styling?** CSS `::webkit-scrollbar` pseudo-elements don't support child elements or arbitrary markers. The new CSS `scrollbar-color` standard is even more limited. A separate overlay is the only cross-browser approach that works.

**Why not `position: sticky`?** Sticky elements participate in the document flow and can cause layout shifts. An absolute-positioned element with its `top` and `height` updated via JS on scroll is more predictable and avoids interaction with the content layout.

### 2. Position computation via coordsAtPos + scroll offset

For each unresolved thread:
1. Reuse the same text-search logic from `CommentHighlights` to find the PM position
2. Call `editor.view.coordsAtPos(pos)` to get the viewport-relative top
3. Convert to document-space: `docTop = coords.top - containerRect.top + container.scrollTop`
4. Compute percentage: `docTop / container.scrollHeight`

**Why not read positions from the DecorationSet directly?** ProseMirror DecorationSets don't expose positions in a way that's easy to iterate externally. The text-search is already cheap (same approach used by the plugin) and the N is small.

### 3. Mention detection via extractMentions on thread comments

For each unresolved thread, scan all comments using `extractMentions()` and check if any returned email matches the current user. This reuses existing logic from the shared package.

### 4. Recalculation strategy

- **Comment changes**: React re-render from prop change triggers recalc
- **Content changes**: Subscribe to editor `update` event (debounced ~150ms)
- **Resize**: `ResizeObserver` on `.editor-container`
- **Scroll**: Update gutter `top` position on scroll (lightweight, no position recalc needed)

### 5. Gutter dimensions and pill styling

- Gutter strip: 10px wide, right edge of container, semi-transparent background (or none)
- Pills: 8px wide × 4px tall, rounded, positioned absolutely within gutter
- Regular: `rgba(233, 69, 96, 0.35)` — soft rose, consistent with existing `comment-highlight` palette
- Mentions-me: `rgba(233, 69, 96, 0.85)` — strong rose
- Click target: slightly larger than visual pill for easier clicking (padding or min-height)

## Risks / Trade-offs

- **[Layout shift on gutter appearance]** → The gutter is positioned absolutely over the scrollbar area, not in the document flow, so no content shift occurs
- **[Performance on very large documents]** → Position computation involves `coordsAtPos` for each unresolved thread. With typical comment counts (<50), this is negligible. Debouncing content changes at 150ms prevents excessive recalc
- **[coordsAtPos accuracy during async renders]** → Positions may be briefly stale after large remote edits. The debounced recalc will catch up within one frame. Acceptable for a non-critical visual indicator
- **[Overlap with native scrollbar]** → The gutter sits just to the left of the scrollbar track. With the scrollbar at 6px and the gutter at 10px, they don't compete for space. The gutter's translucent pills won't obscure scrollbar interaction
