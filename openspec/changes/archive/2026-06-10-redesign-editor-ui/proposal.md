## Why

The current Kalepin UI grew organically — sidebar + editor header + a swap-style right panel. The `design_handoff_kalepin/` HTML prototype is a full, high-fidelity redesign that introduces a consistent app shell (top bar · sidebar · editor · right rail · status bar), a proper token system, new context surfaces (outline, floating mini-map, selection bubble, tweaks panel), and a redesigned editor chrome (title block, per-block gutter handles, presence gutter). We want to adopt it as the product UI.

## What Changes

- **BREAKING (UI-only)**: Replace the current app shell (sidebar + main + collapsible right sidebar) with a 5-area CSS grid (top bar · sidebar · editor · right rail · status bar). All chrome moves.
- **Rebrand**: Every `--luce-*` token becomes `--kalepin-*`. Drop BH Technologies wordmark/logo; use Kalepin's own brand mark. Brand colors stay (orange/blue) but are named as Kalepin's, not BH's.
- **Token system**: Introduce a full CSS custom-property system with light/dark themes, density (compact/comfortable/spacious), editor-font (serif/sans), and accent-color variables.
- **Top bar (new)**: Workspace switcher, breadcrumb path, inline tags + status pill, tab pill (Read / Edit / History / Comments), presence stack, search/share/overflow actions.
- **Sidebar redesign**: Vault header with sync dot, quick-action rows (Search · Daily note · Graph), Starred & Recent sections, per-row presence dots + comment count pill + unread dot.
- **Editor chrome (new)**: Title block (breadcrumb, title, subtitle, tag row, meta row, presence gutter) above the prose.
- **Per-block left gutter**: Drag-handle + add-button appear on hover; drag opens slash menu, add inserts a new paragraph.
- **Right rail**: Tab strip with Comments / Backlinks / Activity / Outline (replaces the current single-panel swap).
- **Floating mini-map (new)**: Right edge of editor, scroll-synced viewport indicator + heading ticks + comment markers; expands to labeled TOC on hover.
- **Status bar (new)**: Sync status, saved-to-disk indicator, collaborator count, doc metadata.
- **Selection bubble (new)**: Floating formatting toolbar above selected prose (B/I/S/U, code, wiki-link, link, quote, H2/H3, Comment, Ask AI).
- **Tweaks panel (new)**: Runtime theme/accent/density/font/layout toggles in a floating card.
- **Overlays polished**: Search modal and slash menu redesigned to match the new visual language (structure unchanged).
- **Deferred**: Activity tab renders a placeholder (no backend feed); outline tracker uses client-side heading-observer; sync revision in status bar uses the existing OT revision from `useSaveStatus`.

## Capabilities

### New Capabilities

- `design-tokens`: Kalepin's CSS custom-property system — brand/status/surface/typography/spacing/radii/shadow tokens, light+dark themes, density and font variants.
- `app-shell`: 5-area grid layout (top bar · sidebar · editor · right rail · status bar) with per-area collapse rules controlled by tweaks state.
- `top-bar`: Workspace chrome — workspace switcher, breadcrumb path, inline tags + status pill, tab pill, presence stack, action cluster.
- `status-bar`: Bottom bar surfacing sync/save/collab status on the left and doc metadata on the right.
- `doc-header`: Editor-internal header — breadcrumb, editable title, subtitle, tag row, meta row, left-gutter presence avatars.
- `block-gutter`: Per-block left gutter with hover-revealed drag handle (opens slash menu) and add button (inserts paragraph below).
- `floating-minimap`: Right-edge TOC strip with scroll-synced viewport indicator and comment markers; expands to labeled headings on hover.
- `selection-bubble`: Floating formatting toolbar anchored to non-empty text selections inside the prose.
- `tweaks-panel`: Runtime preferences UI — theme, accent color, density, editor font, sidebar/rail/minimap visibility — persisted to localStorage and then user profile.
- `outline-panel`: Right-rail Outline tab listing current-doc headings with scroll-sync and click-to-jump.
- `activity-panel`: Right-rail Activity tab placeholder — renders an empty-state card until the backend activity feed exists.

### Modified Capabilities

- `backlinks-ui`: Backlinks move from a swap panel (replacing other sidebar panels) into the right rail's Backlinks tab — tab state replaces one-panel-at-a-time behavior.
- `presence`: Render surfaces expand — existing presence data feeds both the top bar avatar stack (with hover cards) and the editor-gutter presence column, in addition to in-editor cursors.
- `scrollbar-comment-markers`: **REMOVED** — superseded by `floating-minimap`'s comment markers. Native-scrollbar gutter strip is deleted once the mini-map ships.

Visual-only changes to existing capabilities — `editor`, `comments`, `star-files`, `full-text-search`, `slash-menu-groups`, `share-links` — don't change spec requirements and are handled as implementation details in `tasks.md`.

## Impact

- **Affected code**:
  - `packages/frontend/src/styles.css` — full rewrite around new token system
  - `packages/frontend/src/App.tsx` — shell layout, new top bar, status bar, tweaks state
  - `packages/frontend/src/components/*` — most components touched visually; some restructured (right rail tabs, sidebar sections)
  - `packages/frontend/src/editor/Editor.tsx` — doc header, block gutter node views, selection bubble
  - New files: `components/TopBar.tsx`, `StatusBar.tsx`, `TweaksPanel.tsx`, `RightRail.tsx`, `OutlinePanel.tsx`, `ActivityPanel.tsx`, `editor/FloatingMinimap.tsx`, `editor/SelectionBubble.tsx`, `editor/DocHeader.tsx`, `editor/BlockGutter.tsx`
- **APIs**: No backend changes required for phase 1. Activity feed, heading-observer, and any new presence cursor data are deferred.
- **Dependencies**: No new runtime deps. Fonts (Lato TTF bundled, Source Serif 4 + JetBrains Mono via Google Fonts). Material Symbols Rounded for icons (keeps existing SVG icons as fallback — swap over time).
- **Persistence**: Tweaks panel state → `localStorage` (future: user profile). No schema changes.
- **Deferred for follow-up changes**:
  - Activity feed backend endpoint (powers real Activity tab)
  - Mobile/tablet layout (out of scope — design is 1440px desktop)
  - Image avatars (design uses initials only for now)
  - A11y audit (tab order, ARIA, screen reader labels)
