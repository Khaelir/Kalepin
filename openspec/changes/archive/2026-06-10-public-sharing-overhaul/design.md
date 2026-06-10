# Design: public sharing overhaul

## Why two URL shapes

Recipients see `/s/<code>` (path-free): no folder structure leaks, no stale-cosmetic redirects, the URL is the shortest thing we can hand someone. In-app navigation keeps `/s/<code>/<cosmetic>` so an authenticated user landing on a stale code can still recover the file by path. `parseDocUrl` accepts both `/s/` (current) and `/d/` (legacy), so previously-copied URLs still resolve.

`urls.ts` splits the two:

- `buildShareLinkUrl(code)` → `/s/<code>` — used by clipboard copy + email notifications.
- `buildDocUrl(code, cosmetic)` → `/s/<code>/<cosmetic>` — used by `history.pushState` + Editor nav.

## Why HMAC tokens, not JWTs

The scoped-token surface is `ScopedTokenService.signContentToken(code, path)` and `signAssetToken(code, name, sharedNotePath)`. Tokens are `base64url(payload).base64url(hmac)`, where the payload pins:

- `code` — the share-link code this token is bound to.
- `kind` — `"content"` or `"asset"`.
- `path` (content) or `name + sharedNotePath` (asset).
- `exp` — short TTL (minutes), refreshed on each `resolve` response.

We deliberately don't use JWT framing. Two reasons:

1. **No accidental session.** A leaked share-link token must never be mistakable for an auth credential. JWT-shaped tokens travel through middleware that knows about JWTs; an HMAC blob with `Authorization: ShareLink <token>` is unambiguous and `ShareLinkScopeGuard` is the only thing that accepts it.
2. **Cross-link replay is rejected at the URL layer.** The guard reads the `:code` from the URL and refuses if `payload.code !== url.code`. A token minted for code `abc` cannot read content under code `xyz` even if they share a path.

`req.user` is never set by `ShareLinkScopeGuard`. The controller code paths that branch on viewer identity check `req.shareLinkContext` instead.

## Why an OptionalAuthGuard on `resolve`

`GET /api/share-links/resolve/:code` serves both authenticated viewers (where it's used to upgrade the URL bar to the cosmetic path) and guests (where it's the entry point that returns `accessToken` + `requiresPin`). Two endpoints would duplicate the resolve logic; one endpoint with a guard that *passes through* anonymous and *validates* a Bearer when present is the smaller surface.

The token + PIN-state response is only emitted once the PIN gate is satisfied (or there is no PIN). A guest who hasn't completed PIN verification gets `requiresPin: true` and no `accessToken`.

## Why an asset rewriter, not a query-param-on-everything

Two alternatives we considered:

1. **Pass the access token as a query param to every attachment URL** — would require the frontend to be share-aware on every embed render. Couples the editor to share-link state.
2. **Mint a per-asset token at view time** — would require a round-trip per asset, defeating the point.

The chosen approach is server-side rewrite of the markdown body before sending it to the guest. `asset-rewriter.ts` walks markdown image/link shapes and HTML `<img>` shapes (both quote styles), and for any `_attachments/<name>` ref it emits `/api/share-links/:code/asset?name=<name>&st=<token>`. The token is signed with `(code, name, sharedNotePath)` so that:

- Re-using the token for a different `name` fails verification.
- Re-using the token under a different `code` fails the cross-link replay check.
- The asset namespace is derived server-side from the shared note's path; the guest never says "give me the personal-folder version".

Names that look like traversal (`..`, slashes, control chars) are blanked. The browser cannot dispatch a relative fetch from the guest origin if the `src` is empty.

`AttachmentsService.serveForShareLink` is the trusted no-auth path. Other entry points keep going through `serve()`.

## Why a synthetic anonymous identity for PIN unlock

The PIN-protection capability stores unlock tokens keyed by the unlocking user's identity. Guests have none. We synthesise one: `anonymous-<code>`. This:

- Keeps `pin/index.ts` unchanged.
- Scopes unlocks per share-link (a guest who unlocks code `abc` is not unlocked for code `xyz`, even on the same path).
- Means the unlock evaporates with the share-link: revoke or expire the code, and the synthetic identity is moot.

## Why per-IP rate limits, not per-token

