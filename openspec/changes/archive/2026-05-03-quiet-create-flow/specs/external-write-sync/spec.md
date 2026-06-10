# Spec delta: external-write-sync (MODIFIED)

## ADDED Requirements

### Requirement: Self-saved registry covers REST file writes

The frontend `selfSavedPaths` registry SHALL be populated by every client-initiated write that produces a watcher echo. This includes (non-exhaustive): `POST /api/files/create`, `POST /api/files/move`, `POST /api/files/version/restore`. Each entry SHALL be removed automatically after 5 seconds to avoid permanent suppression in the pathological case where the watcher event never arrives.

#### Scenario: REST create is suppressed
- **GIVEN** the frontend issues `POST /api/files/create` for `Notes/foo.md`
- **WHEN** the corresponding `file:changed` event arrives within 5 seconds
- **THEN** the toast is suppressed

#### Scenario: TTL elapsed before event arrives
- **GIVEN** a path is registered at time T
- **WHEN** a `file:changed` arrives at T + 6 seconds
- **THEN** the toast is shown (the registry entry has expired)
