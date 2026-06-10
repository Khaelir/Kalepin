# Spec delta: comments (MODIFIED)

## ADDED Requirements

### Requirement: Comments record author verification state

The `Comment` model SHALL include optional `authorName` and `authorVerified` fields. Existing comments persisted before this change (without these fields) SHALL render as verified by default. Comments created via the authenticated `comments` endpoints SHALL be persisted with `authorVerified` implicitly true (the auth gate guarantees the email).

#### Scenario: Authenticated comment renders as verified
- **WHEN** an authenticated user posts a comment
- **THEN** the rendered comment has no "unverified" indicator

#### Scenario: Legacy comment without field
- **GIVEN** a comment persisted before this change with no `authorVerified` field
- **WHEN** the UI renders it
- **THEN** it renders as verified (no indicator)

### Requirement: Guest comments are marked unverified and skip mention notifications

When a comment is created via `CommentsService.addGuestComment` or `CommentsService.replyToGuestThread`, the comment SHALL be persisted with `authorVerified=false`. The mention-notification path (`sendMentionNotifications`) SHALL NOT be invoked for guest comments, regardless of any `@-mention` tokens in the body.

#### Scenario: Guest comment persisted unverified
- **WHEN** a guest posts a comment via the share-link guest-comment endpoint
- **THEN** the persisted comment has `authorVerified: false` and `authorName` set to the guest's typed name

#### Scenario: @-mention in guest body does not trigger notification
- **GIVEN** the guest body contains `@victim@example.com`
- **WHEN** the comment is persisted
- **THEN** no mention notification is queued or sent
