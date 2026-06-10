# Tasks — public sharing overhaul

## 1. URL shape

- [x] 1.1 Split `urls.ts` builders: `buildShareLinkUrl(code)` → `/s/<code>` (recipient, code-only) vs `buildDocUrl(code, cosmetic)` → `/s/<code>/<cosmetic>` (in-app nav).
- [x] 1.2 `parseDocUrl` accepts both `/s/` (current) and `/d/` (legacy) prefixes.
- [x] 1.3 `Editor.tsx` in-doc link handler recognises both prefixes.
- [x] 1.4 `App.tsx` `Cmd-Shift-C` clipboard copy uses `buildShareLinkUrl`.

## 2. Mint and revoke gates

- [x] 2.1 Mint: `assertReadableBy` → `assertWritableBy` in `share-links.controller.ts:create`.
- [x] 2.2 Revoke: tightened to creator-or-admin (case-insensitive email match); legacy rows with null `createdByEmail` keep owner-or-admin fallback.
- [x] 2.3 `byPath` surfaces `createdByEmail`.
- [x] 2.4 `infoForCodeIncludingGone(code)` service method returns `{ path, createdByEmail }` for the gone-code authorization path.
- [x] 2.5 `ShareDialog` renders "Created by you / Created by alice@…" beneath the URL; disables Revoke for non-creators with tooltip.
- [x] 2.6 `canRevokePublicLink` frontend helper mirrors the backend gate.

## 3. Scoped tokens + anonymous read

- [x] 3.1 New `ScopedTokenService`: HMAC sign/verify for `(code, path)` content tokens and `(code, name, sharedNotePath)` asset tokens. base64url payload + signature.
- [x] 3.2 New `ShareLinkScopeGuard`: validates `Authorization: ShareLink <token>`, attaches `req.shareLinkContext`, refuses to set `req.user`, rejects cross-link replay (URL `:code` mismatch).
- [x] 3.3 New `OptionalAuthGuard`: passthrough for anonymous, validates Bearer via `CombinedAuthGuard` when present.
- [x] 3.4 Controller refactor: class-level guard removed; `create`/`revoke`/`byPath` keep `CombinedAuthGuard`; `resolve` uses `OptionalAuthGuard`.
- [x] 3.5 `resolve` response surfaces `sharedByEmail` + `accessToken` + `accessTokenExpiresAt`; token only emitted once PIN gate is satisfied.
- [x] 3.6 `GET /api/share-links/:code/content` (gated by `ShareLinkScopeGuard`): reads via `STORAGE_ADAPTER` directly, re-checks link health, refuses on path drift, applies PIN gate, records access-log row as `viewer=anonymous`.
- [x] 3.7 `POST /api/share-links/:code/pin/verify` (no auth): issues PIN unlock token keyed off synthetic `anonymous-<code>` identity.
- [x] 3.8 Unit tests for scoped-token sign/verify, scope guard, optional-auth guard.

## 4. Asset rewriter + asset endpoint

- [x] 4.1 `asset-rewriter.ts`: rewrites `_attachments/<name>` references in served markdown for markdown-image, markdown-link, and `<img>` shapes (single + double quotes). Traversal-looking names blanked.
- [x] 4.2 `AttachmentsService.serveForShareLink(name, sharedNotePath)`: trusted no-auth path; derives `_attachments` namespace from shared note's path.
- [x] 4.3 `GET /api/share-links/:code/asset?name=...&st=<token>` gated by per-asset token verification; re-checks link health on every fetch.
- [x] 4.4 `/content` endpoint returns rewritten markdown.
- [x] 4.5 Unit tests for asset-rewriter shapes.

## 5. Per-IP rate limits

- [x] 5.1 New `AnonymousRateLimitGuard` + `@RateLimit({ max, windowMs, name })` decorator. In-memory sliding window. Authenticated requests bypass. X-Forwarded-For aware. Soft eviction at 10k entries.
- [x] 5.2 Apply: `resolve/:code` 30/min, `:code/content` 60/min, `:code/asset` 240/min, `:code/pin/verify` 10/min.
- [x] 5.3 Unit tests for sliding-window correctness, bypass for authed, eviction.

## 6. Guest comments

