## Why

Two mermaid block UX problems compound into the same poor first impression. The `/mermaid` slash command inserts its template via `insertContent('graph LR\n  A --> B')`, where the plain string is parsed as HTML — newlines collapse, indentation collapses, and `>` round-trips into `&gt;` — so the supposedly working default produces a Mermaid parse error on insertion (`graph LRA --&gt; B`). Separately, when a user types `​```mermaid` in markdown the resulting empty code block is invisible, because the rendered view is empty and the source is hidden behind `display: none`. In both cases the user lands on broken output instead of a working diagram they can edit.

## What Changes

- Fix `/mermaid` slash command to insert a proper ProseMirror node structure (`{ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: '...' }] }`) so newlines, leading whitespace, and `>` are preserved literally.
- Auto-fill any newly-created mermaid code block whose text content is empty with the default template, via a single ProseMirror plugin (`appendTransaction`) that watches new mermaid nodes. This single chokepoint covers the slash command, the markdown input rule (`​```mermaid`), paste, and programmatic creation.
- The auto-fill SHALL only fire on the transaction that creates the node, never on subsequent edits — a user who deliberately clears an existing mermaid block stays in control.
- (Stretch) Render a small clickable placeholder ("Empty Mermaid diagram — click to edit") when an *existing* mermaid block has empty source after blur, so the silent-blank case is no longer silent. Lower priority than the two items above.
- Existing source/preview toggle UI is unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mermaid-render`: Adds requirements for a default template on creation, correct programmatic insertion (PM node, not HTML string), and empty-state placeholder behavior.

## Impact

- **Code:**
  - `packages/frontend/src/editor/slash-commands.ts:165` — switch `insertContent` argument from string to PM node.
  - `packages/frontend/src/editor/extensions/mermaid-block.ts` — register an `appendTransaction` plugin (or similar) that fills empty mermaid nodes on creation.
  - `packages/frontend/src/editor/extensions/mermaid-node-view.tsx` — (stretch only) render an empty-state placeholder when source is empty and not editing.
- **Specs:** `mermaid-render` spec gains new requirements; existing requirements are untouched.
- **Tests:** unit/E2E coverage for the default template, the slash command output, and the markdown-typed flow.
- **No breaking changes:** existing valid mermaid blocks render exactly as before. The default template constant is the only user-visible behavior shift.
