## ADDED Requirements

### Requirement: Notification tracking table
The system SHALL maintain a `mention_notifications` SQLite table that records every notification email sent, with columns: `id`, `userId`, `type` ('doc' | 'comment'), `docPath`, `threadId` (nullable), `commentId` (nullable), `sentAt`.

#### Scenario: Record created on email send
- **WHEN** a notification email is successfully sent to a user
- **THEN** a row is inserted into `mention_notifications` with the relevant userId, type, docPath, threadId, commentId, and current timestamp

#### Scenario: Record persists across restarts
- **WHEN** the server restarts
- **THEN** all previously recorded notifications are still present in the table and dedup checks work correctly

### Requirement: Anti-spam pipeline
The system SHALL check the following gates in order before sending any mention notification email. If any gate rejects, the email is NOT sent.

#### Scenario: Self-mention skip
- **WHEN** the mentioned user's email matches the author's email
- **THEN** no notification email is sent

#### Scenario: Per-event dedup for comment mentions
- **WHEN** a notification for the same userId and commentId already exists in the tracking table
- **THEN** no duplicate email is sent

#### Scenario: Doc-mention dedup
- **WHEN** a notification for the same userId, type='doc', and docPath already exists in the tracking table
- **THEN** no duplicate email is sent (one email per user per document, ever)

#### Scenario: Hard cooldown
- **WHEN** any notification was sent to the same userId within the last 10 seconds
- **THEN** the email is skipped (regardless of type, docPath, or thread)

#### Scenario: All gates pass
- **WHEN** a mention is not self-mention, has no prior dedup record, and the user has not been emailed in the last 10 seconds
- **THEN** the email is sent and a tracking record is inserted

### Requirement: Reply-chain participant resolution
The system SHALL identify all users who were previously @mentioned in any comment within a thread, so they can be notified on new replies.

#### Scenario: Collect thread participants
- **WHEN** a new reply is posted to a comment thread
- **THEN** the system scans all existing comments in the thread for `@[name](email)` patterns and unions those emails with any new mentions in the reply

#### Scenario: Exclude reply author
- **WHEN** the reply author's email is in the set of thread participants
- **THEN** the reply author is excluded from notifications
