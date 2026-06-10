# Spec delta: admin-backup-download (MODIFIED)

## MODIFIED Requirements

### Requirement: Archive contains ciphertext for encrypted zones

The archive produced by `archiveService.createArchive()` SHALL contain the on-disk bytes verbatim. For zones where `enabled = 1`, those bytes are envelopes; restoring the archive on a system with the matching KEK SHALL be byte-identical to the source. The archive SHALL NOT contain the KEK.

#### Scenario: Backup → restore round-trip with personal-zone encrypted
- **GIVEN** the `personal` zone is encrypted, KEK fingerprint `F`
- **WHEN** an admin downloads a backup and restores it on a fresh instance with the same KEK
- **THEN** every file in `_users/*` is byte-identical and reads through the API yield the original plaintext

#### Scenario: Restore with wrong KEK is detected on first read
- **GIVEN** a restore on a system with a KEK whose fingerprint differs from the archive's
- **WHEN** any encrypted file is read through the API
- **THEN** the response is a 500 with `WrongKEKError` and both fingerprints in the log line

### Requirement: Operator runbook documents KEK custody

The README operator section SHALL document: how to generate the KEK, recommended file mode, where to mount it in containers, the explicit warning that the KEK MUST NOT live in the same backup as the data, and the wrong-KEK failure mode.

#### Scenario: README has the runbook
- **WHEN** a reader opens README.md
- **THEN** there is a section titled "Encryption — operator runbook" containing the points above
