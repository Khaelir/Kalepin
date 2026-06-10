# Spec delta: share-links (MODIFIED)

## ADDED Requirements

### Requirement: Public share-link viewer renders comments

The viewer at `/share/:code` SHALL render existing comment threads on the underlying path in read-only mode, regardless of viewer auth state.

#### Scenario: Anonymous viewer sees comments
- **GIVEN** a share-link `/share/abc123` for path `Notes/foo.md` with 3 existing comment threads
- **WHEN** an unauthenticated user opens the URL
- **THEN** the viewer renders all 3 threads as read-only

### Requirement: Sign-in CTA returns viewer to the share-link

When the viewer is unauthenticated, the comment input SHALL be replaced by a "Sign in to comment" button that initiates a magic-link flow with a return-URL pointing back to the same share-link.

#### Scenario: Magic-link return
- **GIVEN** an unauthenticated viewer on `/share/abc123` clicks "Sign in to comment"
- **WHEN** they complete the magic-link flow
- **THEN** they land back on `/share/abc123` and the comment input is enabled
