## Context

Kalepin is a collaborative markdown workspace (React + NestJS). The frontend is a monolithic `App.tsx` with `useState` hooks, no state management library, no router. UI patterns include modals (search, input), context menus, toasts, and collapsible sidebar panels. There is no existing onboarding, first-time detection, or tutorial infrastructure.

The user entity is minimal (id, email, displayName, createdAt, lastActiveAt) stored in SQLite via TypeORM. The frontend communicates via REST (`api.ts`) and WebSocket (`ws-client.ts`).

## Goals / Non-Goals

**Goals:**
- Guide new users through Kalepin's core features with a 10-step essentials tour
- Surface new features to existing users via non-intrusive toast banners
- Allow replaying any tour at any time via a [?] toolbar button and a Settings > Tutorials section
- Persist tour completion state per user on the backend, synced across devices
- Build a modular, extensible tour system where adding a new feature tour is declarative

**Non-Goals:**
- Analytics or tracking of tutorial engagement
- A/B testing different tour flows
- Tooltip-based contextual hints outside of tours (future consideration)
- Tour editor or admin UI for non-developers
- Internationalization of tour content (English only for now)

## Decisions

### 1. Coach mark rendering: CSS box-shadow spotlight vs. clip-path vs. SVG overlay

**Decision**: CSS `box-shadow` with a massive spread on the spotlight element.

A single `<div>` is positioned over the target element using `getBoundingClientRect()`. It gets a transparent background with `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` to dim everything outside. The tooltip is a sibling `<div>` positioned relative to the cutout.

**Alternatives considered**:
- `clip-path` on a full-screen overlay: more precise cutout shapes, but requires recalculating the polygon on scroll/resize and is harder to animate.
- SVG overlay with `<mask>`: most flexible, but heavier DOM and unnecessary complexity for rectangular cutouts.

**Rationale**: Box-shadow is the simplest approach, works for rectangular highlights (which is all we need since UI elements are rectangular), handles rounded corners via `border-radius`, and is trivially animatable. Used by Shepherd.js and other popular tour libraries.

### 2. Active step detection: event bus vs. state observation vs. DOM polling

**Decision**: Direct callback injection — the tour engine provides callbacks that `App.tsx` invokes at key moments.

The tour engine exposes a `notifyAction(actionId: string)` function. When the tour is active and waiting for an action, `App.tsx` calls `notifyAction('file-created')` after a file is created, `notifyAction('slash-menu-opened')` when the slash menu opens, etc. The tour step definition declares which `actionId` it waits for.

**Alternatives considered**:
- Custom event bus (EventEmitter): adds a new communication pattern when the app already uses props/callbacks.
- MutationObserver/DOM polling: fragile, depends on DOM structure, breaks if CSS classes change.
- Zustand/external store: over-engineered for this — the app uses no state management library.

**Rationale**: Matches the existing pattern of callback props in `App.tsx`. No new abstractions. The tour engine is a hook (`useTour`) that lives in `App.tsx` and has direct access to state. Active steps are a small set (~4 in essentials) so the integration surface is minimal.

### 3. Tour registry: JSON/config file vs. code-defined

**Decision**: TypeScript-defined tour objects in a `tours/` directory.

Each tour is a typed object with steps, metadata, and version. The registry is a simple array import. Example:

```ts
export const essentialsTour: TourDefinition = {
  id: 'essentials',
  version: 1,
  name: 'Getting Started',
  description: 'Learn the basics of Kalepin',
  steps: [
    { id: 'welcome', type: 'passive', target: null, title: '...', body: '...' },
    { id: 'create-note', type: 'active', target: '.new-file-btn', waitFor: 'file-modal-opened', ... },
    // ...
  ],
};
```

**Alternatives considered**:
- JSON config files: loses TypeScript type safety, harder to include illustrations as components.
- Database-stored tours: unnecessary, tours are part of the app code and versioned with it.

**Rationale**: Type-safe, co-located with the UI, easy to add new tours (copy a template, fill in steps). Version field enables "what's new" detection — if a tour's version bumps, users who completed the old version see the toast.

