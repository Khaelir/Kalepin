## Context

The slash command menu is a ProseMirror plugin (`slash-commands.ts`) that listens for `/` keystrokes and shows a fixed-position popup rendered in `Editor.tsx`. Commands are defined as a flat `SlashCommand[]` array. Filtering is a simple substring match on `name` and `label`. The menu closes when zero results match. One submenu pattern exists (Heading → H1-H4) using a `children` property.

All changes are confined to three files in `packages/frontend/src/editor/` plus `styles.css`.

## Goals / Non-Goals

**Goals:**
- Organize commands into visually distinct groups for faster scanning
- Make search smarter with keyword aliases and ranked results
- Provide visual feedback (filter hint, empty state) so users stay oriented
- Keep the architecture simple and extensible for future commands

**Non-Goals:**
- Recents / frequently used tracking (revisit at 30+ commands)
- Fuzzy / Levenshtein matching (keyword aliases cover 90% of the need)
- Two-column or card-style layouts
- Preview thumbnails for block types
- Changing the submenu pattern for Heading children

## Decisions

### 1. Add `group` and `keywords` to `SlashCommand` interface

Extend the existing interface with two optional fields:

```typescript
export interface SlashCommand {
  // ... existing fields
  group?: string;
  keywords?: string[];
}
```

**Why over a separate registry**: Keeping everything co-located in the command definition is simpler and matches the existing pattern. No new abstractions needed.

### 2. Group ordering via a constant array

Define group order and display labels as a constant:

```typescript
const SLASH_COMMAND_GROUPS = [
  { key: 'basic', label: 'Basic' },
  { key: 'insert', label: 'Insert' },
  { key: 'diagrams', label: 'Diagrams' },
];
```

**Why not derive from commands**: Explicit ordering is more predictable than sorting by first-occurrence. Adding a new group is one line.

### 3. Dual rendering mode — grouped vs. flat filtered

- **No query (browsing)**: Render commands grouped under section headers. Iterate `SLASH_COMMAND_GROUPS`, render header, then commands matching that group.
- **Query active (searching)**: Render a flat list sorted by match quality. No section headers.

**Why collapse groups during search**: Half-empty groups during filtering are confusing and waste space. Notion, Linear, and Craft all flatten during search.

### 4. Match ranking algorithm

When filtering, score each command and sort descending:

| Priority | Match type | Score |
|----------|-----------|-------|
| 1 | Exact name match | 100 |
| 2 | Label starts with query | 80 |
| 3 | Name/label contains query | 60 |
| 4 | Keyword starts with query | 40 |
| 5 | Keyword contains query | 20 |

Take the highest score per command. Ties preserve definition order.

**Why not fuzzy**: Keyword aliases cover the intent gap (user types "todo" → finds Task). Fuzzy matching can surface surprising results that erode trust.

### 5. Filter hint bar rendered inside the menu div

Add a small bar at the top of the `.slash-menu` div showing `/ {query}`. Always visible when the menu is open (even with empty query, showing just `/`).

**Why inside the menu**: Keeps it co-located with the results. No extra positioning logic. Consistent with Notion's approach.

### 6. Keep menu open on zero results

Change the plugin's `handleTextInput` behavior: instead of destroying the decoration when `filtered.length === 0`, keep it alive. The UI renders an empty state message. Menu still closes on Escape or clicking outside.

**Why not close**: Closing on zero results is disorienting — the user doesn't know if they mistyped or if the feature doesn't exist. Showing "No matching commands" lets them correct their query.

## Risks / Trade-offs

- **Increased menu height with groups** → Group headers add ~60px total. The `max-height: 320px` may need a bump to ~380px to avoid showing only 2-3 items in the last group before scrolling. Mitigation: test with all groups visible and adjust.
- **Keyboard navigation across groups** → Arrow keys must skip group headers (non-interactive elements). Mitigation: the `selectedIndex` already indexes into the flat command array, so navigation logic doesn't change — only rendering inserts headers between items.
- **Keyword maintenance** → Each new command needs thoughtful keywords. Mitigation: keywords are optional, so forgetting them just means the command falls back to name/label matching.
