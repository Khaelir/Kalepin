## Why

The editor slash command menu has 11 items in a flat list with basic substring filtering. As we add more block types (15-20+ planned), both browsing and searching degrade — users can't scan a long undifferentiated list, and typing `/todo` won't find "Task." General-purpose users need better discoverability without sacrificing speed for power users.

## What Changes

- **Grouped layout**: Commands organized under section headers (Basic, Insert, Diagrams) when browsing. Groups provide spatial memory so users know where to look.
- **Keyword-based search**: Each command gets keyword aliases (e.g., Task → "todo", "checkbox"). Filter matches against name, label, AND keywords with ranked results.
- **Filter hint bar**: Show the current query at the top of the menu so users don't have to look back at the editor text.
- **No-results state**: Keep the menu open with a "No matching commands" message instead of silently closing when nothing matches.
- **Groups collapse during search**: When the user types a query, switch from grouped layout to flat ranked results (Notion pattern).

## Capabilities

### New Capabilities
- `slash-menu-groups`: Grouped layout with section headers for browsing, collapsing to flat results when filtering
- `slash-menu-search`: Keyword aliases on commands and ranked search results by match quality
- `slash-menu-filter-hint`: Visual query indicator at the top of the menu with dismiss affordance
- `slash-menu-empty-state`: Graceful no-results state when filtering produces zero matches

### Modified Capabilities
<!-- No existing spec-level behavior changes — this is purely additive UI work -->

## Impact

- `packages/frontend/src/editor/slash-commands.ts` — `SlashCommand` interface gains `group` and `keywords` fields; filter logic rewritten with ranking
- `packages/frontend/src/editor/Editor.tsx` — Menu rendering updated for grouped layout, filter hint bar, and empty state
- `packages/frontend/src/styles.css` — New styles for group headers, filter hint, and empty state
