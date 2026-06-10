## Purpose

Lets users mark files and folders as starred to scope notification priority and surface them in the changes panel.

## Requirements

### Requirement: Star limit
Users SHALL be able to star any number of files or folders with no upper limit.

#### Scenario: Star beyond previous limit
- **WHEN** a user has 5 starred items and stars a 6th
- **THEN** the star is created successfully with no error

#### Scenario: Star many items
- **WHEN** a user stars 20 files
- **THEN** all 20 starred items are persisted and returned by `GET /api/stars`

## ADDED Requirements

### Requirement: Auto-star on mention
The system SHALL automatically star a document for a user when that user is @mentioned in the document (body or comment). The star is an idempotent upsert — if the document is already starred, no action is taken.

#### Scenario: Auto-star on doc body mention
- **WHEN** a document is saved with a new mention for `alice@company.com`
- **THEN** the document is automatically starred for alice (type: 'file')

#### Scenario: Auto-star on comment mention
- **WHEN** a comment mentioning `alice@company.com` is posted on a document
- **THEN** the document is automatically starred for alice (type: 'file')

#### Scenario: Already starred
- **WHEN** a user is mentioned in a document they have already starred
- **THEN** no duplicate star is created (idempotent, no error)

#### Scenario: User can unstar after auto-star
- **WHEN** a user unstars a document that was auto-starred
- **THEN** the star is removed normally; future mentions in the same doc will re-star it
