## MODIFIED Requirements

### Requirement: Mention notifications across a personal-folder boundary are suppressed

When a comment, doc-mention, or thread-reply originates from a path under `_users/{X}/` and would deliver a notification to a recipient whose lowercased email is not equal to `X`, the system SHALL suppress the notification entirely. No email SHALL be sent and no fallback `logger.log` SHALL include the comment text or note title.

#### Scenario: Cross-personal mention email suppressed
- **WHEN** Alice writes a comment in `_users/alice@example.com/Diary.md` mentioning `bob@example.com`
- **THEN** `notifyMention`, `notifyDocMention`, and `notifyThreadReply` do NOT call `transporter.sendMail` and do NOT call `logger.log` with the comment text or note title

#### Scenario: Cross-personal mention suppression is logged at INFO without leaking content
- **WHEN** the suppression triggers
- **THEN** the system logs an INFO message indicating "suppressed cross-personal mention" with the recipient email and the source path's owner email — but NOT with the comment text, the note title, or any other path-derived content

#### Scenario: Same-owner mention inside personal folder still notifies the owner
- **WHEN** Alice writes a comment in her personal note that mentions `alice@example.com` (herself)
- **THEN** the notification is delivered normally

#### Scenario: Mention from a shared note is unaffected
- **WHEN** Alice writes a comment in a shared note mentioning `bob@example.com`
- **THEN** the notification is delivered normally

### Requirement: Personal-folder editor surfaces a mention warning

The frontend SHALL render an inline warning above the comment composer when the active document's path is under `_users/{me}/`, indicating that mentions inside the personal folder do not send notifications.

#### Scenario: Warning visible inside personal note
- **WHEN** Alice opens the comment composer on a note inside `_users/alice@example.com/`
- **THEN** the composer shows the warning copy keyed by `comments.personal.mentionWarning`

#### Scenario: Warning hidden in shared notes
- **WHEN** Alice opens the comment composer on a shared note
- **THEN** the warning is not rendered
