## 1. Data Model — group and keywords

- [x] 1.1 Add `group` and `keywords` optional fields to the `SlashCommand` interface in `slash-commands.ts`
- [x] 1.2 Define the `SLASH_COMMAND_GROUPS` constant array with group keys and display labels (basic, insert, diagrams)
- [x] 1.3 Assign `group` values to all 11 existing commands: basic (heading, task, divider, callout), insert (table, code, link, image), diagrams (mermaid, drawio, toc)
- [x] 1.4 Add `keywords` arrays to all commands (e.g., Task → ["todo","checkbox","list"], Callout → ["quote","note","aside","blockquote"], Image → ["picture","photo","upload","img"], etc.)

## 2. Grouped rendering

- [x] 2.1 Update the menu rendering in `Editor.tsx` to show group section headers when no query is active — iterate `SLASH_COMMAND_GROUPS`, render header then matching commands
- [x] 2.2 Add CSS for `.slash-menu-group-header` — small, muted, uppercase, non-interactive, with top margin for spacing between groups
- [x] 2.3 Verify keyboard navigation (ArrowUp/Down) correctly skips group headers since `selectedIndex` indexes into the flat command array

## 3. Improved filtering with keywords and ranking

- [x] 3.1 Update the filter logic in the ProseMirror plugin to match query against `name`, `label` (case-insensitive), AND `keywords` (case-insensitive)
- [x] 3.2 Implement match-quality scoring: exact name (100), label startsWith (80), name/label contains (60), keyword startsWith (40), keyword contains (20)
- [x] 3.3 Sort filtered results by score descending, preserving definition order for ties
- [x] 3.4 Ensure filtered results render as a flat list (no group headers) when a query is present

## 4. Filter hint bar

- [x] 4.1 Add a hint bar element at the top of `.slash-menu` showing `/ {query}` with a small `Esc` dismiss label
- [x] 4.2 Add CSS for `.slash-menu-hint` — subtle background, muted text, separated from commands by a divider
- [x] 4.3 Ensure the hint bar updates live as the user types after `/`

## 5. No-results empty state

- [x] 5.1 Update the plugin to keep the menu open when `filteredCommands` is empty (do not destroy the decoration on zero matches)
- [x] 5.2 Add empty state rendering in `Editor.tsx` — show "No matching commands" centered in muted text when `filteredCommands.length === 0`
- [x] 5.3 Verify Escape key and click-outside still dismiss the menu in the empty state
- [x] 5.4 Verify backspacing to a valid query recovers from empty state to showing results
