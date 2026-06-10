## ADDED Requirements

### Requirement: User entity tracks last activity
The `users` table SHALL have a `last_active_at` DATETIME column, nullable, defaulting to NULL.

#### Scenario: New user has no last activity
- **WHEN** a new user is created
- **THEN** their `last_active_at` is NULL

### Requirement: last_active_at is updated on get_updates call
The system SHALL update the user's `last_active_at` to the current timestamp when they call the `get_updates` endpoint or MCP tool.

#### Scenario: User calls get_updates
- **WHEN** an authenticated user calls `get_updates`
- **THEN** their `last_active_at` is set to the current time after the response is computed

#### Scenario: last_active_at is shared across API keys
- **WHEN** a user calls `get_updates` via any of their API keys
- **THEN** the same `last_active_at` on their user record is updated
