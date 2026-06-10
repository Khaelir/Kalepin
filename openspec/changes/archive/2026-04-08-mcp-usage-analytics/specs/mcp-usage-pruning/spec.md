## ADDED Requirements

### Requirement: Daily cron pruning
The system SHALL run a daily scheduled job (at midnight) that deletes all rows from `mcp_usage_log` where `timestamp` is older than 14 days.

#### Scenario: Cron fires at midnight
- **WHEN** the daily cron job executes
- **THEN** all `mcp_usage_log` rows with `timestamp < now - 14 days` are deleted

### Requirement: Startup pruning
The system SHALL run the same 14-day pruning logic on module initialization (`onModuleInit`).

#### Scenario: Server starts after extended downtime
- **WHEN** the application starts and the `mcp_usage_log` table contains rows older than 14 days
- **THEN** those rows are deleted before the server begins accepting requests

#### Scenario: Pruning is idempotent
- **WHEN** pruning runs multiple times in succession
- **THEN** no errors occur and no valid data is removed
