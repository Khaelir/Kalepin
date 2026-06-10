## ADDED Requirements

### Requirement: Step progression
The tour engine SHALL manage an ordered sequence of steps, tracking the current step index. It SHALL support advancing to the next step (passive: on [Next] click; active: on action completion) and exiting the tour (on [Skip] or [Done]).

#### Scenario: Passive step advances on Next
- **WHEN** the current step is passive and the user clicks [Next]
- **THEN** the engine advances to the next step and the coach mark updates to reflect the new step

#### Scenario: Active step advances on action
- **WHEN** the current step is active and the engine receives a `notifyAction` call matching the step's `waitFor` action ID
- **THEN** the engine advances to the next step

#### Scenario: Active step ignores unrelated actions
- **WHEN** the current step is active with `waitFor: 'file-created'` and the engine receives `notifyAction('slash-menu-opened')`
- **THEN** the engine does not advance — it remains on the current step

### Requirement: Active step action detection
The engine SHALL expose a `notifyAction(actionId: string)` function. When the tour is running and the current step is active, calling `notifyAction` with the step's `waitFor` value SHALL advance the tour. When no tour is running or the current step is passive, `notifyAction` calls SHALL be ignored (no-op).

#### Scenario: notifyAction when tour is not running
- **WHEN** no tour is active and `notifyAction('file-created')` is called
- **THEN** nothing happens

#### Scenario: notifyAction matches current active step
- **WHEN** the current active step has `waitFor: 'slash-menu-opened'` and `notifyAction('slash-menu-opened')` is called
- **THEN** the tour advances to the next step

### Requirement: Tour start
The engine SHALL support starting a tour by ID. Starting a tour SHALL set the current step to the first step and render the coach mark. If another tour is already running, starting a new tour SHALL replace it.

#### Scenario: Start a tour
- **WHEN** `startTour('essentials')` is called
- **THEN** the essentials tour begins at step 1 and the coach mark overlay appears

#### Scenario: Start a tour while another is running
- **WHEN** tour A is on step 3 and `startTour('B')` is called
- **THEN** tour A is stopped (without completion) and tour B starts at step 1

### Requirement: Tour exit
The engine SHALL support exiting via skip (no completion recorded) and via done (completion recorded). Both SHALL remove the coach mark overlay and reset the engine state.

#### Scenario: Skip exits without completion
- **WHEN** the user clicks [Skip]
- **THEN** the tour stops, the overlay is removed, and no completion is recorded

#### Scenario: Done exits with completion
- **WHEN** the user clicks [Done] on the last step
- **THEN** the tour stops, the overlay is removed, and the tour is marked as completed (triggers persistence)

### Requirement: Spotlight repositioning on resize
The engine SHALL recalculate the spotlight cutout position when the window is resized or scrolled, keeping the cutout aligned with the target element.

#### Scenario: Window resized during tour
- **WHEN** the browser window is resized while a coach mark is visible
- **THEN** the spotlight cutout and tooltip reposition to match the target element's new bounding box

### Requirement: Step-level callbacks
Each step definition SHALL support optional `onEnter` and `onExit` callbacks, invoked when the step becomes active or when the step is left. Used for side effects like pre-filling the InputModal or dismissing the slash menu.

#### Scenario: Step with onEnter callback
- **WHEN** the tour advances to a step that has an `onEnter` callback
- **THEN** the callback is invoked before the coach mark renders for that step
