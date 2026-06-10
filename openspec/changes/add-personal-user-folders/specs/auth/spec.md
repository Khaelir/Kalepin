## ADDED Requirements

### Requirement: Personal folder is auto-created on authenticated request

The system SHALL ensure that the on-disk personal folder for a user exists before the user's first authenticated request after login completes. The hook SHALL be idempotent and SHALL run on all authentication paths (magic link, OAuth, API key).

#### Scenario: First login creates personal folder
- **WHEN** a user with email `alice@example.com` authenticates for the first time and calls any authenticated route
- **THEN** the directory `personal/alice@example.com/` exists on disk after the request completes

#### Scenario: Subsequent authenticated requests do not modify the folder
- **WHEN** a user with an existing personal folder authenticates again and makes any authenticated request
- **THEN** no FS write occurs against the personal folder and no observable change to mtime

#### Scenario: API key authentication also triggers ensure
- **WHEN** a request is authenticated via an API key (not a JWT) and the key's owning user has no personal folder yet
- **THEN** the request still triggers `ensurePersonalFolder(user.email)` before completing

### Requirement: Email is canonicalized at the auth boundary

The system SHALL canonicalize every incoming email exactly once at the auth boundary (JWT issuance, JWT verification, magic-link, OAuth, API-key) via a single `canonicalizeEmail` helper. The canonical form SHALL be NFC-normalized, trimmed, lowercased, length-capped at 254 characters (RFC 5321), and SHALL match the strict regex `^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`. The system SHALL reject (with `401`) any email that contains `..`, starts with `.`, contains `.@`, or fails the regex. Every downstream call site SHALL treat `req.user.email` as already canonical and SHALL NOT re-validate.

#### Scenario: Mixed-case email is canonicalized to lowercased form
- **WHEN** a JWT carries the email `Alice@Example.COM`
- **THEN** the personal folder path, predicate, FTS predicate, and Map keys all use `alice@example.com`

#### Scenario: Malformed email fails auth closed
- **WHEN** any auth path receives an email containing whitespace, control characters, path separators (`/`, `\`), null bytes, quoted local-parts, or any character outside the canonical regex
- **THEN** authentication fails with `401`, no JWT is issued, and no personal folder is created

#### Scenario: NFC normalization equates composed and decomposed forms
- **WHEN** the same logical email is presented in NFC (e.g. precomposed `é`) and in NFD (e.g. `e` + combining acute)
- **THEN** both forms canonicalize to the identical string and refer to the same personal folder

#### Scenario: Email-change while a personal folder exists is forbidden
- **WHEN** a user with an existing personal folder attempts to change their email
- **THEN** the system rejects the change in v1, with an explanatory error pointing to a future maintenance flow

### Requirement: Email metacharacters do not cross the personal namespace boundary in SQL LIKE patterns

The system SHALL escape SQL `LIKE` metacharacters (`_`, `%`, `\`) in the email value at every site where the email is concatenated into a `LIKE` pattern, in addition to escaping the literal `_users/` prefix via the `ESCAPE` clause. The escape SHALL be applied to the bound parameter, not to the static SQL.

#### Scenario: Underscore in legal email does not match a different user
- **WHEN** Alice has a personal note at `_users/john_doe@example.com/secret.md` and Bob is `johnxdoe@example.com`
- **THEN** Bob's full-text search, comments search, and any other `LIKE`-gated query returns zero results referencing Alice's note — the `_` in `john_doe` is escaped at bind time, not interpreted as a single-char wildcard

#### Scenario: Percent in legal email does not match a different user
- **WHEN** Alice has a personal note at `_users/a%b@example.com/secret.md` and Bob is `axyzb@example.com`
- **THEN** Bob's queries return zero results referencing Alice's note — the `%` is escaped at bind time, not interpreted as a multi-char wildcard

#### Scenario: New LIKE-on-email site without escape fails CI
- **WHEN** a developer adds a new SQL site that concatenates `email` into a `LIKE` pattern without using the canonical `escapeLike` helper
- **THEN** the source-scanning unit test in the search test suite fails CI before merge
