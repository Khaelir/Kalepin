# Spec delta: share-links (MODIFIED)

## ADDED Requirements

### Requirement: Share-link viewer challenges for the PIN before rendering

When `/share/:code` resolves a path with a non-null `pin_hash`, the server SHALL serve a PIN-prompt page (or return a status the frontend renders as a prompt) before rendering the note content. Successful PIN entry SHALL set a session-scoped unlock cookie.

#### Scenario: Anonymous viewer prompted for PIN
- **GIVEN** Alice has a share-link `/share/abc123` for a PIN-locked note
- **WHEN** an anonymous viewer opens the URL
- **THEN** the page prompts for the PIN; the note content is not in the response

#### Scenario: Correct PIN reveals content
- **WHEN** the viewer submits the correct PIN
- **THEN** the unlock cookie is set; the next page load (same browser session) renders the note