### 4. Persistence: backend column shape

**Decision**: A JSON column `completedTours` on the user entity storing `{ tourId: string, version: number }[]`.

Example: `[{"tourId":"essentials","version":1},{"tourId":"comments","version":1}]`

**Alternatives considered**:
- Separate `completed_tours` table: normalized but overkill for a small array per user.
- localStorage-only: lost on device switch or browser clear.

**Rationale**: Simple, queryable enough (just need to load on login), and the array will never exceed ~20 entries. JSON column in SQLite via TypeORM's `simple-json` type.

### 5. Tutorial note lifecycle

**Decision**: Create a real note named `Tutorial - {username}` (derived from email prefix). On tour completion (step 10), prompt the user with [Keep it] / [Delete it]. If the user skips mid-tour, the note remains — it's a real file they created.

**Rationale**: No sandboxing complexity. The username suffix avoids collisions in the shared vault. The prompt at the end respects user agency — some may want to keep exploring in it. If skipped, the note is just a regular file.

### 6. Tooltip positioning

**Decision**: 4-position system (top, bottom, left, right) with automatic fallback.

Each step can declare a preferred position. The `CoachMark` component measures available space using `getBoundingClientRect()` on mount and on window resize. If the preferred position would clip the viewport, it falls back to the opposite side, then to whichever side has the most space.

**Rationale**: Simple algorithm, covers all cases. The editor layout is predictable (sidebar left, editor center, panel right) so most positions will work on first attempt.

### 7. [?] button behavior

**Decision**: A `?` button in the editor header (next to the search button). Clicking it opens a small dropdown listing available tours with completion status. Clicking a tour starts/restarts it.

**Rationale**: Consistent with the existing toolbar pattern (search btn, backlinks btn, changes badge). Dropdown is lightweight — no need for a full modal. Settings page has the fuller list with descriptions.

### 8. New feature notification

**Decision**: On login, compare the user's `completedTours` against the tour registry. For any tour where the registry version is higher than the completed version (or the tour was never completed), show a toast: `"New: {tourName}! [Take the tour] [Dismiss]"`. Only show one toast at a time (most recent new tour). Dismissing marks it as "seen" without completing it (store `{ tourId, version, dismissed: true }` or a separate `dismissedTours` array).

**Rationale**: Non-intrusive. Toast is an existing pattern. One toast at a time prevents notification fatigue. Dismiss ≠ complete — the tour stays available in the [?] menu.

### 9. Changes panel illustration (B-lite)

**Decision**: An inline SVG or static image embedded in the tooltip for the "See what changed" step. Shows a mock-up of what a populated changes panel looks like — a few lines of fake entries styled identically to the real component.

**Alternatives considered**:
- Screenshot image: would need to be maintained as UI evolves, creates an asset dependency.
- Inline SVG illustration: styled to match the app's design tokens, maintainable in code.

**Decision**: Inline SVG/HTML rendered directly in the tooltip component. Styled with the same CSS variables as the real changes panel so it stays in sync with theme changes.

## Risks / Trade-offs

- **Active step fragility** — If the UI changes (e.g., New File button moves, slash menu behavior changes), active steps may break silently. → Mitigation: Each step targets elements by CSS class (`.new-file-btn`, `.slash-menu`), and the tour gracefully skips steps whose target element is not found, showing a warning toast.

- **Tour/app coupling** — The tour engine hooks into `App.tsx` state and callbacks, creating coupling. → Mitigation: The integration surface is small (~5 `notifyAction` calls). Tour definitions reference CSS selectors, not component internals.

- **Shared vault collisions on tutorial note** — Two users onboarding simultaneously could both create `Tutorial - {name}` if they share an email prefix. → Mitigation: Extremely unlikely with full email-prefix usernames. If it happens, the second creation just appends content to the existing file — not harmful.

- **Tour version inflation** — If feature tours are updated frequently, users may get toast fatigue. → Mitigation: Only bump version for significant changes. Toast shows at most one new tour per login.
