# Design: tighten public share-links

## Why "stop auto-minting" is the load-bearing change

Today's flow:

```
User opens a private note → openFile() → POST /api/share-links → row inserted
  ↓
URL bar now reads /d/<code>/<cosmetic-path>
  ↓
Cmd-L, Cmd-C → user just copied a publicly-resolvable URL
  ↓
... weeks later ...
  ↓
That URL still resolves. There is no UI to revoke it. The user does not
necessarily remember the row exists.
```

The auto-mint is what makes the URL bar contents *equal* to the share-link. That equality is convenient for the "casual share" case but it makes the privacy contract unclear: the user cannot tell from the URL bar whether they are looking at a private-routing URL or a public-share URL. They are the same thing.

After this change:

```
User opens a private note → openFile() (no mint)
  ↓
URL bar reads ?file=/path/to/note (or /n/<noteId>, future internal scheme)
  ↓
Copying it does NOT grant access — anyone hitting that URL gets the auth wall
  ↓
User clicks Share → ShareDialog → "Generate public link" → row inserted
  ↓
URL bar updates to /d/<code>/... AND the copy button populates the clipboard
  ↓
User now holds a public-resolving URL, with full awareness it is one
```

Mint becomes an explicit user action, gated by a dialog that shows the consequences.

## Schema delta

```sql
ALTER TABLE short_links ADD COLUMN expires_at INTEGER NULL;        -- unix ms; null = never
ALTER TABLE short_links ADD COLUMN created_by_email TEXT NULL;     -- canonical email; nullable for legacy rows
ALTER TABLE short_links ADD COLUMN revoked_at INTEGER NULL;        -- unix ms; null = active

CREATE INDEX idx_short_links_path ON short_links (path);           -- needed for findByPath
```

Legacy rows (pre-migration) have `expires_at = null`, `created_by_email = null`, `revoked_at = null` — they continue to behave as before. The migration is purely additive.

## Resolution semantics

`GET /share/:code` (the public viewer) and `GET /api/share-links/resolve/:code` (the authenticated re-resolver):

```
SELECT path, expires_at, revoked_at FROM short_links WHERE code = ?
  ├─ row missing                    → 404
  ├─ revoked_at IS NOT NULL         → 410 Gone (with a "this link was revoked" page)
  ├─ expires_at IS NOT NULL && now > expires_at → 410 Gone (with a "this link expired" page)
  └─ otherwise                      → resolve to path normally
```

410 is correct: the URL was once valid and is intentionally no longer. 404 is reserved for "this code never existed".

## Default expiry: why 30 days for personal, never for shared

Personal notes are the high-stakes case (the user has explicitly placed them outside the shared vault). A bounded default mimics the per-recipient grant defaults shown to the user in `ShareDialog` and matches the principle of "private things should expire by default; shared things are already public-by-construction so a perpetual public link is not worse than the existing access posture".

Operators can override the default via a config knob (`SHARE_LINK_DEFAULT_TTL_MS_PERSONAL`, `SHARE_LINK_DEFAULT_TTL_MS_SHARED`) — the user-facing select still wins per-mint.

## Migration plan

Two stages in the same release:

1. **Ship the schema + endpoints + dialog UI.** Auto-mint still happens (no behaviour change). The dialog now exposes mint/revoke/expiry controls. Users can begin curating their existing links.
2. **Flip the auto-mint switch.** A subsequent commit removes the `api.createShareLink(path)` call from `openFile`. URLs in the address bar stop auto-upgrading. Existing in-flight URLs (already-copied) still resolve as before.

This order means stage 1 is fully backwards compatible (no observable behaviour change for users who never open the dialog), and stage 2 is the one that changes the URL-bar contract.

## What about the existing leaked URLs?

Operators who want a clean break can run `node packages/backend/dist/cli/expire-legacy-share-links.js --before <date>` (a small CLI we add) which sets `expires_at = now` on all rows where `created_by_email IS NULL` (i.e., minted by the legacy auto-mint code). Default-off — privacy-conscious deployments opt in.

## What we are NOT doing

- **Not** removing the share-links capability or making everything per-recipient. There is a real use case for "send this link to someone whose email I don't know". Just give it controls.
- **Not** introducing access-control on the `/share/:code` endpoint itself (that's the existing capability's job; PIN protection is the upgrade path for sensitive public links).
- **Not** changing the `/d/<code>/<cosmetic-path>` URL scheme. Codes still resolve to paths the same way.
