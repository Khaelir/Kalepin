## MODIFIED Requirements

### Requirement: Share-link minting validates that the minter can read the path

`POST /api/share-links` SHALL call `assertReadableBy(body.path, req.user.email)` before inserting a row. A non-owner who attempts to mint a share link for a foreign personal path SHALL receive `404 Not Found` and SHALL NOT cause any insert into `short_links`.

#### Scenario: Non-owner mint of foreign personal share returns 404
- **WHEN** Bob calls `POST /api/share-links` with `path = _users/alice@example.com/Diary.md`
- **THEN** the response status is `404 Not Found` and no row is inserted into `short_links` for that path

#### Scenario: Owner mint of own personal share succeeds
- **WHEN** Alice calls `POST /api/share-links` with `path = _users/alice@example.com/Diary.md`
- **THEN** a `short_links` row is inserted and the response contains the share code

### Requirement: Public share-link resolve is unchanged

`GET /share/:code` SHALL resolve the token to a path and serve the file content as today. The token SHALL remain the sole permission check. Owners minting a share link from a personal folder SHALL be warned by the UI.

#### Scenario: Resolve still works for personal-folder share
- **WHEN** an unauthenticated client calls `GET /share/{code}` for a code minted by Alice for her personal note
- **THEN** the file content is served as for any shared-vault share link

#### Scenario: UI warns at mint time when source is personal
- **WHEN** Alice clicks "Create share link" on a note whose path is under `_users/alice@example.com/`
- **THEN** the frontend renders a confirmation dialog (i18n key `share-links.personal.confirm`) before calling the mint endpoint
