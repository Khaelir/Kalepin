## Purpose

Sends email notifications for mentions and other user-facing events via Mailjet.

## Requirements

### Requirement: Mention email notification
The system SHALL send email notifications for mentions with context-appropriate subjects and links.

#### Scenario: Doc mention email
- **WHEN** a user is @mentioned in a document body for the first time
- **THEN** an email is sent with subject `[Kalepin] {author} mentioned you in "{docTitle}"`, containing a link to the document at the nearest heading above the mention (`{APP_URL}/doc/{path}#heading-slug`)

#### Scenario: Comment mention email
- **WHEN** a user is @mentioned in a comment
- **THEN** an email is sent with subject `[Kalepin] {author} mentioned you in a comment on "{docTitle}"`, containing the comment text and a link to the thread (`{APP_URL}/doc/{path}?thread={threadId}`)

#### Scenario: Thread reply email (reply-chain)
- **WHEN** a new reply is posted to a thread where the user was previously @mentioned (but is NOT @mentioned in this specific reply)
- **THEN** an email is sent with subject `[Kalepin] {author} replied in a thread where you were mentioned in "{docTitle}"`, containing the reply text and a link to the thread

#### Scenario: Thread reply with re-mention
- **WHEN** a new reply is posted to a thread and the user IS explicitly @mentioned in the new reply
- **THEN** an email is sent with the direct mention subject `[Kalepin] {author} mentioned you in a comment on "{docTitle}"` (not the reply-chain variant)

## ADDED Requirements

### Requirement: Email template design
Notification emails SHALL use a polished HTML template with consistent branding.

#### Scenario: Email layout
- **WHEN** any notification email is sent
- **THEN** it uses a responsive HTML template with: accent color top border, author attribution, contextual body (comment text or document mention context), primary CTA button in accent color (#e94560), and footer explaining why the email was received

#### Scenario: Doc mention email content
- **WHEN** a doc mention email is sent
- **THEN** the email body states who mentioned the user and in which document, with a "View document" button linking to the section

#### Scenario: Comment/reply email content
- **WHEN** a comment mention or thread reply email is sent
- **THEN** the email body includes the comment/reply text in a blockquote and a "View thread" button linking to the comment thread

### Requirement: Section link for doc mentions
The system SHALL include a link to the nearest heading above the mention in doc mention emails.

#### Scenario: Mention below a heading
- **WHEN** a doc mention email is generated and the mention appears below a `## Design Review` heading
- **THEN** the email link includes `#design-review` as the URL anchor

#### Scenario: Mention with no heading above
- **WHEN** a doc mention email is generated and no heading exists above the mention
- **THEN** the email links to the document without an anchor fragment
