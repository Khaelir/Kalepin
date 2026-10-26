# Changelog

## 0.5.83 — 2026-10-26

### Added

- **Trash.** Deletes from the UI, the REST API and MCP `delete_note` move notes and folders to `.trash/` (vault) or `_users/{email}/.trash/` (personal) instead of removing them. An Undo toast follows every delete, confirmations say "Move to trash", and a Trash dialog in the sidebar restores or purges items. Restored notes keep their comments, share links, grants, stars, PIN and `/doc/` link. New `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`, `DELETE /api/trash`; the delete endpoints return `trashItemId`. Notes in the Encrypted Folder are still deleted permanently.
- **Tags.** A server-side tag index (frontmatter and inline `#tags`, nested and case-insensitive), a Tags tree in the sidebar, clickable tag pills, `tag:` filters in search, `GET /api/tags` and `GET /api/tags/notes`, and the MCP `list_tags` tool. Existing vaults are indexed on first boot.
- **Related notes.** A "Related" section in the Backlinks panel lists semantically similar notes, why they match and whether they're linked yet, with a one-click "Link" action. Also `GET /api/search/related` and the MCP `related_notes` tool.
- **Templates and daily notes.** "From template…" and "Today's note" in the create popover, ⌘⇧D / Ctrl+Shift+D for today's note, a sample-template action, `GET /api/templates`, `POST /api/daily-notes`, and `template` / `timezone` on `POST /api/vault/items`. MCP: `create_note` accepts `template` and `timezone` (`content` is now optional), and a new `daily_note` tool.
- **Notification inbox.** A bell in the top bar with a live unread badge lists comment mentions, doc mentions, thread replies and "shared with you" events. Items follow notes through renames and moves and hide when you lose access. New `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- **Email notification preferences.** Settings → Email notifications: *All activity* / *Mentions and shares* / *None*. Every notification email has an unsubscribe link plus `List-Unsubscribe` headers (one-click supported). Sharing a note with a registered user now emails them (at most one email per sharer per minute).

### Security

- **CEK handoff tokens can no longer act as sessions.** A token from `GET /api/files/secure/cek-handoff` was signed with the session secret, so any `notes:read` credential could mint one and use it as a full session for five minutes. Handoff tokens now use a per-purpose key, session verification pins HS256 and rejects purpose-scoped tokens, and the endpoint needs `notes:edit`.
- **Note PINs now cover every surface.** The REST change feed and search no longer return diffs, snippets or comment threads of a PIN-locked note without its unlock (the note is listed by path only). The same applies to every MCP tool and prompt that reads or writes a note: `list_comments`, `add_comment`, `read_attachment`, the review/summarize prompts, and "multiple notes match" listings.
- **`POST /api/files/create` checks the PIN on the path it actually writes.** Sending `x` instead of `x.md` used to skip the check and overwrite the locked note.
- **Folder rename and delete cascades match paths exactly.** A shared folder named `__sers` or `_Users` could re-point or revoke other users' share links, grants and `/doc/` handles under `_users/`; prefixes are now compared exactly and case-sensitively.

### Fixed

- Renaming, deleting or purging a folder whose name contains `_` or `%` no longer touches the share links, grants, `/doc/` links, stars and history of look-alike paths (`my_notes` vs `my-notes`, or the personal folders of `john_doe@…` vs `john.doe@…`). These path matches treated `_` and `%` as SQL wildcards and ignored case; they now compare the exact prefix.
- When an external editor saves a vault note atomically (delete, then re-create), Kalepin no longer deletes its share link, revokes its grants and breaks its `/doc/` link: the file-watcher cleanup now checks the note is really gone.
- Deleting a folder now records a `deleted` change for each note inside it, and notes deleted on disk by other tools now show up in Changes and `get_updates`.
- An open editor no longer re-creates a note that was deleted elsewhere.
- Moving a folder in an encrypted zone now keeps the comment sidecars of nested notes, not just top-level ones.
- Search no longer fails when a quoted term contains a colon.
- A full search reindex now clears in-memory vectors of notes deleted since the last index.

### Changed

- The encryption sweep and `rotate-kek` now include trash folders, so trashed notes stay readable after a KEK rotation.

### Configuration

- New `TRASH_RETENTION_DAYS` (default `30`), `TEMPLATES_FOLDER` (default `Templates`), `DAILY_NOTES_FOLDER` (default `Journal`), `RELATED_NOTES_MIN_SCORE` (default `0.88`) and `NOTIFICATION_RETENTION_DAYS` (default `90`).

## 0.5.82 — 2026-10-26

### Added

- **Sign in with Microsoft (optional).** Teams on Microsoft 365 can sign in with their Entra ID work account, next to the magic link, which stays available to everyone. Single tenant only: Kalepin is pinned to one tenant and rejects tokens from any other. Accounts are matched by email, so existing magic-link users land in the same account, with the same notes and personal folder. Microsoft's tokens are used once and discarded. Off until configured; setup guide in [docs/microsoft-sso.md](docs/microsoft-sso.md).

### Configuration

- New optional `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET_FILE` / `SSO_MICROSOFT_CLIENT_SECRET` and `SSO_MICROSOFT_AUTHORITY_HOST`. A partial or invalid configuration logs a warning and leaves the button off; it never stops Kalepin from starting.
- `DOMAIN_ALLOWLIST` now applies to every login method and matches domains case-insensitively. An entry like `Example.com`, which used to match nobody, now matches `@example.com` addresses.

### Fixed

- **Magic links sent from the OAuth consent screen return to it.** The session token was appended after the `#/oauth/consent?request_id=…` fragment, so the SPA never saw it and the consent request was lost. It now goes before the fragment.

