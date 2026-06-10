## Why

Users writing technical notes need to include diagrams (flowcharts, sequence diagrams, state machines, etc.) inline with their text. Mermaid is the de facto standard for markdown-compatible diagrams, supported by GitHub and Obsidian. Adding Mermaid rendering to Kalepin keeps notes portable across editors and eliminates the need for external diagram tools.

## What Changes

- Code blocks with language `mermaid` render as SVG diagrams by default instead of showing raw syntax
- A toggle button on mermaid blocks lets users switch between rendered view and source editing
- Diagrams re-render on blur (when the user clicks away from the block) and on manual toggle
- Invalid mermaid syntax shows the last valid render (dimmed) with an error badge, or an inline error message for fresh blocks
- mermaid.js is lazy-loaded on first encounter to avoid bloating the initial bundle
- A `/mermaid` slash command inserts a starter template
- All mermaid diagram types are supported (flowchart, sequence, class, state, ER, gantt, pie, etc.)

## Capabilities

### New Capabilities
- `mermaid-render`: Rendering mermaid code blocks as SVG diagrams with toggle, error handling, and lazy loading

### Modified Capabilities
- `editor`: Registers the mermaid NodeView extension and integrates it with the existing code block system
- `editor-context-menu`: Adds `/mermaid` slash command to the slash menu

## Impact

- **Frontend only** — no backend changes
- **New dependency**: `mermaid` npm package (~2MB, lazy-loaded)
- **Editor extensions**: New `MermaidBlock` extension wrapping CodeBlockLowlight with a React NodeView
- **Slash commands**: One new entry in `slash-commands.ts`
- **CSS**: New styles for mermaid container, toggle button, error/loading states
- **Markdown format**: Uses standard ` ```mermaid ` — no custom syntax, fully Obsidian-compatible