Per-token rate limits would be sidestepped trivially: an attacker re-resolves to mint a new token and starts over. Per-IP limits with a sliding window are the right granularity for "guess random codes" and "scrape every asset for free." `X-Forwarded-For` is consulted so multi-node deploys behind a proxy still see real client IPs.

The numbers were picked to leave headroom for legitimate guest sessions:

| Endpoint | Limit | Rationale |
|---|---|---|
| `resolve/:code` | 30/min | Cheap; abuse vector is code guessing |
| `:code/content` | 60/min | Legit re-fetch on navigation |
| `:code/asset` | 240/min | Assets fan out — many per page |
| `:code/pin/verify` | 10/min | PIN brute-force resistance |
| `:code/comments` | 5/min | Spam ceiling for opt-in guest comments |

In-memory backing with a 10k-entry soft eviction. Multi-node deploys must swap for Redis before this matters; the `@RateLimit` decorator + guard surface is stable.

## Why `addGuestComment` skips mention notifications

The most important security boundary in this change. `authorEmail` on a guest comment is whatever the guest typed — unverified. If we honoured `@user` mentions, anyone with a public link could trigger an outbound notification email by typing `@victim` in a comment, with `authorName` set to whatever they like. The signal-to-noise on mentions would collapse, and worse, the guest could impersonate someone in the displayed comment.

`addGuestComment` and `replyToGuestThread` therefore:

- Persist `authorVerified=false` (rendered with a chip in the UI).
- Skip the mention-extraction + notify path entirely.

The unit test in `comments.service.test.ts` includes `@victim@example.com` in the guest body and asserts no notification was queued.

## Why the mint gate moved to writable

Read-only grantees by definition haven't been entrusted with control of the document. Letting them mint a public link gives them a way to extend their own read access into the world — strictly a privilege escalation by the original sharer's intent. `assertWritableBy` is the mint gate now: owners + write grantees + admins can mint.

This is a regression for any flow where a read-only grantee was minting public links. We checked: no internal flow does, and the previous behaviour was unintended (the gate was inherited from the read-only `resolve` path).

## Why creator-only revoke

Multiple users with read access to a path could previously revoke each other's links. That's a denial-of-share, not a security boundary. Creator-or-admin is the right gate; legacy auto-minted rows (created when auto-mint was on, before `tighten-public-share-links`) have a null `created_by_email` and we keep the previous owner-or-admin fallback for those — they're un-rotated, but at least they remain manageable.

`canRevokePublicLink` on the frontend mirrors the backend gate so the Revoke button is disabled (with a tooltip) for non-creators. The server is still the source of truth.

## Why `infoForCodeIncludingGone`

`DELETE /:code` and the gone-code page need to authorize against the link's `created_by_email` even after `revoked_at` is set or `expires_at` has lapsed. The previous fallback was a path-only resolver that didn't surface the creator. New service method returns `{ path, createdByEmail }` for the gone-code authorization path.

## Frontend routing decision

`App.tsx` checks the auth state + URL together. When `!token` and the path matches `/s/<code>` or `/d/<code>`, render `GuestDocView`. Otherwise render `LoginPage`. This is the seam — every other share-link affordance (deep-link preservation, PIN UI, attribution) lives inside `GuestDocView`.

`GuestDocView` deliberately doesn't reuse the authenticated editor:

- No WS connection, no OT, no presence.
- No command palette, no slash menu, no tour engine.
- TipTap in read-only mode with the same extensions the authenticated viewer uses for rendering, so the visual fidelity is identical without dragging in the collaborative machinery.

## Dependencies

- Builds on `tighten-public-share-links` (mint/expiry/revoke) and `add-per-note-pin` (PIN gate). Neither is hard-required at runtime, but the design assumes both.
- `add-access-metadata` is unaffected: anonymous content fetches still emit access-log rows with `viewer=anonymous`.

## Out of scope

- Multi-node Redis-backed rate limiting (see comment in `rate-limit.guard.ts`).
- CAPTCHA on the guest comment form (defer until spam appears).
- Guest reactions / read receipts.
- E2E paths: share-links cannot be minted for E2E paths (the encryption capability blocks it at mint time). Guest viewing of E2E paths is therefore not on the roadmap.
