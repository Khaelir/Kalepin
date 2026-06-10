# Spec delta: document-grants (MODIFIED)

## ADDED Requirements

### Requirement: ShareDialog renders per-grantee view stats

`ShareDialog` (the per-file share dialog) SHALL fetch `GET /api/notes/:path/access-summary` alongside the grants list and render, for each grantee row, the view count and the relative time of the last view (e.g., `· 12 views · last 3h ago`). When the grantee has zero log rows, the line SHALL render `· Not yet viewed`.

#### Scenario: Active grantee with views
- **GIVEN** the summary returns `{ email: 'bob@x.com', view_count: 12, last_view_at: now-3h }`
- **AND** the grants list contains an active grant for `bob@x.com`
- **WHEN** the dialog renders
- **THEN** Bob's row shows `bob@x.com · 12 views · last 3h ago`

#### Scenario: Active grantee with no views
- **GIVEN** the summary contains no row for `bob@x.com`
- **AND** the grants list contains an active grant for `bob@x.com`
- **WHEN** the dialog renders
- **THEN** Bob's row shows `bob@x.com · Not yet viewed`

### Requirement: ShareDialog renders anonymous aggregate on the public-link panel

When a public share-link exists for the path, the dialog's public-link panel SHALL render the anonymous aggregate (`anonymous.resolve_count · last <relative>`).

#### Scenario: Public link with anonymous resolves
- **GIVEN** the summary returns `anonymous: { resolve_count: 47, last_resolve_at: now-12m }`
- **WHEN** the dialog renders
- **THEN** the public-link panel shows `47 anonymous · last 12m ago`

### Requirement: Stats line gracefully degrades when access-metadata is absent

If the `access-metadata` capability is not deployed (the summary endpoint returns 404 or 501), the dialog SHALL hide the per-grantee stats line and the anonymous aggregate without other behavioural changes.

#### Scenario: Endpoint missing
- **WHEN** `GET /api/notes/:path/access-summary` returns 404
- **THEN** the dialog renders without stats lines, and no error toast is shown
