## 1. Backend — Persistence

- [x] 1.1 Add `completedTours` column (JSON, default `[]`) to user entity and create TypeORM migration
- [x] 1.2 Add `GET /api/users/me/tours` endpoint returning the user's completedTours array
- [x] 1.3 Add `PUT /api/users/me/tours` endpoint accepting `{ tourId, version }` and upserting in the user's completedTours

## 2. Frontend — Coach Mark Component

- [x] 2.1 Create `CoachMark` component: dim overlay with box-shadow spotlight cutout, positioned tooltip, progress dots, [Skip]/[Next]/[Done] buttons
- [x] 2.2 Add tooltip auto-positioning logic (preferred position with viewport fallback)
- [x] 2.3 Add centered card mode for steps with `target: null`
- [x] 2.4 Add illustration slot support in tooltip body
- [x] 2.5 Add resize/scroll listener to reposition spotlight cutout on layout changes
- [x] 2.6 Style coach mark components (overlay, tooltip, dots, buttons) using existing CSS variables

## 3. Frontend — Tour Engine

- [x] 3.1 Create `useTour` hook managing tour state: current tour, current step index, active/stopped status
- [x] 3.2 Implement `startTour(tourId)`, `nextStep()`, `skipTour()`, `completeTour()` actions
- [x] 3.3 Implement `notifyAction(actionId)` for active step advancement
- [x] 3.4 Add `onEnter`/`onExit` step callback invocation on step transitions
- [x] 3.5 Wire tour completion to `PUT /api/users/me/tours` persistence call and local state update

## 4. Frontend — Tour Registry & Definitions

- [x] 4.1 Define `TourDefinition` and `TourStep` TypeScript types
- [x] 4.2 Create tour registry module (array of all tour definitions, lookup by ID)
- [x] 4.3 Create essentials tour definition (10 steps, targets, action IDs, copy text)
- [x] 4.4 Create B-lite illustration component for the changes panel step (inline HTML/SVG mock-up styled with app CSS variables)

## 5. Frontend — Essentials Tour Integration

- [x] 5.1 Add `notifyAction` calls in App.tsx: file-modal-opened, file-created, slash-menu-opened, table-inserted
- [x] 5.2 Pre-fill InputModal with "Tutorial - {username}" when essentials tour step 3 is active (via step onEnter callback)
- [x] 5.3 Implement tutorial note cleanup prompt in final step: [Keep it] calls completeTour(), [Delete it] deletes the file then calls completeTour()
- [x] 5.4 Add auto-trigger logic: on login, fetch completed tours, start essentials if not completed

## 6. Frontend — Feature Tour Notifications

- [x] 6.1 Add logic to compare completedTours vs. registry on login and identify unseen/updated tours
- [x] 6.2 Show toast banner for new feature tour: "{name} is here! [Take the tour] [Dismiss]"
- [x] 6.3 Wire [Take the tour] to startTour() and [Dismiss] to close toast
- [x] 6.4 Suppress feature toasts during active tour and for features covered by essentials

## 7. Frontend — Replay UI

- [x] 7.1 Add `?` button to editor header (next to search button)
- [x] 7.2 Create help dropdown component listing all tours with completion status (checkmark indicator)
- [x] 7.3 Wire dropdown tour selection to startTour()
- [x] 7.4 Add "Tutorials" section to SettingsPage with tour list, descriptions, status, and [Replay]/[Start] buttons
- [x] 7.5 Wire Settings tour buttons to switch view to workspace and start the selected tour

## 8. Frontend — API Client

- [x] 8.1 Add `getCompletedTours()` and `updateCompletedTour(tourId, version)` functions to api.ts
