## Purpose

Periodically prunes old rows from `mcp_usage_log` to cap storage growth.

## Requirements

### Requirement: Startup pruning
The system SHALL run 14-day time-based pruning AND 5000-row hard cap enforcement on module initialization (`onModuleInit`).

#### Scenario: Server starts after extended downtime
- **WHEN** the application starts and the `mcp_usage_log` table contains rows older than 14 days
- **THEN** those rows are deleted before the server begins accepting requests

#### Scenario: Row count exceeds hard cap
- **WHEN** the application starts and `mcp_usage_log` has more than 5000 rows (even if all within 14 days)
- **THEN** the oldest rows are deleted until the table has exactly 5000 rows

#### Scenario: Pruning is idempotent
- **WHEN** pruning runs multiple times in succession
- **THEN** no errors occur and no valid data is removed

### Requirement: Daily cron pruning
The system SHALL run both 14-day time-based pruning and 5000-row hard cap enforcement as a daily scheduled job (at midnight).

#### Scenario: Cron fires at midnight
- **WHEN** the daily cron job executes
- **THEN** all `mcp_usage_log` rows older than 14 days are deleted, and if more than 5000 rows remain, the oldest are deleted until 5000 remain
