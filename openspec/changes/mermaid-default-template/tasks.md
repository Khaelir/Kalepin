## 1. Shared default template constant

- [x] 1.1 Export a `DEFAULT_MERMAID_SOURCE = 'graph LR\n  A --> B'` constant from `packages/frontend/src/editor/extensions/mermaid-block.ts` (or a sibling `mermaid-defaults.ts` if cleaner) so both the slash command and the auto-fill plugin import the same value.

## 2. Fix the broken slash command

- [x] 2.1 In `packages/frontend/src/editor/slash-commands.ts:165`, replace the `setCodeBlock(...).insertContent('graph LR\n  A --> B')` chain with a single `insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: DEFAULT_MERMAID_SOURCE }] })` call so newlines, indentation, and `>` are preserved literally.
- [ ] 2.2 Verify via dev server: `/mermaid` produces a code block whose `textContent` contains a real `\n` and a literal `-->`, and which renders without a parse error.

## 3. Auto-fill plugin (single chokepoint)

- [x] 3.1 Add an `addProseMirrorPlugins()` method to `MermaidBlock` in `packages/frontend/src/editor/extensions/mermaid-block.ts` that returns one new plugin.
- [x] 3.2 Inside the plugin, implement `appendTransaction(transactions, oldState, newState)`:
  - Skip if any incoming transaction has the meta flag `mermaid-default-template-fill` set (prevents recursion).
  - Walk `newState.doc` and find every mermaid code block (`node.type.name === 'codeBlock' && node.attrs.language === 'mermaid'`).
  - For each found node at position `pos`: check whether the same position in `oldState.doc` contained a mermaid code block. If yes, the block is not newly-created — skip.
  - For each newly-created mermaid block whose `node.textContent.trim()` is empty, accumulate an insertion of `DEFAULT_MERMAID_SOURCE` at the start of the node's content.
  - Return a single transaction with all accumulated insertions plus `setMeta('mermaid-default-template-fill', true)`. Position the selection at the end of the last inserted template.
- [ ] 3.3 Verify the input rule path: typing `​```mermaid` + Enter creates a block and the plugin immediately fills it; the user sees a rendered diagram with the cursor at the end of the source.
- [ ] 3.4 Verify the paste path: pasting a markdown fence with empty body fills it; pasting one with existing content leaves it untouched.
- [ ] 3.5 Verify the deletion guard: select-all + delete inside an existing mermaid block does NOT trigger a refill.

## 4. Empty-state placeholder (stretch)

- [x] 4.1 In `packages/frontend/src/editor/extensions/mermaid-node-view.tsx`, in the rendered branch (line 62+), add a new conditional render: when `!source.trim() && !loading && !error && lastValidSvg.current === null`, render a `<div className="mermaid-empty" onClick={handleToggleEdit}>...</div>` with the text "Empty Mermaid diagram — click to edit".
- [x] 4.2 Add `.mermaid-empty` CSS in `packages/frontend/src/styles.css`, mirroring the visual language of `.toc-empty` (subdued text, dashed border or muted background, cursor: pointer on hover).
- [ ] 4.3 Verify: emptying the source of an existing valid block and blurring shows the placeholder; clicking it returns the block to edit mode with focus inside the source `<pre>`.

## 5. Tests

- [x] 5.1 Add a unit test for the auto-fill plugin: build a minimal PM state, dispatch a transaction that inserts an empty mermaid code block, assert the resulting state contains `DEFAULT_MERMAID_SOURCE` in that node.
- [x] 5.2 Add a unit test for the deletion guard: start with a non-empty mermaid block, dispatch a delete-all transaction, assert the resulting state contains an empty node (no refill).
- [x] 5.3 Add an E2E test (Playwright) covering the slash command path: invoke `/mermaid`, assert no parse-error UI is visible and an SVG is rendered.
- [x] 5.4 Add an E2E test for the markdown-typed path: type `​```mermaid` + Enter, assert the block immediately renders an SVG (default template was filled).
- [ ] 5.5 (Stretch) Add an E2E test for the placeholder: create a mermaid block, edit to clear it, blur, assert the placeholder is visible; click it, assert source-edit mode.

## 6. Manual verification & cleanup

- [ ] 6.1 Run the full editor in a dev server; smoke-test all three creation paths (slash, markdown, paste) and confirm the rendered diagram appears immediately.
- [ ] 6.2 Re-open an existing note with a known-good mermaid diagram and confirm no behavior change (the auto-fill must NOT touch already-populated blocks).
- [x] 6.3 Run typecheck and lint across `packages/frontend`.
