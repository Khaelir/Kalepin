## ADDED Requirements

### Requirement: Cursor positions SHALL be transformed against incoming OT operations

The system SHALL provide a `transformPosition` function that adjusts a numeric cursor position based on an OT operation array. For each operation component occurring before the cursor position: retain advances the position tracker, delete shifts the cursor backward, and insert shifts the cursor forward.

#### Scenario: Insert before cursor
- **WHEN** cursor is at position 50 and a remote operation inserts 10 characters at position 20
- **THEN** the transformed cursor position SHALL be 60

#### Scenario: Delete before cursor
- **WHEN** cursor is at position 50 and a remote operation deletes 10 characters starting at position 20
- **THEN** the transformed cursor position SHALL be 40

#### Scenario: Delete spanning cursor
- **WHEN** cursor is at position 50 and a remote operation deletes characters from position 45 to 55
- **THEN** the transformed cursor position SHALL collapse to 45 (start of deletion)

#### Scenario: Insert after cursor
- **WHEN** cursor is at position 50 and a remote operation inserts characters at position 80
- **THEN** the transformed cursor position SHALL remain 50

#### Scenario: Selection range transformation
- **WHEN** a selection range `{from: 30, to: 60}` exists and a remote operation inserts 5 characters at position 10
- **THEN** the transformed range SHALL be `{from: 35, to: 65}`

### Requirement: Local cursor SHALL be transformed when applying remote operations

When the editor receives a remote OT operation and applies it via `setContent`, the saved cursor `{from, to}` SHALL be transformed against the incoming operation before being restored, rather than restoring the raw numeric values.

#### Scenario: Typing while collaborator inserts text before cursor
- **WHEN** local cursor is at position 100 and a remote operation inserts 20 characters at position 30
- **THEN** after applying the remote operation, the local cursor SHALL be restored at position 120

#### Scenario: Typing while collaborator deletes text before cursor
- **WHEN** local cursor is at position 100 and a remote operation deletes 15 characters starting at position 50
- **THEN** after applying the remote operation, the local cursor SHALL be restored at position 85
