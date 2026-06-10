## 1. Cursor Transform Utility

- [x] 1.1 Add `transformPosition(pos: number, ops: OTOperation): number` function to `ot-bridge.ts` that walks an OT op array and adjusts a position based on retain/insert/delete components before it
- [x] 1.2 Add `transformRange(range: {from: number, to: number}, ops: OTOperation): {from: number, to: number}` convenience wrapper that transforms both endpoints

## 2. Shadow Re-sync

- [x] 2.1 In the remote op callback in `Editor.tsx`, after `editor.commands.setContent(newMd)`, re-read `getMarkdown()` and update `shadowRef.current` to the result
- [x] 2.2 Apply the same fix in the `setRemoteOpCallback` effect (the duplicate callback set when mode changes)

## 3. Cursor Transformation on Remote Ops

- [x] 3.1 In the remote op callback, transform `{from, to}` using `transformPosition` against the incoming ops before restoring the cursor after `setContent`
- [x] 3.2 Apply the same cursor transformation in the duplicate `setRemoteOpCallback` effect

## 4. Table Serialization Investigation

- [x] 4.1 Investigate `isMarkdownSerializable` in `Editor.tsx` — check if the HTML fallback is triggered too aggressively for common table structures, and tighten conditions if needed
- [x] 4.2 Test roundtrip stability: serialize a table to markdown, parse it back via `setContent`, re-serialize, and verify the output matches — fix any normalization differences found

## 5. Validation

- [ ] 5.1 Manual test: open same document in two browser tabs, type in both simultaneously, verify content stays in sync *(requires manual testing)*
- [ ] 5.2 Manual test: with a table in the document, edit text above/below/inside the table from both clients, verify no divergence *(requires manual testing)*
- [ ] 5.3 Manual test: verify cursor stays at the correct logical position when the other client inserts/deletes text before it *(requires manual testing)*
