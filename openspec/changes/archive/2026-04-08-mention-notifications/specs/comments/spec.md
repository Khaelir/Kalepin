## MODIFIED Requirements

### Requirement: Reply notification scope
When a reply is posted to a comment thread, the system SHALL notify all users who were previously @mentioned in any comment within that thread, in addition to any users explicitly @mentioned in the new reply.

#### Scenario: Reply notifies past-mentioned users
- **WHEN** alice was @mentioned in an earlier comment in a thread, and bob posts a reply without mentioning alice
- **THEN** alice receives a notification email about bob's reply

#### Scenario: Reply notifies both past and new mentions
- **WHEN** alice was @mentioned earlier in a thread, and bob posts a reply that @mentions carol
- **THEN** both alice and carol receive notification emails

#### Scenario: Reply author excluded
- **WHEN** bob posts a reply to a thread where bob was previously @mentioned
- **THEN** bob does NOT receive a notification for his own reply

#### Scenario: Duplicate mentions consolidated
- **WHEN** alice was @mentioned in two earlier comments in the same thread, and a new reply is posted
- **THEN** alice receives exactly one notification email (not two)