- [x] 6.1 `ShortLink.allowGuestComments` boolean default false (TypeORM `synchronize=true` picks it up).
- [x] 6.2 `Comment.authorName?` + `Comment.authorVerified?` added to shared model; existing comments without these render as verified.
- [x] 6.3 `ShareLinksService.mintExplicit` accepts `allowGuestComments`; new `setAllowGuestComments` + `guestCommentingAllowed` helpers; `findByPath` + `infoForCodeIncludingGone` surface the flag.
- [x] 6.4 `POST /api/share-links` accepts `allow_guest_comments` in body.
- [x] 6.5 `PATCH /api/share-links/:code` (creator-or-admin) flips the flag.
- [x] 6.6 `POST /api/share-links/:code/comments` (`ShareLinkScopeGuard` + `AnonymousRateLimitGuard` 5/min): refuses when flag is off; validates email syntax + length caps; accepts new-thread + reply-thread shapes.
- [x] 6.7 `CommentsService.addGuestComment` + `replyToGuestThread`: persist `authorVerified=false`, INTENTIONALLY skip `sendMentionNotifications`. Test asserts no notification fan-out for `@-mention` in guest body.
- [x] 6.8 `resolve()` response surfaces `allowGuestComments` (alongside `sharedByEmail` / `accessToken` / `requiresPin`).
- [x] 6.9 `ShareDialog` "Allow guest comments" checkbox in public-link panel; visible only on active links; disabled for non-creators (mirrors Revoke gate). Toggling calls `updateShareLink`.

## 7. Guest viewer (frontend)

- [x] 7.1 New `GuestDocView` component: minimal TipTap read-only renderer (no WS, no OT, no presence, no command palette).
- [x] 7.2 Attribution header ("Shared by alice@…"). Sign-in CTA preserves deep link.
- [x] 7.3 Inline PIN entry calls `/pin/verify`, then re-resolves to fetch content with the now-issued access token.
- [x] 7.4 410 / error states render dedicated cards (no fall-through to login).
- [x] 7.5 Inline `GuestCommentBox` shown only when `allow_guest_comments=true`. Stores guest's name + email in `sessionStorage` for the visit.
- [x] 7.6 `App.tsx` routing: when `!token` AND URL is `/s/<code>` (or legacy `/d/<code>`), render `GuestDocView`; otherwise classic `LoginPage`.
- [x] 7.7 API client: `resolveShareLinkPublic`, `fetchShareLinkContent`, `verifyShareLinkPin`, `postGuestComment`, `updateShareLink` — anonymous-friendly, `Authorization: ShareLink <token>` for scoped routes.

## 8. Files / read polish

- [x] 8.1 `/api/files/read` returns ETag + 304 on `If-None-Match` match; client skips body and JSON+setState on 304.

## 9. Tests

- [x] 9.1 `share-links.controller.test.ts`: anonymous resolve flow (no PIN, with PIN, gone, unknown), content endpoint with valid + replayed token, asset endpoint with valid + traversal name, mint gate (write required), revoke gate (creator only), PATCH `allow_guest_comments`, guest comment endpoint (flag off → 403, flag on → 201, 5/min limit).
- [x] 9.2 `scoped-token.service.test.ts`: sign/verify round-trip; tampered payload rejected; cross-code replay rejected; expired token rejected.
- [x] 9.3 `share-link-scope.guard.test.ts`: valid token attaches `shareLinkContext`; missing token rejected; mismatched URL `:code` rejected; never sets `req.user`.
- [x] 9.4 `rate-limit.guard.test.ts`: per-IP sliding window; authed request bypasses; eviction at cap; X-Forwarded-For honoured.
- [x] 9.5 `asset-rewriter.test.ts`: markdown image, markdown link, `<img>` (both quote styles), traversal names blanked, non-attachment refs untouched.
- [x] 9.6 `comments.service.test.ts`: `addGuestComment` persists `authorVerified=false`; `@-mention` in guest body does NOT trigger mention notification.
- [x] 9.7 `route-hooks.test.ts`: anonymous content fetch records access-log row with `viewer=anonymous`.
- [x] 9.8 `urls.test.ts`: `buildShareLinkUrl` is code-only; `parseDocUrl` accepts `/s/` and `/d/`.
- [x] 9.9 `ShareDialog.test.ts`: creator-only Revoke gating; "Allow guest comments" checkbox toggles via `updateShareLink`.
- [x] 9.10 `personal-folders-ui.spec.ts` (e2e): updated for new ShareDialog gate (open does not mint, close does not copy).
