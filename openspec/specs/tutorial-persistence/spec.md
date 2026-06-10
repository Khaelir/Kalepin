## Purpose

Persists which tutorials each user has completed on the user entity.

## Requirements

### Requirement: completedTours column on user entity
The user entity SHALL have a `completedTours` column storing a JSON array of objects with `tourId` (string) and `version` (number). Default value SHALL be an empty array `[]`.

#### Scenario: New user
- **WHEN** a new user is created
- **THEN** their `completedTours` is `[]`

#### Scenario: User completes essentials tour
- **WHEN** the user completes the essentials tour (version 1)
- **THEN** their `completedTours` becomes `[{"tourId":"essentials","version":1}]`

### Requirement: GET endpoint for completed tours
The system SHALL expose `GET /api/users/me/tours` which returns the authenticated user's `completedTours` array.

#### Scenario: Fetch completed tours
- **WHEN** an authenticated user requests `GET /api/users/me/tours`
- **THEN** the response is a JSON array of `{ tourId: string, version: number }` objects

### Requirement: PUT endpoint to update completed tours
The system SHALL expose `PUT /api/users/me/tours` which accepts a JSON body with `{ tourId: string, version: number }` and adds or updates that entry in the user's `completedTours`. If an entry with the same `tourId` exists, its version is updated. If not, the entry is appended.

#### Scenario: Complete a new tour
- **WHEN** an authenticated user sends `PUT /api/users/me/tours` with `{ "tourId": "essentials", "version": 1 }`
- **THEN** `{"tourId":"essentials","version":1}` is added to their `completedTours`

#### Scenario: Update a previously completed tour
- **WHEN** a user with `completedTours: [{"tourId":"essentials","version":1}]` sends `PUT /api/users/me/tours` with `{ "tourId": "essentials", "version": 2 }`
- **THEN** the entry is updated to `{"tourId":"essentials","version":2}`

### Requirement: Load completed tours on login
The frontend SHALL fetch `GET /api/users/me/tours` after authentication and store the result. This data is used by the tour engine to determine which tours to auto-trigger and by the feature tour notification system to detect new tours.

#### Scenario: Frontend loads tour state
- **WHEN** the user logs in and the workspace initializes
- **THEN** the frontend fetches completed tours and stores them in state before evaluating auto-triggers

### Requirement: Persist on tour completion
When a tour is completed (user clicks [Done] on the last step), the frontend SHALL immediately call `PUT /api/users/me/tours` with the tour's ID and version, and update local state.

#### Scenario: Tour completion persists
- **WHEN** the user completes the essentials tour
- **THEN** the frontend sends `PUT /api/users/me/tours` with `{ "tourId": "essentials", "version": 1 }` and updates local state
