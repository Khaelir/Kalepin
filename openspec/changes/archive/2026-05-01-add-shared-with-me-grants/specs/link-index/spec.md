# Spec delta: link-index (MODIFIED)

## MODIFIED Requirements

### Requirement: Backlinks and graph results include grant-visible foreign personal paths

`getBacklinks`, `getOutgoingLinks`, `getUnlinkedMentions`, and `getGraphData` SHALL include results from foreign personal paths where the requester is an active grantee. They SHALL NOT include foreign personal paths with no grant.

#### Scenario: Backlinks from a granted note
- **GIVEN** Alice's `_users/alice/foo.md` contains `[[my-note]]` and is granted to Bob
- **WHEN** Bob queries backlinks for `my-note.md`
- **THEN** Alice's `foo.md` appears in the result
