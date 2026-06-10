# Spec delta: guest-viewer (ADDED)

## ADDED Requirements

### Requirement: Unauthenticated visits to share URLs render the guest viewer

When a user without an authentication token navigates to `/s/<code>` or `/d/<code>` (with or without a cosmetic suffix), the application SHALL render `GuestDocView` for that URL. The application SHALL NOT redirect to or render `LoginPage` for those URLs.

#### Scenario: Anonymous visit to share URL
- **GIVEN** a user with no auth token
- **WHEN** they navigate to `/s/abc12345`
- **THEN** the page renders `GuestDocView`, not `LoginPage`

#### Scenario: Anonymous visit to legacy share URL
- **GIVEN** a user with no auth token
- **WHEN** they navigate to `/d/abc12345/My-Note`
- **THEN** the page renders `GuestDocView`

#### Scenario: Anonymous visit to a non-share URL
- **GIVEN** a user with no auth token
- **WHEN** they navigate to `/` or any non-share URL
- **THEN** the page renders `LoginPage` as before

### Requirement: Guest viewer renders read-only document with attribution

`GuestDocView` SHALL render the document body using a minimal read-only TipTap renderer (no WebSocket connection, no operational-transform sync, no presence, no command palette, no slash menu). The header SHALL display the link's `sharedByEmail` as attribution (e.g. "Shared by alice@…"). A "Sign in" call-to-action SHALL preserve the share URL so post-login the user lands on the same document.

#### Scenario: Read-only rendering
- **WHEN** `GuestDocView` mounts with valid resolve data
- **THEN** the document content is rendered read-only with no editor controls, no presence indicators, and no real-time sync

#### Scenario: Attribution shown
- **GIVEN** the link's `sharedByEmail` is `alice@example.com`
- **THEN** the header displays "Shared by alice@example.com"

#### Scenario: Sign-in preserves deep link
- **WHEN** the user clicks "Sign in" from `/s/abc12345`
- **THEN** the post-login redirect target is `/s/abc12345`

### Requirement: Guest viewer handles PIN unlock inline

When `resolve` returns `requiresPin: true`, `GuestDocView` SHALL render an inline PIN entry form. On submit, the component SHALL POST to `/api/share-links/:code/pin/verify`, then re-resolve to obtain the now-issued access token, and finally fetch the rewritten content via `/api/share-links/:code/content`.

#### Scenario: Correct PIN reveals content
- **GIVEN** the document is PIN-protected and the guest enters the correct PIN
- **WHEN** the form submits
- **THEN** the content renders inline without a page reload

#### Scenario: Wrong PIN shows error
- **WHEN** the guest submits an incorrect PIN
- **THEN** the form shows an error and the content does not render

### Requirement: Guest viewer renders dedicated 410 / error states

When `resolve` returns `410 Gone` (revoked or expired) or any non-recoverable error, `GuestDocView` SHALL render a dedicated error card. The error path SHALL NOT fall through to the login page.

#### Scenario: Revoked code shows gone card
- **GIVEN** the code's `revoked_at` is set
- **WHEN** the guest visits the URL
- **THEN** a card explaining "This link is no longer active" renders, with no login fallback

### Requirement: Guest viewer surfaces opt-in commenting

When `resolve` indicates `allowGuestComments: true`, `GuestDocView` SHALL render an inline `GuestCommentBox` allowing the guest to post a comment with a self-typed name and email. The component SHALL persist the typed name + email in `sessionStorage` for the visit so the guest does not retype across multiple comments. When `allowGuestComments` is `false`, the `GuestCommentBox` SHALL NOT render.

#### Scenario: Flag on shows comment box
- **GIVEN** `allowGuestComments` is `true`
- **THEN** `GuestCommentBox` is rendered

#### Scenario: sessionStorage retains identity across comments
- **GIVEN** the guest has posted one comment with name "Bob" and email `bob@x.com`
- **WHEN** they post a second comment in the same browser session
- **THEN** the form is pre-filled from sessionStorage

#### Scenario: Flag off hides comment box
- **GIVEN** `allowGuestComments` is `false`
- **THEN** no comment input is rendered
