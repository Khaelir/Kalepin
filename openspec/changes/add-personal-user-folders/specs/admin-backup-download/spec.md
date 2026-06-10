## ADDED Requirements

### Requirement: Admin export endpoint streams the union of all roots

The system SHALL provide `GET /api/admin/export-zip`, gated by the `admin:backup` scope, that streams a tar/zip containing the shared vault and every personal folder. The endpoint SHALL stream directly without staging more than necessary on disk.

#### Scenario: Admin export contains all personal subtrees
- **WHEN** an admin calls `GET /api/admin/export-zip`
- **THEN** the streamed archive contains entries from `vault/...` and from every `personal/{email}/...` directory present on disk

#### Scenario: Non-admin call rejected
- **WHEN** an authenticated non-admin user calls `GET /api/admin/export-zip`
- **THEN** the system returns `403 Forbidden`

### Requirement: Per-user download includes only the requester's personal subtree

The system SHALL ensure `GET /api/files/download-zip` (the per-user export) yields a tar containing the shared vault and at most the requester's own personal subtree. Foreign personal data SHALL NOT be reachable through this handler.

#### Scenario: Per-user export excludes foreign personal data
- **WHEN** Bob calls `GET /api/files/download-zip`
- **THEN** the tar contains zero entries beginning with `_users/alice@example.com/`

#### Scenario: Per-user export includes own personal subtree
- **WHEN** Alice has notes in her personal folder and calls `GET /api/files/download-zip`
- **THEN** the tar contains those notes nested under a virtual `_users/alice@example.com/` directory
