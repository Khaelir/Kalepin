## Why

The draw.io editor integration has three UX bugs that make diagram editing frustrating: (1) exported SVG diagrams are invisible in dark theme because they have a transparent background, (2) menu dropdowns (File, Edit, etc.) appear at the bottom of the screen instead of below the menu bar due to a CSS override that breaks mxGraph's coordinate math, and (3) the cell text editor appears at the top-left corner instead of on the shape because a scroll restoration script fights draw.io's intended positioning behavior.

## What Changes

- Add CSS `background: white` to draw.io images rendered in notes (`.drawio-image img`) so diagrams are always visible regardless of theme
- Remove the `position: fixed !important` CSS injection on `div.mxPopupMenu` — the default `position: absolute` is what mxGraph's coordinate chain expects
- Remove the scroll restoration script from `embed.html` (lines 136-193) that intercepts dblclick and fights `scrollCellToVisible()`, causing the cell editor to misposition
- Fix the Extras menu hide CSS selector — current `[title="Extras"]` doesn't match because menu items don't have a `title` attribute; use a content-based or nth-child selector instead

## Capabilities

### New Capabilities

- `drawio-theme-compat`: Ensure draw.io diagrams render with white background in all Kalepin themes

### Modified Capabilities

- `image-embeds`: draw.io images get theme-aware background styling in note view

## Impact

- **Frontend CSS** (`styles.css`): One new rule for `.drawio-image img`
- **Frontend component** (`drawio-editor-modal.tsx`): CSS injection array modified (remove `position: fixed`, fix Extras selector)
- **Vendored HTML** (`public/drawio/embed.html`): Remove scroll restoration script block (lines 136-193)
- **E2E tests** (`drawio.spec.ts`): Update or remove tests that assert `position: fixed` and scroll drift tolerance
