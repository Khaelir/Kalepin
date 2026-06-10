## ADDED Requirements

### Requirement: Shadow markdown SHALL be re-synced after applying remote content

After `editor.commands.setContent(markdown)` is called to apply a remote operation, the shadow reference (`shadowRef`) SHALL be updated to the result of `editor.storage.markdown.getMarkdown()` — not the raw markdown that was passed to `setContent`. This ensures the shadow always reflects what TipTap actually parsed and would serialize.

#### Scenario: Table normalization during roundtrip
- **WHEN** a remote operation produces markdown with a table `| col1 | col2 |` and TipTap normalizes it to `| col1  | col2  |` during parse
- **THEN** the shadow SHALL contain the normalized form `| col1  | col2  |`
- **AND** the next local edit SHALL diff against the normalized shadow, producing no spurious operations

#### Scenario: Consecutive remote operations do not accumulate drift
- **WHEN** 10 consecutive remote operations are applied to a document containing tables
- **THEN** the shadow SHALL match `getMarkdown()` after each operation
- **AND** no spurious operations SHALL be sent to the server as a result of roundtrip normalization

#### Scenario: Shadow re-sync does not trigger local operation
- **WHEN** `setContent` is called with `isRemoteRef` set to true and the shadow is re-synced afterward
- **THEN** the `onTransaction` handler SHALL not generate or send any OT operations for that content change
