# Public sharing overhaul: guest viewer, scoped tokens, hardened mint/revoke

## Why

Once explicit-mint + expiry shipped (`tighten-public-share-links`), three rough edges remained on the public-sharing surface:

1. **Recipients still saw the folder structure.** The copied URL was `/d/<code>/<cosmetic-path>`, so anyone you shared a note with learned where it lived in your vault.
2. **Anonymous viewers were redirected to the login page.** The "share-link viewer" was actually the authenticated app: hitting `/share/:code` without a token bounced you through `LoginPage`, which is the wrong surface for someone who just wants to read the document and (maybe) leave a comment.
3. **Mint and revoke gates were too loose.** Read-only grantees could mint a public link from a note shared with them; any path-visible user could revoke a link they didn't create.

The result: public sharing was *technically* secure (codes were random, PIN gate worked, expiry worked) but the experience pushed recipients into a login flow they had no business in, leaked the cosmetic path, and let the wrong people both create and tear down public links.

This change closes the loop: a dedicated guest viewer at `/s/<code>` that fetches content with a scoped HMAC token, asset rewriting so attachments resolve without an authenticated session, per-IP rate limits on the anonymous endpoints, opt-in guest commenting, and a tightened mint/revoke gate.

## What Changes

- **Path-free public URL.** `/s/<code>` (no cosmetic) becomes the recipient-facing URL emitted by "Copy public link". In-app navigation keeps `/s/<code>/<cosmetic>` for stale-cosmetic recovery; the legacy `/d/<code>` prefix continues to resolve.
- **Scoped HMAC bearer tokens.** A new `ScopedTokenService` mints non-JWT tokens for `(code, path)` reads and `(code, asset)` reads. Tokens are sent via `Authorization: ShareLink <token>`; a leaked token cannot double as a session credential, and a token minted for one code is rejected on another.
- **Anonymous content endpoint.** `GET /api/share-links/:code/content` returns the rewritten markdown body. Gated by a `ShareLinkScopeGuard` that validates the scoped token and refuses to populate `req.user`.
- **Anonymous PIN unlock.** `POST /api/share-links/:code/pin/verify` (no auth) issues a PIN unlock token keyed off a synthetic `anonymous-<code>` identity.
- **Asset rewriter + scoped asset endpoint.** Markdown is post-processed before serving to guests: `_attachments/<name>` references are rewritten to `/api/share-links/:code/asset?name=...&st=<token>`, with the token scoped to that single asset. A new `AttachmentsService.serveForShareLink` derives the `_attachments` namespace from the shared note's path. Names that look like traversal are blanked.
- **Per-IP anonymous rate limits.** A new `AnonymousRateLimitGuard` (in-memory sliding window, X-Forwarded-For aware) gates the anonymous routes: resolve 30/min, content 60/min, asset 240/min, pin/verify 10/min, comments 5/min. Authenticated requests bypass.
- **Mint gate tightened: writable, not readable.** `POST /api/share-links` now requires write permission on the underlying path (`assertWritableBy`). Read-only grantees can no longer expose a vault file via a public link.
- **Revoke gate tightened: creator-or-admin.** `DELETE /api/share-links/:code` requires the requester to be the link's `created_by_email` (case-insensitive) or an admin. Legacy auto-minted rows (with null `created_by_email`) keep the previous owner-or-admin fallback so they remain manageable.
- **Surface creator on `byPath`.** The metadata blob now includes `createdByEmail`. `ShareDialog` renders "Created by you / Created by alice@…" beneath the URL and disables Revoke for non-creators with a tooltip.
- **Guest viewer (`GuestDocView`).** A new frontend component handles unauthenticated visits to `/s/<code>` (or legacy `/d/<code>`): minimal TipTap read-only renderer (no WS/OT/presence/command-palette), attribution header ("Shared by alice@…"), inline PIN entry, dedicated 410/error cards, and a Sign-in CTA that preserves the deep link via a `return=` parameter.
- **Opt-in guest commenting.** A new `allow_guest_comments` flag on the share-link row (default false). When on, guests can post comments via `POST /api/share-links/:code/comments` with a self-typed name + email; backend persists them with `authorVerified=false`. Mention notifications are intentionally skipped for guest comments — the email field is unverified, so honoring `@user` would let guests trigger arbitrary outbound mail. Toggled via `PATCH /api/share-links/:code` (creator-or-admin gate). UI: checkbox in `ShareDialog`'s public-link panel; inline `GuestCommentBox` in `GuestDocView` when the flag is on, with name/email persisted in `sessionStorage` for the visit.
- **Comment model gains `authorName` + `authorVerified`.** Existing comments without these fields render as verified by default.
- **`/api/files/read` ETag + 304.** Repeat opens of the same revision short-circuit body + client-side JSON+setState.

## Capabilities

### Modified Capabilities

