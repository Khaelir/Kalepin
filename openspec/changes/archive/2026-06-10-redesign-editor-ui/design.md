## Context

Kalepin's current frontend (`packages/frontend/src/`) is a working React 19 + TipTap 3 app with OT collaboration, comments, backlinks, version history, and magic-link auth. The UI evolved organically:

- **Shell**: Two-column flex (`.workspace`): `.sidebar` (260px) + `.editor-area` (flex:1), with `.comments-sidebar` toggled inside `.editor-area`'s right side.
- **Tokens**: `styles.css` defines ~15 CSS custom properties under `:root` and `:root.light-mode`. No density, accent, or font variants.
- **Right panel**: Single-slot — swaps between `CommentsPanel`, `BacklinksPanel`, `VersionHistoryPanel`. No tab strip.
- **Editor header**: Inline in `App.tsx` (breadcrumb + presence + buttons); no title/tags/meta block in the doc itself.
- **Block chrome**: TipTap renders prose without per-block gutter handles.
- **Scroll markers**: `CommentScrollMarkers` annotate the native editor scrollbar with comment dots. Superseded by the new floating mini-map.
- **No top bar, no status bar, no selection bubble, no tweaks panel, no outline tab.**

The design handoff is a React-via-Babel prototype (HTML/CSS/JSX) — visual reference only. The task is to recreate it in the existing codebase with Kalepin branding instead of LuceApp/BH.

Constraints:
- Must keep the existing OT/comments/backlinks/version/presence data flow working through the migration.
- Must keep Obsidian-compatible markdown-on-disk behavior (no change to how docs are stored).
- Must not regress the existing coach-mark tour (`tours/essentials.tsx`) — steps reference DOM selectors like `.sidebar-actions`, `.editor-breadcrumb`, etc., that will need updates.
- Desktop 1440px only; no mobile work in this change.

## Goals / Non-Goals

**Goals:**
- Pixel-match the handoff prototype for the 10 surfaces listed in `proposal.md`'s "New Capabilities".
- Kalepin-branded tokens (`--kalepin-*`) with light+dark, density, accent, and editor-font variants.
- No behavior regressions: OT, comments, backlinks, presence, version history, search, slash menu, tour all keep working.
- Ship in phases — token system first, then shell, then per-surface — so each PR is reviewable.

**Non-Goals:**
- No backend changes. Activity feed, richer presence cursors, and rev-counter telemetry are deferred.
- No mobile/tablet responsive layout.
- No a11y audit beyond keeping existing keyboard shortcuts working.
- No icon library swap — keep the existing inline SVGs. Optionally load Material Symbols Rounded for the icons the prototype shows, but don't ship a hard dependency.
- No image avatars — initials only (matches prototype).
- No edit-mode postMessage bridge — prototype-only.

## Decisions

### 1. Token system: full replacement, not additive

**Chosen**: Rewrite `styles.css` top section with the full `--kalepin-*` token set from the prototype. Map existing class selectors to the new tokens. Delete `--bg-primary`, `--accent`, etc.

**Alternatives considered**:
- *Additive (keep old tokens, add new)*: Rejected — leaves dead code, invites inconsistency, and the old scale doesn't cover density/accent/font-family variants the design relies on.
- *Per-component scoped tokens*: Rejected — CSS custom properties at `:root` are simpler and the prototype already assumes this.

**Why**: The old token scale is small (~15 vars) and every component already references it. A focused search-replace + rewrite is cleaner than maintaining two systems.

### 2. Naming: `--kalepin-*` prefix, not `--luce-*`

**Chosen**: `--kalepin-primary`, `--kalepin-bg`, `--kalepin-text-default`, etc. Status tokens keep semantic names: `--kalepin-color-success`, `--kalepin-color-warning`.

**Rationale**: Kalepin has no relationship to the LuceApp/BH design system; keeping `--luce-*` names would be confusing and would drift from any future Kalepin-native design guidance.

### 3. Shell: CSS Grid, not nested flex

**Chosen**: `.workspace { display: grid; grid-template-columns: 260px 1fr 320px; grid-template-rows: 52px 1fr 28px; }`. Top bar spans all 3 columns, status bar spans all 3 columns, middle row has sidebar | editor | right rail.

