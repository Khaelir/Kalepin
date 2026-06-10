# Spec delta: storage-adapters (MODIFIED)

## ADDED Requirements

### Requirement: EncryptingStorageAdapter wraps any inner StorageAdapter

The system SHALL provide an `EncryptingStorageAdapter` class implementing `StorageAdapter` by delegating to an inner adapter, with `read()` and `write()` augmented by envelope encryption logic per the `encryption` capability. `delete`, `move`, `list`, `stat`, `exists`, and `watch` SHALL be passthrough.

#### Scenario: Composition with the routing adapter
- **WHEN** the storage module boots with `KALEPIN_KEK_FILE` set
- **THEN** the resolved `STORAGE_ADAPTER` is `EncryptingStorageAdapter(RoutingStorageAdapter(...))`

### Requirement: writeAtomic uses write-tmp + fsync + rename

The `EncryptingStorageAdapter.write()` path SHALL write the envelope bytes to a sibling tempfile (`<basename>.tmp.<random>`), call `fsync()` on the tempfile descriptor, then `rename()` it onto the destination. A crash before `rename` SHALL leave the destination unchanged.

#### Scenario: Power-loss mid-write does not corrupt the file
- **GIVEN** an existing encrypted file at `_users/alice/foo.md`
- **WHEN** a write is interrupted between fsync and rename
- **THEN** the original file content is intact and readable on next boot
