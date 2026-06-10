## ADDED Requirements

### Requirement: Meta row displays Created date
The doc-header meta row SHALL include a `Created <DATE>` segment positioned before the existing `edited N minutes ago` segment, separated from it by a middle-dot. `<DATE>` SHALL be formatted from the file's `birthtimeMs` using the client's locale (`Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium' })`). When `birthtimeMs` equals `mtimeMs` (filesystem fallback case), the segment SHALL still render — treating filesystem Created as the best available signal.

This requirement extends the existing meta row (which already specs author, edited-at, read time, word count, and backlink count). Order, separator (middle-dot), and styling (muted secondary text) are inherited from the base meta-row requirement.

#### Scenario: Created segment renders before edited segment
- **WHEN** a document has `birthtimeMs` corresponding to 3 April and was last edited 2 minutes ago
- **THEN** the meta row reads `[avatar] Alex · Created Apr 3 · edited 2 minutes ago · 4 min read · 712 words · 4 backlinks`

#### Scenario: Created segment uses locale formatting
- **WHEN** the user's `navigator.language` is `fr-FR` and `birthtimeMs` corresponds to 3 April 2026
- **THEN** the Created segment reads `Créé le 3 avr. 2026` (or the locale-appropriate medium-date form)

#### Scenario: Birthtime fallback still renders
- **WHEN** the file's `birthtimeMs` was filled from `mtimeMs` by the backend fallback
- **THEN** the Created segment still renders with the fallback date — the UI does not distinguish the fallback case