Collapsing a column sets its width to `0` (not `display:none` — we keep children mounted for cheaper reopening). Same for the status bar row via `grid-template-rows`.

**Alternatives considered**:
- *Keep flex*: Rejected — flex can't span the top and status bars across the sidebar without either duplication or wrapper churn.

### 4. Right rail: tab strip inside existing `.comments-sidebar` slot

**Chosen**: Keep the aside element, replace its header with a tab strip (Comments / Backlinks / Activity / Outline), render the active tab's panel below. Active tab state persists in `useState` (UI-only).

**Rationale**: Minimizes churn in `App.tsx` — the existing `rightPanel` state already tracks which panel is shown; it just becomes the active tab.

### 5. Mini-map: standalone component, positioned outside editor scroll container

**Chosen**: New `editor/FloatingMinimap.tsx`. Renders in a portal or absolute-positioned element anchored to the editor column. Observes:
- Editor scroll position (via `onScroll` on the prose container).
- Heading offsets (via an `IntersectionObserver` or `getBoundingClientRect` walk on mount + ResizeObserver).
- Comment threads (via the existing `comments` prop, already indexed by quoted text / position).

**Why not reuse `CommentScrollMarkers`**: That component draws onto the native scrollbar — fundamentally different positioning model. The new mini-map is its own strip; we delete `CommentScrollMarkers` once the mini-map is shipped.

**Positioning math** (per handoff): walk `offsetParent` chain for heading offset — do NOT use `offsetTop` alone, because paragraph elements have `position: relative` for their gutter handles.

### 6. Block gutter: TipTap decoration or node-view wrapper?

**Chosen**: CSS-only `:hover` pseudo-element approach using a sibling absolute-positioned element, driven by a TipTap ProseMirror plugin that adds `data-block-hover` attributes on hover. No new node views — the existing Paragraph/Heading/etc. nodes keep their current structure.

**Alternatives considered**:
- *Custom node views for every block type*: Rejected — huge surface area, disrupts existing extensions, and complicates OT.
- *Pure CSS hover on every block*: Rejected — the `add` button needs to know the block's document position to insert a paragraph below it; that requires JS.

**Why**: Keeps existing TipTap extensions untouched; handles are layered on top.

### 7. Selection bubble: ProseMirror plugin tied to selection, not BubbleMenu extension

**Chosen**: Custom component subscribed to the editor's selection updates. Positions itself above the `getBoundingClientRect()` of the selection range.

**Rationale**: TipTap's `BubbleMenu` extension works but ties us to its styling conventions. A custom component gives us the exact 36px-tall pill with our divider + Comment/Ask-AI buttons. Reuses the existing `addComment` API.

### 8. Tweaks panel: state tree, localStorage persistence

**Chosen**: A single `useReducer`-backed `tweak` state object:

```ts
type Tweak = {
  theme: 'light' | 'dark';
  accent: 'orange' | 'blue' | 'green' | 'purple' | 'rose';
  density: 'compact' | 'comfortable' | 'spacious';
  editorFont: 'serif' | 'sans';
  sidebar: boolean;
  rail: boolean;
  minimap: boolean;
};
```

Applies via `document.documentElement.dataset.*` attributes; CSS selectors like `html[data-density='compact']` override density tokens. Persists to `localStorage['kalepin-tweaks']`. Migrates the existing `kalepin-theme` storage key on first run.

### 9. Activity tab: placeholder only, backend deferred

**Chosen**: Ship an `ActivityPanel` component that renders an empty-state card ("Activity feed coming soon — follow progress in …"). No data fetching.

**Rationale**: The design requires the tab to exist for the tab strip to be whole; the backend doesn't have an activity endpoint; shipping a fake feed is misleading.

### 10. Outline tab: client-side heading observer

**Chosen**: `OutlinePanel` reads headings from the TipTap document (via `editor.state.doc.descendants`) and subscribes to editor updates. Tracks currently-visible heading via `IntersectionObserver` on the rendered heading DOM nodes.

**Why not backend**: Headings are a pure view of the current in-memory doc; a round trip adds latency for no gain.

### 11. Fonts: bundle Lato locally, load Source Serif 4 + JetBrains Mono from Google Fonts

