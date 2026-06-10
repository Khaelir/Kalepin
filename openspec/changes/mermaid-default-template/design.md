## Context

The Kalepin editor uses TipTap with a `MermaidBlock` extension that subclasses `CodeBlockLowlight` and routes nodes whose `language === 'mermaid'` through a custom `MermaidNodeView`. The node view replaces the source `<pre>` with a rendered SVG and hides the source via `display: none`. This means a mermaid block with empty `node.textContent` renders nothing — toolbar only, no caret, no placeholder.

Three entry points create mermaid blocks today:

1. **Slash command** `/mermaid` (`slash-commands.ts:165`): currently broken — passes a string to `insertContent`, which is HTML-parsed, mangling `\n`, indentation, and `>`.
2. **Markdown input rule** (tiptap-markdown): user types `​```mermaid` + space/enter → empty mermaid code block.
3. **Paste / programmatic** (e.g. pasting a fence from another editor, opening a note that already contains an empty fence).

All three should converge on the same outcome: the user sees a working default diagram and can hit the existing edit toggle to modify it.

## Goals / Non-Goals

**Goals:**
- Empty mermaid blocks never render as silent blank space at creation time.
- A single chokepoint handles all three creation paths so behavior cannot drift between them.
- The default template is a valid, minimally-illustrative diagram that renders cleanly with `securityLevel: 'strict'`.
- The slash command produces the same source string as the auto-fill path — no per-entry-point divergence.
- Zero behavioral change for blocks that already have content.

**Non-Goals:**
- No side-by-side editor / split view. The existing source ↔ preview toggle stays.
- No expansion of mermaid features (new diagram types, theming, export). Out of scope.
- No change to the rendering pipeline, lazy loading, or security configuration.
- No retroactive fill of existing empty mermaid blocks already saved in user notes (only fires on creation transactions).

## Decisions

### Decision 1: Single ProseMirror plugin via `appendTransaction`, not per-entry-point fixes

**Choice:** Add an `appendTransaction` plugin in `MermaidBlock`'s `addProseMirrorPlugins()` that scans every transaction and, for each node added by it that is a mermaid code block with empty text, appends an insertion of the default template.

**Why over the alternatives:**
- *Per-entry-point fix (slash command + input rule + paste handler):* three places to maintain, easy to forget the next one (e.g., a future "duplicate block" command). Single chokepoint is one place to audit.
- *Override `MermaidNodeView` to inject content on mount:* timing is wrong — mounting happens after the node is already in the doc, and writing back through `updateAttributes` / `tr.insertText` from inside a React effect creates a feedback loop with PM's transaction model.
- *Patch tiptap-markdown's input rule:* fragile, third-party-internal API, doesn't cover paste/programmatic creation.

**Detection rule for "newly created":** compare `tr.before` and `tr.doc`. For any mermaid code block found in `tr.doc` whose position did not contain a mermaid code block in `tr.before` (or whose previous content was non-empty and is now empty due to a delete — explicitly excluded), it is "new" and eligible for fill.

The plugin fires once per creating transaction and produces a follow-up transaction (returned from `appendTransaction`) that inserts the template text at the start of the empty node. It MUST set a transaction meta flag (`mermaid-default-template-fill`) on its own follow-up so it does not recursively trigger itself.

### Decision 2: Slash command also fixed at source

Even though the auto-fill plugin would cover the broken slash command (the empty block created by `setCodeBlock` would get filled), we fix `slash-commands.ts:165` directly to use PM node syntax. Reasons:

- The plugin's correct fill happens in a follow-up transaction; the broken HTML-parsed insertion creates an *intermediate* state where the doc briefly contains "graph LRA --&gt; B". Even if quickly overwritten, this is observable to other plugins, undo history, and collab sync.
- Defensive: if the plugin is ever disabled or fails, the slash command still works.

The fix is a one-line change:

```ts
editor.chain().focus().insertContent({
  type: 'codeBlock',
  attrs: { language: 'mermaid' },
  content: [{ type: 'text', text: DEFAULT_MERMAID_SOURCE }],
}).run();
```

`DEFAULT_MERMAID_SOURCE` is exported from `mermaid-block.ts` (or a shared constant module) so the slash command and the auto-fill plugin share one source of truth.

### Decision 3: Default template content

`graph LR\n  A --> B` — kept from the existing slash command. Renders quickly, demonstrates the basic syntax, fits visually on one line. Alternatives considered:

- `flowchart TD\n  Start --> Stop`: slightly more readable labels, but `flowchart` is just an alias of `graph`; no real gain.
- A minimal sequence diagram: too domain-specific as a default; flowchart is the most common mermaid use.

Trade-off: the template is uninspiring. If we wanted to teach mermaid we could pick something richer, but that would also make the user delete more on their first edit. Minimal wins.

### Decision 4: Stretch placeholder is opt-in via a follow-up requirement

The "user empties an existing block then blurs" case is real but rare. We codify it as a separate spec requirement so it can be implemented later without re-opening this change. The implementation, when done, lives in `MermaidNodeView`'s rendered branch: when `!source.trim() && !isEditing && lastValidSvg.current === null`, render a `.mermaid-empty` block ("Empty Mermaid diagram — click to edit") that toggles to edit mode on click. Reuses the visual language of `.toc-empty`.

## Risks / Trade-offs

- **Risk:** `appendTransaction` mis-detects "newly created" and fills a block the user just emptied → silent overwrite of their delete. **Mitigation:** detection compares `tr.before` to `tr.doc` *for the same position* and only fills if the node did not exist there before this transaction. Deletes that empty an existing node leave the position with the same node and an empty content — explicitly skipped.
- **Risk:** Collaborative editing (Yjs/OT path) — two clients each fill a freshly-created empty block, producing duplicated content. **Mitigation:** the fill is local-only (set `addToHistory: false`?) and idempotent — if the block already has text by the time our transaction commits, the plugin's check will see non-empty content and no-op. In practice for the current OT path this is unlikely because the creator is the one whose plugin fires first.
- **Risk:** Markdown-typed `​```mermaid<enter>` triggers the input rule, which immediately also focuses inside the block; auto-fill runs and the cursor lands inside the now-pre-filled text. **Mitigation:** position cursor at the *end* of the inserted template so user can keep typing to extend the example, or `selectAll` so first keystroke replaces it. Choosing **end of template** as the default — least surprising; the user can `Cmd+A` if they want to start over.
- **Trade-off:** Users who *expect* an empty block (e.g., paste a `​```mermaid\n\n```` skeleton from a doc generator) will be surprised by the fill. This is acceptable: anyone pasting mermaid usually pastes the source too, in which case `tr.before`/`tr.doc` will see non-empty content and the plugin no-ops.
- **Trade-off:** The default template is static. If we ever want context-aware defaults (e.g., remember the user's last-used diagram type), the plugin's `DEFAULT_MERMAID_SOURCE` constant becomes a function. Easy to evolve.

## Open Questions

- Should the auto-fill be skippable via a setting / extension option (for power users who really do want empty blocks)? Default is no — keep the surface small. If a user reports it, add an option then.
- Cursor placement after fill: end of template (current decision) vs. select-all (so first keystroke replaces). End-of-template chosen but worth observing in dogfooding.
