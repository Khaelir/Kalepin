## Why

Kalepin has no onboarding experience. New users land in the workspace with no guidance on how to create notes, use slash commands, search, comment, or check changes. There's also no mechanism to surface new features to existing users. An interactive tutorial system with coach marks solves both: it onboards new users with a guided essentials tour, and notifies existing users of new features with short micro-tours.

## What Changes

- **Coach mark component**: Dim overlay with spotlight cutout on target elements, positioned tooltip with text/illustrations, progress dots, [Skip] and [Next] buttons. Steps can be "active" (wait for user action to advance) or "passive" (advance via [Next]).
- **Tour engine**: Manages step progression, active step detection (listens to app state changes), spotlight positioning relative to target elements, and overlay rendering.
- **Tour registry**: Declarative collection of tour definitions. Each tour has an ID, a version, and an ordered list of steps. Ships with an "essentials" tour (10 steps) and placeholder feature tours for comments, search, slash-commands, and changes.
- **Essentials tour (10 steps, 4 active / 6 passive)**: Welcome → Create note (active, pre-filled "Tutorial - {username}") → Name it (active) → Type / (active) → Select /table (active) → Slash commands explained → Search Cmd+K → Comments → Changes with illustration in tooltip → Done with delete tutorial note prompt.
- **New feature toast**: When a user has unseen feature tours, a toast banner appears: "X is here! [Take the tour] [Dismiss]".
- **[?] button in editor toolbar**: Quick access to replay any tour via a dropdown.
- **Settings > Tutorials page**: Full list of all tours with completion status and replay buttons.
- **Backend storage**: New `completedTours` field on the user entity (JSON string array of tour IDs with versions). New REST endpoint to read/update completed tours.
- **Tutorial note cleanup**: On essentials tour completion, final step prompts "Delete Tutorial - {username}?" with [Keep it] and [Delete it] options.

## Capabilities

### New Capabilities
- `coach-marks`: Reusable coach mark UI component with dim overlay, spotlight cutout, positioned tooltip, progress dots, illustration support, skip/next controls
- `tour-engine`: Tour progression engine supporting passive and active steps, with event-based detection of user actions for active step advancement
- `tour-registry`: Declarative tour definitions with versioning, consumed by the tour engine to drive coach marks
- `essentials-tour`: 10-step onboarding tour for new users covering file creation, slash commands (/table), search, comments, and changes
- `feature-tour-notifications`: Toast banner system for surfacing unseen feature tours to existing users
- `tutorial-persistence`: Backend storage of completed tours per user, REST API for read/update
- `tutorial-replay-ui`: [?] button in editor toolbar dropdown + Settings > Tutorials section for replaying tours

### Modified Capabilities

## Impact

- **Frontend**: New `CoachMark` component, `TourEngine` hook/context, `TourRegistry` module, `TutorialButton` in editor header, `TutorialsSection` in settings page. Modifications to `App.tsx` for tour triggering on login.
- **Backend**: New `completedTours` column on user entity (string[] stored as JSON), new `GET/PUT /api/users/me/tours` endpoints.
- **Database**: One column addition to users table (TypeORM migration).
- **Dependencies**: None — coach marks built with vanilla CSS (overlay + box-shadow/clip-path for cutout), positioning with `getBoundingClientRect()`.
- **Assets**: One illustration image for the changes panel tooltip (B-lite pattern).
