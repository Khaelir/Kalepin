## 1. Dark theme SVG background

- [x] 1.1 Add `.drawio-image img { background: white; }` rule to `packages/frontend/src/styles.css` near the existing `.drawio-badge` styles (~line 729)

## 2. Menu positioning fix

- [x] 2.1 Remove `div.mxPopupMenu { position: fixed !important; }` from the CSS injection array in `packages/frontend/src/editor/drawio-editor-modal.tsx` (line 79)
- [x] 2.2 Fix the Extras menu hide selector — use `.geMenubar .geItem:nth-last-child(3)` (Extras is 3rd from last: before Help + .geStatus)
- [x] 2.3 Fix common.css not loading — copy to `mxgraph/css/` path where app.min.js actually loads it from (vendor-drawio.sh + manual copy)

## 3. Cell editor positioning fix

- [x] 3.1 Remove the scroll restoration script block from `packages/frontend/public/drawio/embed.html` (lines 136-193, the `waitForContainer` IIFE)

## 4. Update E2E tests

- [x] 4.1 Update `packages/e2e/tests/drawio.spec.ts` — in the "popup menus use fixed positioning" test, change assertion from `position: fixed` to `position: absolute` and verify the menu top is within 30% of viewport height
- [x] 4.2 Remove or rework the "double-click to edit cell preserves scroll position" test — the scroll-preservation behavior is being removed; replace with a test that verifies the cell editor appears on/near the shape (not at 0,0)
