## 1. Setup

- [x] 1.1 Add `mermaid` npm dependency to `packages/frontend/package.json`
- [x] 1.2 Create the lazy-loading mermaid wrapper module (`packages/frontend/src/editor/extensions/mermaid-loader.ts`) that dynamically imports mermaid, initializes with `startOnLoad: false`, `securityLevel: 'strict'`, `theme: 'neutral'`, and caches the instance

## 2. Mermaid NodeView Extension

- [x] 2.1 Create the `MermaidNodeView` React component (`packages/frontend/src/editor/extensions/mermaid-node-view.tsx`) with toggle state (default: rendered), rendering via the lazy loader, and blur-based re-rendering
- [x] 2.2 Implement error handling: last-valid-render preservation (dimmed + error badge), inline error message for fresh blocks
- [x] 2.3 Implement loading spinner state while mermaid.js is being lazy-loaded
- [x] 2.4 Create the TipTap extension (`packages/frontend/src/editor/extensions/mermaid-block.ts`) that adds a React NodeView to code blocks when `language === "mermaid"`

## 3. Editor Integration

- [x] 3.1 Register the MermaidBlock extension in `Editor.tsx` alongside existing extensions
- [x] 3.2 Add `/mermaid` slash command to `slash-commands.ts` that inserts a mermaid code block with starter template (`graph LR\n  A --> B`) in source editing mode

## 4. Styles

- [x] 4.1 Add CSS for mermaid container (rendered SVG wrapper, sizing, overflow handling)
- [x] 4.2 Add CSS for toggle button (positioned in top-right corner of the block)
- [x] 4.3 Add CSS for error state (dimmed last-valid render, error badge, inline error message)
- [x] 4.4 Add CSS for loading spinner
