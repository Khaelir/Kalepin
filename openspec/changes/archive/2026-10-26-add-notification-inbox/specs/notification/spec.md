# Spec delta: notification (MODIFIED)

## MODIFIED Requirements

### Requirement: Email template design
Notification emails SHALL use a polished HTML template with consistent branding.

#### Scenario: Email layout
- **WHEN** any notification email is sent
- **THEN** it uses a responsive HTML template with: accent color top border, author attribution, contextual body (comment text or document mention context), primary CTA button in accent color (#e94560), and a footer explaining why the email was received followed by an unsubscribe link

#### Scenario: Doc mention email content
- **WHEN** a doc mention email is sent
- **THEN** the email body states who mentioned the user and in which document, with a "View document" button linking to the section

#### Scenario: Comment/reply email content
- **WHEN** a comment mention or thread reply email is sent
- **THEN** the email body includes the comment/reply text in a blockquote and a "View thread" button linking to the comment thread

## ADDED Requirements

### Requirement: Per-user email notification preference
Each user SHALL have an email notification preference stored on the user record: `all` (default — every notification email), `mentions` (comment mentions including mentions inside replies, doc mentions and shares; no thread-reply emails) or `none` (no notification emails). Every notification email SHALL be gated by the recipient's preference after the existing suppression and domain-allowlist checks. The preference SHALL NOT affect in-app notification items. The preference SHALL be readable and writable by the signed-in user through `GET` and `PUT /api/notifications/preferences` (`{ "email": "all" | "mentions" | "none" }`) with a browser session; API keys SHALL NOT be able to change it. The Settings page SHALL offer the three choices.

#### Scenario: Default keeps today's behaviour
- **GIVEN** a user who never changed the setting
- **WHEN** they are mentioned, replied to, or shared a note
- **THEN** they receive the email as before

#### Scenario: Mentions only
- **GIVEN** bob's preference is `mentions`
- **WHEN** a reply that does not mention bob is posted in a thread where bob was mentioned
- **THEN** no email is sent to bob
- **AND** bob still gets the in-app `thread_reply` item

#### Scenario: None
- **GIVEN** bob's preference is `none`
- **WHEN** bob is mentioned in a comment
- **THEN** no email is sent and the in-app item is still created

#### Scenario: Invalid value
- **WHEN** a user PUTs `{ "email": "sometimes" }`
- **THEN** the response is 400 and the preference is unchanged

### Requirement: Unsubscribe link
Every notification email SHALL contain an unsubscribe link `{APP_URL}/api/notifications/unsubscribe?token=…` and carry `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. The token SHALL be a JWT signed with the server's JWT secret carrying the recipient email as `sub` and `purpose: "notification-unsubscribe"`, with no `email` claim, so it can never be accepted as a session token. `GET` (and `POST`, for one-click) on that URL with a valid token SHALL set the recipient's preference to `none` and respond with a small HTML confirmation page; an invalid, expired, tampered or wrong-purpose token SHALL get a 400 page and change nothing.

#### Scenario: Valid unsubscribe
- **WHEN** bob opens the unsubscribe link from a notification email
- **THEN** bob's preference becomes `none` and a page confirms it and points to Settings to turn emails back on

#### Scenario: Tampered token
- **WHEN** the token's signature or payload has been altered
- **THEN** the response is 400 and no preference changes

#### Scenario: Wrong purpose
- **WHEN** a session JWT or a PIN unlock token is passed as `token`
- **THEN** the response is 400 and no preference changes

#### Scenario: Not a session credential
- **WHEN** an unsubscribe token is sent as `Authorization: Bearer <token>` to any API
- **THEN** it is rejected as an invalid token

### Requirement: Share notification email
When a grant gives a registered user access to a note they had no active grant for, the system SHALL email them `[Kalepin] {grantor} shared "{docTitle}" with you` with an "Open note" button linking to `{APP_URL}/doc/{handle-id}`, subject to their email preference and the domain allowlist. At most one share email SHALL be sent per grantor→grantee pair per 60 seconds, so sharing a folder (one grant per file) sends a single email.

#### Scenario: Single share
- **WHEN** alice shares `_users/alice@x.com/plan.md` with bob
- **THEN** bob receives one share email naming the note

#### Scenario: Folder share
- **WHEN** alice shares a folder of 12 notes with bob
- **THEN** bob receives one share email and twelve in-app `share` items