**Chosen**:
- Lato (UI): bundle TTF in `public/fonts/` and `@font-face` declare.
- Source Serif 4 (optional reading font): Google Fonts `<link>` in `index.html`.
- JetBrains Mono (code): Google Fonts.
- Material Symbols Rounded: not bundled; keep existing SVG icons. Icons shown in the prototype that we don't already have can be added as inline SVG alongside existing ones.

**Rationale**: Matches the handoff's font strategy; avoids adding a build-time font pipeline.

### 12. Phased rollout — 10 phases, each own PR

Each phase is a small, shippable slice. Phases 1–3 can land without user-visible changes (tokens invisible, shell swap is a no-op visually until phase 4+). Phase numbering matches `tasks.md`.

1. Token system (invisible)
2. App shell grid (structural, minimal visual)
3. Sidebar redesign
4. Top bar
5. Status bar
6. Doc header + block gutter
7. Right rail tabs + Outline + Activity placeholder
8. Floating mini-map
9. Selection bubble
10. Tweaks panel + overlay polish

### 13. Tour selectors: update in lockstep

**Chosen**: As each phase renames/moves DOM, update `tours/essentials.tsx` step selectors in the same PR. Verify the tour still completes end-to-end before merging.

**Rationale**: Tour breakage is easy to miss in review; co-locating the fix keeps it from falling behind.

## Risks / Trade-offs

- **Scope creep** → Split into 10 phases; each phase is reviewable and can be paused without leaving the UI broken.
- **Tour breakage from DOM selector changes** → Every phase updates `tours/essentials.tsx` in the same PR and a manual tour run is part of the phase acceptance.
- **Mini-map positioning bug on nested positioned ancestors** → Walk `offsetParent` chain as the handoff instructs; add a unit test with a fixture DOM that has nested `position: relative` ancestors.
- **Block-gutter hover jitter with large docs** → Use event delegation on the editor root, not one listener per block; throttle with `requestAnimationFrame`.
- **Localstorage schema drift** → Migrate `kalepin-theme` → `kalepin-tweaks.theme` on first load; keep a `version` field on the tweaks object for future migrations.
- **Tokens rename breaks third-party overrides** → No third-party consumers of these CSS vars exist; Kalepin is self-hosted and single-app. Safe.
- **Density token affecting OT cursor position math** → OT cursor positions are DOM-measured live, not cached, so density changes don't misalign cursors once the new layout settles in.
- **Inline styles in `App.tsx` for breadcrumb etc. are numerous** → Phase 2 moves these into class-based rules; accept a larger diff for cleaner subsequent phases.

## Migration Plan

- **No data migration** — this is UI-only. Comments, docs, versions, stars all keep their existing schemas.
- **Per-phase rollout**: Each phase lands behind a feature-flag-free merge; there's no staged ramp. If a phase lands broken, revert the phase commit.
- **Tweaks persistence migration**: On first load after phase 10 merges, read legacy `kalepin-theme` from localStorage, seed the new `kalepin-tweaks` object, then delete the old key.
- **Rollback**: Each phase is a separate PR/commit; revert the phase. Since phases are visually additive past phase 4, a mid-phase revert leaves the UI partially new but functional.

## Open Questions

- **Share button** in the top bar — does it open the existing share-link modal, or a new share dialog? (Proposal: open the existing `createShareLink` flow as a popover.)
- **"Daily note" quick action** in the sidebar — is this a new feature or does it open a date-named file? (Proposal: defer; render the row but disable it with a "Coming soon" tooltip.)
- **Workspace switcher** — Kalepin currently has no multi-workspace concept. Render as static "Kalepin" label with no chevron? (Proposal: yes — chevron only when more than one workspace exists, which is never today.)
- **Tab pill in the top bar** — "Read · Edit · History · Comments". Kalepin has no dedicated Read/Edit mode (editor is always editable) and no "Comments-only" mode. Which tabs actually make sense? (Proposal: keep "Edit" and "History" as the two tabs; "Read" and "Comments" are the hover states of the right rail and editor, not separate modes.)
- **Mini-map + version-preview banner** — do they stack or exclude each other? (Proposal: hide the mini-map when `versionPreview` is active.)
