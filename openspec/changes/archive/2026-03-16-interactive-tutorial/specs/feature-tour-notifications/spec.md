## ADDED Requirements

### Requirement: Toast banner for unseen tours
When a user logs in, the system SHALL compare their `completedTours` against the tour registry. For each tour that is new (never completed) or updated (registry version > completed version), the system SHALL show a toast notification. Only one tour toast SHALL be shown at a time (the most recently added tour).

#### Scenario: One new feature tour available
- **WHEN** user logs in and the "backlinks" tour (version 1) exists in the registry but not in the user's completedTours
- **THEN** a toast appears: "New: Backlinks! [Take the tour] [Dismiss]"

#### Scenario: Multiple new tours available
- **WHEN** user logs in and both "backlinks" and "images" tours are unseen
- **THEN** only one toast appears (the most recently added tour by registry order)

#### Scenario: No new tours
- **WHEN** user logs in and all tours in the registry are completed at their current version
- **THEN** no tour toast is shown

### Requirement: Toast actions
The tour toast SHALL have two actions: [Take the tour] which starts the tour immediately, and [Dismiss] which closes the toast without starting the tour. Dismissing SHALL NOT mark the tour as completed — it remains available in the [?] menu and Settings.

#### Scenario: User clicks Take the tour
- **WHEN** the user clicks [Take the tour] on a toast for "backlinks"
- **THEN** the toast closes and the backlinks tour starts at step 1

#### Scenario: User clicks Dismiss
- **WHEN** the user clicks [Dismiss] on a toast for "backlinks"
- **THEN** the toast closes and the backlinks tour does NOT start, but remains available for replay

### Requirement: No toast during active tour
The system SHALL NOT show a new-feature toast while a tour is currently running. If a tour is active when the toast would normally appear, the toast is suppressed.

#### Scenario: User is mid-essentials-tour
- **WHEN** the essentials tour is running and a feature tour toast would trigger
- **THEN** the toast is suppressed until the current tour ends

### Requirement: Essentials tour suppresses feature toasts
The essentials tour already covers core features (comments, search, slash commands, changes). Feature tours for these capabilities SHALL NOT trigger a "new feature" toast if the user has completed the essentials tour at a version that included them.

#### Scenario: User completed essentials, comments tour exists
- **WHEN** the user has completed essentials v1 (which covers comments) and a standalone "comments" feature tour exists
- **THEN** no toast is shown for the comments tour — essentials already covered it