- `share-links`: gains scoped tokens, anonymous content/asset/pin/comments endpoints, asset rewriting, per-IP rate limits, write-permission mint gate, creator-only revoke gate, `created_by_email` surfaced on `byPath`, `allow_guest_comments` flag + PATCH endpoint, path-free `/s/<code>` recipient URL.
- `comments`: `Comment` shape gains `authorName` + `authorVerified`; new `addGuestComment` / `replyToGuestThread` paths persist unverified guest comments and intentionally skip mention notifications.

### Added Capabilities

- `guest-viewer`: new frontend capability — a dedicated read-only viewer rendered when an unauthenticated user lands on a share URL. Replaces the previous "redirect to login" behaviour. Owns the inline PIN entry, attribution header, error states, sign-in CTA, and (when `allow_guest_comments` is on) inline guest commenting with sessionStorage-persisted identity.

## Impact

- **Backend**:
  - `packages/backend/src/share-links/scoped-token.service.ts` (new) — HMAC sign/verify for scoped tokens.
  - `packages/backend/src/share-links/share-link-scope.guard.ts` (new) — validates `Authorization: ShareLink <token>`; refuses to set `req.user`.
  - `packages/backend/src/share-links/optional-auth.guard.ts` (new) — best-effort auth wrapper around `CombinedAuthGuard`.
  - `packages/backend/src/share-links/rate-limit.guard.ts` (new) — `AnonymousRateLimitGuard` + `@RateLimit` decorator.
  - `packages/backend/src/share-links/asset-rewriter.ts` (new) — rewrites `_attachments/<name>` refs in served markdown.
  - `packages/backend/src/share-links/share-links.controller.ts` — `resolve` switches to `OptionalAuthGuard`; `POST` accepts `allow_guest_comments`; new `PATCH /:code`, `GET /:code/content`, `GET /:code/asset`, `POST /:code/pin/verify`, `POST /:code/comments`; `DELETE` tightened to creator-or-admin.
  - `packages/backend/src/share-links/share-links.service.ts` — `mintExplicit` accepts `allowGuestComments`; new `setAllowGuestComments`, `guestCommentingAllowed`, `infoForCodeIncludingGone`; `findByPath` + `mintExplicit` surface `allowGuestComments` and `createdByEmail`.
  - `packages/backend/src/entities/short-link.entity.ts` — adds `allowGuestComments` (TypeORM `synchronize=true` picks it up; no migration file).
  - `packages/backend/src/comments/comments.service.ts` — `addGuestComment`, `replyToGuestThread`; both skip `sendMentionNotifications`.
  - `packages/backend/src/attachments/attachments.service.ts` — `serveForShareLink(name, sharedNotePath)`.
  - `packages/backend/src/files/files.controller.ts` — `/read` ETag + 304.
  - `packages/shared/src/models.ts` — `Comment.authorName?`, `Comment.authorVerified?`.
- **Frontend**:
  - `packages/frontend/src/components/GuestDocView.tsx` (new, ~350 lines).
  - `packages/frontend/src/api.ts` — `resolveShareLinkPublic`, `fetchShareLinkContent`, `verifyShareLinkPin`, `postGuestComment`, `updateShareLink`.
  - `packages/frontend/src/urls.ts` — splits `buildShareLinkUrl` (recipient, `/s/<code>`, code-only) vs `buildDocUrl` (in-app, `/s/<code>/<cosmetic>`); `parseDocUrl` accepts `/s/`, `/d/`.
  - `packages/frontend/src/components/ShareDialog.tsx` — surfaces creator email, "Allow guest comments" checkbox, disables Revoke for non-creators.
  - `packages/frontend/src/App.tsx` — when `!token` and URL is `/s/<code>` (or `/d/<code>`), render `GuestDocView` instead of `LoginPage`; `Cmd-Shift-C` uses `buildShareLinkUrl` for clipboard copy; share-nudge fix on personal root.
  - `packages/frontend/src/editor/Editor.tsx` — in-doc link handler recognises both `/s/` and `/d/` prefixes.
  - `packages/frontend/src/utils/recent-files.ts` — hours calculation fix (incidental cleanup).
  - `BlockGutter` removed (unused, incidental cleanup).
- **Risk**:
  - In-memory rate-limit map is per-process. Multi-node deploys must swap for Redis before traffic justifies it; the guard surface (`@RateLimit`) is stable.
  - Asset rewriter is a regex-based markdown post-processor: tested for markdown-image, markdown-link, and `<img>` shapes (both quote styles), with traversal-looking names blanked. Exotic markdown (e.g. attachment refs inside fenced blocks) is rendered without rewrite — tolerable: the unrewritten reference simply 401s on the guest origin instead of leaking content.
  - Guest comment fan-out: `addGuestComment` + `replyToGuestThread` skip mention notifications. This is the most important security boundary in this change. Tested with an `@`-mention in the body to confirm no outbound mail.
