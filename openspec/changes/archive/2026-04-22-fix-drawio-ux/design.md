## Context

The draw.io editor is embedded in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`). The host communicates via postMessage and injects custom CSS through draw.io's `configure` action. Three UX bugs stem from incorrect CSS overrides and a scroll restoration script that conflicts with mxGraph internals.

**Current state of each bug:**

1. **Dark theme SVG visibility**: draw.io exports SVGs with transparent backgrounds. The image-extension already tags draw.io images with `.drawio-image` class on the wrapper. No display-layer background is applied.

2. **Menu positioning**: `div.mxPopupMenu { position: fixed !important; }` is injected via CSS config. mxGraph's `getOffset()` returns document-relative coordinates (viewport + scroll), then `popup(x, y)` sets them as `left`/`top`. With `position: fixed`, these document-relative values are interpreted as viewport-relative, placing menus at the wrong location.

3. **Cell editor positioning**: `embed.html` has a script (lines 136-193) that captures scroll on mousedown, restores it on dblclick via `requestAnimationFrame`, and re-restores on editor exit via MutationObserver. This fires before draw.io's `setTimeout`-deferred `resize()`, so the editor's position calculation is based on stale scroll state.

## Goals / Non-Goals

**Goals:**
- Draw.io diagrams are visible in all Kalepin themes (dark and light)
- Menu dropdowns appear directly below the menu bar item that was clicked
- Cell text editor appears overlaying the shape being edited
- Extras menu is hidden in the embedded editor

**Non-Goals:**
- Dark mode for the draw.io editor itself (always light, per existing `color-scheme: light`)
- Modifying vendored draw.io JS (`app.min.js`)
- Changing the SVG export format or post-processing exported SVGs

## Decisions

### 1. Apply white background at the CSS display layer, not on the SVG source

**Choice**: Add `.drawio-image img { background: white; }` in `styles.css`.

**Alternatives considered**:
- Inject `<rect fill="white">` into SVG on export → fragile, needs viewBox parsing, changes source data
- Add `style="background:white"` on SVG root on export → cleaner but still mutates the source file
- CSS on the `<img>` tag → no mutation, works for all diagram sizes, trivially reversible

**Rationale**: The SVG source should stay clean. The rendering context (Kalepin's note view) should decide the background. The `.drawio-image` class already exists on the wrapper.

### 2. Remove `position: fixed` override entirely

**Choice**: Delete the `div.mxPopupMenu { position: fixed !important; }` CSS rule from the configure action.

**Alternatives considered**:
- Convert coordinates in the popup call to viewport-relative → requires patching minified JS
- Keep `position: fixed` and inject a correction script → fragile, fights the framework

**Rationale**: mxGraph's coordinate chain (`getOffset` → `popup` → `fit`) is designed for `position: absolute`. The popup is appended to `document.body`, which is the correct offset parent. In the sandboxed iframe there's no document-level scroll to cause offset issues — the diagram scrolls inside `.geDiagramContainer`, not the body.

### 3. Remove scroll restoration script from embed.html

**Choice**: Delete the entire `waitForContainer` script block (lines 136-193) from `embed.html`.

**Alternatives considered**:
- Monkey-patch `mxCellEditor.prototype.resize` to account for restored scroll → complex, fragile across draw.io versions
- Delay scroll restoration until after `resize()` → unreliable timing (setTimeout vs rAF ordering)

**Rationale**: `scrollCellToVisible()` is draw.io's intended behavior — it pans the canvas so the cell is visible before placing the editor overlay. Fighting it causes the editor to appear at wrong coordinates. The "camera jump" is expected UX in draw.io's embedded mode.

### 4. Fix Extras menu selector

**Choice**: Replace `[title="Extras"]` attribute selector with a text-content-based approach. Since CSS can't match on text content, use `:nth-child()` targeting the Extras menu position, or inject JS in the configure CSS that hides it.

**Alternatives considered**:
- Use `:nth-child(5)` → brittle if menu order changes across draw.io versions
- Accept Extras being visible → it contains settings that don't work well in embed mode

**Rationale**: The most reliable approach is to target the known menu structure. If the selector breaks on a draw.io upgrade, it's a cosmetic issue only — the Extras menu being visible is harmless. Consider using `:nth-last-child(2)` (Extras is second-to-last before Help) for slightly better resilience.

## Risks / Trade-offs

- **[Scroll jump on edit]** → Removing the scroll restoration means users will see the canvas pan to the cell when double-clicking. This is draw.io's standard behavior and happens in draw.io's own hosted editor. Users familiar with draw.io will expect this.

- **[Extras selector fragility]** → Any CSS selector targeting a specific menu item by position can break on draw.io version upgrades. Mitigation: the Extras menu being visible is cosmetic-only; breakage is harmless.

- **[E2E test updates needed]** → The existing tests assert `position: fixed` and scroll drift tolerance. These tests must be updated to match the new behavior. The menu position test should verify the popup appears near the menu bar (top 20% of viewport). The scroll test should be removed or replaced with a test verifying the editor appears on the cell.
