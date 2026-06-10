## ADDED Requirements

### Requirement: Dim overlay with spotlight cutout
The system SHALL render a full-screen dim overlay (semi-transparent dark backdrop) with a rectangular cutout that reveals and highlights the target UI element. The cutout SHALL match the target element's bounding box with padding and border-radius.

#### Scenario: Coach mark targets a visible element
- **WHEN** a coach mark step specifies a CSS selector target (e.g., `.new-file-btn`)
- **THEN** the overlay dims the entire viewport except for the target element's bounding area

#### Scenario: Target element not found
- **WHEN** a coach mark step specifies a CSS selector that matches no element in the DOM
- **THEN** the coach mark SHALL render as a centered card without a spotlight cutout (same as a step with `target: null`)

### Requirement: Positioned tooltip
The system SHALL render a tooltip adjacent to the spotlight cutout containing the step's title, body text, and controls. The tooltip SHALL support a preferred position (top, bottom, left, right) and SHALL automatically reposition to the opposite or best-fit side if the preferred position would clip the viewport.

#### Scenario: Tooltip fits in preferred position
- **WHEN** a step declares `position: 'bottom'` and there is sufficient viewport space below the target
- **THEN** the tooltip renders below the target element

#### Scenario: Tooltip would clip viewport
- **WHEN** a step declares `position: 'bottom'` but the target is near the bottom of the viewport
- **THEN** the tooltip repositions to the top (or whichever side has the most available space)

### Requirement: Centered card mode
The system SHALL support steps with no target element (`target: null`), rendering the tooltip as a centered card on the dim overlay without a spotlight cutout. Used for welcome and completion steps.

#### Scenario: Step with no target
- **WHEN** a step has `target: null`
- **THEN** the tooltip renders as a centered card over the dim overlay

### Requirement: Progress indicators
The tooltip SHALL display progress dots showing the current step position within the tour (e.g., filled/empty dots or "3 of 10").

#### Scenario: Mid-tour step
- **WHEN** the user is on step 5 of a 10-step tour
- **THEN** the tooltip shows 10 progress dots with the 5th filled/active

### Requirement: Skip and Next controls
Every step SHALL display a [Skip] button that exits the tour and a [Next] button (for passive steps) that advances to the next step. The final step SHALL display [Done] instead of [Next].

#### Scenario: User clicks Skip
- **WHEN** the user clicks [Skip] on any step
- **THEN** the tour ends, the overlay is removed, and the tour is NOT marked as completed

#### Scenario: User clicks Next on passive step
- **WHEN** the user clicks [Next] on a passive step
- **THEN** the tour advances to the next step

#### Scenario: Final step
- **WHEN** the current step is the last step of the tour
- **THEN** the [Next] button is replaced with [Done], and clicking it ends the tour and marks it as completed

### Requirement: Illustration support
The tooltip SHALL support an optional inline illustration (HTML/SVG) rendered within the body area, used for the B-lite pattern (showing mock-up previews of features with empty state).

#### Scenario: Step with illustration
- **WHEN** a step definition includes an `illustration` field (React node)
- **THEN** the tooltip renders the illustration below the body text

### Requirement: Overlay click behavior
Clicking the dim overlay (outside the spotlight cutout and tooltip) SHALL do nothing — it does not dismiss the tour or advance the step. Only the [Skip], [Next]/[Done] buttons and active step actions advance or exit the tour.

#### Scenario: User clicks the dim overlay
- **WHEN** the user clicks the darkened area outside the spotlight and tooltip
- **THEN** nothing happens — the tour remains on the current step
