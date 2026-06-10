## 1. Component and Position Logic

- [x] 1.1 Create `CommentScrollMarkers.tsx` component with props: `editor`, `threads: CommentThread[]`, `currentUser: string`, `onNavigate: (quotedText, positionHint) => void`
- [x] 1.2 Implement text-search position resolution (reuse `quotedText` + `positionHint` matching logic from `comment-highlights.ts`) to compute PM positions for each unresolved thread
- [x] 1.3 Convert PM positions to scroll-percentage via `coordsAtPos()` + container scroll offset math
- [x] 1.4 Implement mention detection per thread using `extractMentions()` against `currentUser` email

## 2. Gutter Rendering

- [x] 2.1 Render the gutter strip as an absolutely-positioned div inside `.editor-container`, pinned to the right edge
- [x] 2.2 Conditionally show/hide based on `scrollHeight > clientHeight` check
- [x] 2.3 Render pill markers at computed percentage positions with correct color (soft rose vs strong rose for mentions)
- [x] 2.4 Wire up click handler on pills to call `onNavigate` with the thread's `quotedText` and `positionHint`

## 3. Recalculation

- [x] 3.1 Recalculate positions when `threads` prop changes (React effect)
- [x] 3.2 Subscribe to editor `update` event for content changes (debounced ~150ms)
- [x] 3.3 Add `ResizeObserver` on the editor container to recalculate on resize
- [x] 3.4 Update gutter `top` offset on scroll events to keep it pinned to the visible area

## 4. Integration

- [x] 4.1 Thread `currentUser` email prop from `App.tsx` through to `KalepinEditor` and into `CommentScrollMarkers`
- [x] 4.2 Render `CommentScrollMarkers` inside the `.editor-container` div in `Editor.tsx` (rendered mode only)
- [x] 4.3 Add CSS for gutter strip (10px wide, no background) and pill markers (8×4px, rounded, pointer cursor)

## 5. E2E Tests

- [x] 5.1 Create `packages/e2e/tests/scrollbar-comment-markers.spec.ts` with test helpers (reuse `createNote`, `addCommentViaAPI`, `openNote` patterns from `comments.spec.ts`)
- [x] 5.2 Test: gutter strip appears when document is long enough to scroll and has unresolved comments, does not appear on short documents
- [x] 5.3 Test: only unresolved comments show markers — add a comment via API, verify marker appears, resolve it via API, verify marker disappears
- [x] 5.4 Test: mention-me markers use distinct styling — add a comment mentioning the current user, verify the marker has the strong rose color class/style
- [x] 5.5 Test: clicking a pill marker scrolls the editor to the comment's position
