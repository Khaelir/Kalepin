# Spec delta: access-metadata (MODIFIED)

## ADDED Requirements

### Requirement: Per-path access summary endpoint

`GET /api/notes/:path/access-summary` SHALL return an aggregate of access-log rows for the given path. The response shape SHALL include `grantees: [{ email, view_count, last_view_at, last_edit_at }]` (one row per active grantee that has at least one row in the log) and `anonymous: { resolve_count, last_resolve_at } | null` (null for paths where `share-link-resolved` cannot occur, e.g. E2E paths).

#### Scenario: Owner reads the summary
- **GIVEN** Alice owns `Notes/foo.md` and has granted read to Bob and Carol
- **AND** Bob has 12 view rows, Carol has 4, and 47 anonymous resolves exist
- **WHEN** Alice GETs `/api/notes/Notes%2Ffoo.md/access-summary`
- **THEN** the response includes a `grantees` array with two entries (Bob: 12, Carol: 4) and `anonymous: { resolve_count: 47, … }`

#### Scenario: Revoked grantee is excluded
- **GIVEN** Dan was previously granted access, viewed the note 8 times, and was then revoked
- **WHEN** Alice GETs the summary
- **THEN** the `grantees` array does not contain a row for Dan

#### Scenario: Non-owner blocked
- **WHEN** Bob GETs the summary for Alice's path
- **THEN** the response is 403 (or 404 per visibility rules)

#### Scenario: E2E path summary uses 'fetched' counts
- **GIVEN** `isE2EEncrypted('_users/alice@x.com/_secure/journal.md') === true`
- **AND** Alice granted read to Bob and the log shows 5 `'fetched'` rows for Bob
- **WHEN** Alice GETs the summary
- **THEN** Bob's `view_count` is 5 and `anonymous` is null

### Requirement: Empty grantee renders as "Not yet viewed", not "0 views"

The `view_count` field MAY be 0 when the grantee exists in the grants list but has no log rows. The frontend SHALL render this as "Not yet viewed" to distinguish from the prune case (no signal at all).

#### Scenario: Active grantee with no log rows
- **GIVEN** Bob has an active grant but no log rows on the path
- **WHEN** Alice GETs the summary
- **THEN** Bob's row in `grantees` has `view_count = 0` and `last_view_at = null`
