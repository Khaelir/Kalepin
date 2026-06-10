## Context

Kalepin uses TipTap 3.20 (ProseMirror) with React 19. Code blocks are handled by `CodeBlockLowlight` with syntax highlighting via `lowlight`. There is no existing diagram rendering. Notes are stored as markdown on disk and must remain Obsidian-compatible.

The editor already has a pattern of custom extensions with React NodeViews (e.g., `ImageWithAttachments`, `CollaborativeCursors`) and a slash command system in `slash-commands.ts`.

## Goals / Non-Goals

**Goals:**
- Render ```` ```mermaid ```` code blocks as SVG diagrams in the WYSIWYG editor
- Provide a smooth toggle between rendered view and source editing
- Keep the initial bundle size impact minimal via lazy loading
- Maintain full markdown/Obsidian compatibility

**Non-Goals:**
- Supporting other diagram formats (PlantUML, Excalidraw) — future work using same pattern
- Live re-rendering while typing — too noisy with parse errors
- Mermaid rendering in raw markdown mode — raw mode shows plain text by design
- Server-side mermaid rendering — this is purely client-side
- Mermaid theme customization UI — use sensible defaults

## Decisions

### 1. Custom NodeView on existing CodeBlock node (not a new node type)

**Choice**: Extend `CodeBlockLowlight` with a React NodeView that intercepts rendering when `language === "mermaid"`.

**Alternatives considered**:
- *Separate `mermaidBlock` node type*: Would require custom markdown serialization/parsing, schema changes, and migration logic. Much more complex for no real benefit.
- *ProseMirror decoration*: Decorations can't fully replace node rendering with interactive components (toggle state, error handling).

**Rationale**: Keeping mermaid as a regular code block means markdown round-tripping works for free. The view layer is the only thing that changes. This is the same approach Obsidian uses internally.

### 2. React NodeView component with local toggle state

**Choice**: A React component rendered via TipTap's `ReactNodeViewRenderer`. The component manages its own `isEditing` state (default: `false` = rendered view).

**Rationale**: React NodeViews integrate naturally with the existing React-based editor. Local state for toggle avoids polluting the document model with view concerns.

### 3. Re-render on blur + manual toggle

**Choice**: The diagram SVG re-renders when:
1. The user toggles from code view back to rendered view
2. The code block loses focus (blur event)

**Alternatives considered**:
- *Live debounced rendering*: Mermaid syntax is invalid most of the time while typing (e.g., `graph L` before finishing `graph LR`). Would flash errors constantly.
- *Render only on toggle*: Works but feels disconnected — user edits, clicks elsewhere, and the diagram still shows stale content.

**Rationale**: Blur-based rendering gives a natural "I'm done editing" signal without any extra interaction. The toggle is still available for explicit preview mid-edit.

### 4. Lazy-load mermaid.js via dynamic import

**Choice**: `const mermaid = await import('mermaid')` on first encounter of a mermaid block. Show a loading spinner during the import.

**Rationale**: mermaid.js is ~2MB. Most notes don't contain diagrams. Lazy loading keeps the initial bundle fast and only pays the cost when needed. Vite handles dynamic imports with code splitting natively.

### 5. Error handling with last-valid-render preservation

**Choice**:
- Store the last successfully rendered SVG string in a ref
- On parse error: show the last valid SVG (dimmed/faded) with an error badge
- On fresh blocks with no previous valid render: show the error message inline

**Rationale**: Preserving the last valid render prevents jarring visual jumps when the user makes a small syntax error. The dimming + badge clearly communicates that the displayed diagram is stale.

### 6. Mermaid initialization config

**Choice**: Initialize mermaid with `startOnLoad: false` (we control rendering), `securityLevel: 'strict'` (prevent XSS from diagram content), and `theme: 'neutral'` (works well on light backgrounds).

**Rationale**: Manual rendering control is required since we manage the lifecycle ourselves. Strict security is important since diagram content comes from user notes which could be shared.

## Risks / Trade-offs

- **Bundle size**: mermaid.js adds ~2MB to the lazy chunk → Mitigated by dynamic import; only loaded when needed
- **Rendering performance with many diagrams**: A note with 10+ mermaid blocks could be slow on initial render → Mitigated by rendering only visible blocks (can add intersection observer later if needed)
- **Mermaid version updates**: Mermaid syntax evolves and occasionally breaks → Pin to a specific major version, update deliberately
- **XSS surface**: Mermaid renders user content as SVG → Mitigated by `securityLevel: 'strict'` which sanitizes output