## 0.5.57 — 2026-05-01

### Added

- **Per-user "Personal" folders.** A new private namespace at `_users/{email}/...` (virtual) / `personal/{email}/` (physical), enabled by setting the new `PERSONAL_PATH` environment variable. Personal notes are owner-only across every surface — HTTP, WebSocket, MCP, full-text and semantic search, attachments, share links, change feed, link/graph, and mention notifications — and foreign personal paths return `404 Not Found` (existence is not observable). Auto-created on first authenticated request; auto-included in admin backup and the S3 backup roundtrip; soft-deleted to `personal/.deleted/{email}-{timestamp}/` on user removal.
- **Mention-suppression for personal notes.** Mentions in comments / doc-mentions / thread replies inside a personal folder are suppressed for any recipient other than the folder owner — closing an out-of-band content leak channel.
- **Attachment per-namespace routing.** Attachments uploaded inside a personal note land in `personal/{email}/_attachments/`. Shared notes' attachments stay at `vault/_attachments/`. Legacy embed URLs (`?name=X`) keep working unchanged. Cross-boundary moves copy the referenced attachment so the doc still renders at the destination.

### Configuration

- New `PERSONAL_PATH` env var (default unset). When set to a directory peer to `VAULT_PATH`, personal folders are enabled. When unset, storage stays single-root against `VAULT_PATH` (clean rollback).

### Security

- **Email canonicalization at the auth boundary.** JWTs are canonicalized once at issuance / verification (`canonicalizeEmail`); downstream code treats `req.user.email` as trusted. Strict regex rejects RFC-edge-case emails (quoted local parts, IDN/unicode local parts, whitespace, control characters) at auth-time so they cannot leak into LIKE patterns or path concatenations.
- **LIKE-pattern injection defense.** Email metacharacters (`_`, `%`) in legal addresses like `john_doe@x.com` no longer act as SQL `LIKE` wildcards across user boundaries — the search predicate binds `escapeLike(email)` and uses `ESCAPE '\\'`. Locked in by a CRITICAL regression test.
- Search FTS, comment search, vector search, link graph, change feed, and the MCP tool surface are all gated by a single visibility predicate (`isVisibleTo`).

## 0.5.56 — 2026-04-27

### Changed

- **Editor uses more of your screen on wide displays.** The note column now scales up on viewports wider than ~1400px (and again at 1700/2100/2500/3000px), so the prose stops looking stranded in the middle of an empty page on large monitors. Laptops keep the original measure.
- **Right panel is now collapsible.** A chevron toggle in the Comments/Backlinks/History tab row collapses the panel down to a 48px strip; expanded view returns when you click it (or any tab icon) again. The panel also auto-collapses when the current note has no comments and no backlinks, and re-expands automatically as soon as either appears.

## 0.5.55 — 2026-04-26

### Added

- **Connect Claude.ai directly to your notes.** Kalepin now ships a full OAuth 2.1 + PKCE authorization server, so Claude.ai web, Claude Desktop, and Claude mobile can connect to your vault without pasting an API key. Open **Settings → Connections → Connect** to walk through the setup; Claude redirects back to Kalepin to confirm the permission level (read, comment, or full).
- **Unified Connections settings.** The old "API keys" page becomes **Connections** — one place to see every Claude.ai grant *and* every CLI API key, with last-used timestamps and a single revoke action per row.
- **Per-connection scope downgrade.** When Claude requests `Full` access you can grant `Read` or `Read + Comment` instead, directly from the consent screen.
- **OAuth discovery metadata.** Public `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource` (RFC 9728) endpoints, plus a human-readable setup page at `/docs/mcp`.

### Security

- **Fixed an MCP session privilege-escalation bug.** Reusing a stranger's `Mcp-Session-Id` no longer borrows their scope. Mismatched-user requests now return 403 and the rejected attempt lands in the audit log.
- **Refresh-token rotation with replay-chain revocation.** OAuth refresh tokens are single-use; presenting a consumed token outside a 30-second leeway window revokes the entire chain and the active access token.
- **Immediate session sweep on revoke.** Revoking a grant or API key from Settings closes any matching MCP sessions instantly instead of letting them age out.

### Configuration

- New env var `OAUTH_CORS_ALLOW_LIST` (comma-separated origins) to allow extra browser origins to call `/mcp` and `/oauth/*`. `https://claude.ai` is always allowed.
- `APP_URL` is now load-bearing for OAuth discovery. Behind a TLS-terminating reverse proxy (e.g. Traefik), set it to the public `https://…` URL — the backend logs a WARN at boot when `X-Forwarded-Proto`/`X-Forwarded-Host` disagree with `APP_URL`.
- New env var `OAUTH_CONSENT_DISABLED=1` (off by default) keeps the OAuth endpoints reachable but blocks consent approval — useful as a safe staged-rollout switch.
- New env var `OAUTH_PREREGISTERED_CLIENT_IDS` (comma-separated) to inject known `client_id`s into `oauth_clients` at boot. Use only when claude.ai already has a connector registered with a hand-picked `client_id` (e.g. a connector installed before this OAuth feature shipped). Pre-registered rows are public clients (PKCE, no secret) locked to claude.ai's MCP callback.
