## ADDED Requirements

### Requirement: daily_stats table schema
The system SHALL maintain a `daily_stats` table with columns: `date` (TEXT, primary key, format YYYY-MM-DD), `active_users` (INTEGER), `searches` (INTEGER), `searches_empty` (INTEGER), `notes_created` (INTEGER), `notes_edited` (INTEGER), `comments_added` (INTEGER), `comments_resolved` (INTEGER), `ot_concurrent_edits` (INTEGER).

#### Scenario: Table creation
- **WHEN** the application starts
- **THEN** the `daily_stats` table is created if it does not exist

### Requirement: In-memory counter accumulation
The system SHALL accumulate daily stats counters in memory and flush them to the database on a 5-minute interval and on graceful shutdown (SIGTERM/SIGINT).

#### Scenario: Counter increment
- **WHEN** a trackable event occurs (search, note create, note edit, comment add, comment resolve, OT concurrent edit)
- **THEN** the corresponding in-memory counter for today's date is incremented

#### Scenario: Periodic flush
- **WHEN** 5 minutes have elapsed since the last flush
- **THEN** the current in-memory counters are upserted into `daily_stats` (INSERT OR REPLACE, merging with any existing row for today)

#### Scenario: Shutdown flush
- **WHEN** the process receives SIGTERM or SIGINT
- **THEN** the in-memory counters are flushed to the database before the process exits

#### Scenario: Counter loss on crash
- **WHEN** the process crashes without graceful shutdown
- **THEN** at most 5 minutes of counter increments are lost (acceptable for aggregate stats)

### Requirement: Active user tracking
The system SHALL track unique active users per day using an in-memory Set of user IDs, flushed as a count.

#### Scenario: Multiple requests from same user
- **WHEN** the same user makes 10 API requests in one day
- **THEN** `active_users` for that day increments by 1, not 10

### Requirement: OT concurrent edit tracking
The system SHALL increment the `ot_concurrent_edits` counter when `OTSessionManager.applyOperation()` transforms an operation against concurrent server operations (i.e., `clientRev < session.revision`).

#### Scenario: Concurrent edit detected
- **WHEN** a client submits an operation at revision 5 but the server is at revision 7
- **THEN** the OT transform loop runs and the `ot_concurrent_edits` counter increments by 1

#### Scenario: No concurrency
- **WHEN** a client submits an operation at the current server revision
- **THEN** no transform is needed and the counter is not incremented

### Requirement: 90-day pruning
The system SHALL delete rows from `daily_stats` where `date` is older than 90 days, on startup and daily.

#### Scenario: Startup pruning
- **WHEN** the application starts
- **THEN** `daily_stats` rows older than 90 days are deleted

#### Scenario: Steady-state row count
- **WHEN** the system has been running for over 90 days
- **THEN** `daily_stats` contains at most ~90 rows
