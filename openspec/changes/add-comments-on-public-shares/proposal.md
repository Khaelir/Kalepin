# Add comments on public share-links (sign-in CTA flow)

## Why

Today, `/share/:code` resolves a public read-only view of a note. Comments do not appear and cannot be added — comments are an authenticated feature only. Users have asked for two related affordances:

1. Anonymous viewers should see the note's comments (read-only) so the discussion is part of the public artifact.
2. If they want to *contribute*, they should get a "Sign in to comment" CTA that returns them to the same share-link after authentication.

This shapes share-links from "static read-only snapshot" into "live document with public reading and authenticated participation". Cheap to add and aligned with the rest of the sharing direction (grants, PIN protection).

## What Changes

- **Public share-link page renders comments.** The viewer at `/share/:code` lists existing comment threads on the underlying path, in read-only mode. Threads are visible regardless of who created them.
- **"Sign in to comment" CTA.** When the viewer is not authenticated, the comment input is replaced by a button that opens an inline magic-link form. After magic-link verification, the user is returned to the same `/share/:code` URL with the comment input now active.
- **Authenticated commenting from a share link.** A logged-in viewer of `/share/:code` can post a comment as themselves; the comment is keyed by the underlying path (not the share-code), so it's visible from the original document too.
- **Stage-2 carve-out.** Share-links cannot be minted for E2E paths (the encryption capability already enforces this). Comments-on-shares therefore don't apply to E2E paths.
- **Spam control.** The CTA flow gates anonymous spam (you must auth to post). Per-user rate limit on comment creation: 30 comments / hour / user. Enforced by the existing comments service.

## Capabilities

### Modified Capabilities

- `share-links`: Public viewer page now renders comments and supports authenticated comment creation.
- `comments`: A new "comment was posted via share-link" provenance flag is recorded for audit (optional metadata, surfaced in the access log via the `'comment'` action — see `add-access-metadata`).

## Impact

- **Frontend**: `SharedNoteViewer` (or whatever the public viewer component is named) gains a comments panel and a sign-in CTA.
- **Backend**: comments controller is unchanged structurally; the existing path-keyed routes already work. Add a `via_share_code` optional column to `comments` if we want to track provenance (recommended).
- **Risk**: a public share with no PIN now has a comment surface, which is a bigger spam target than a static page. Rate-limiting + magic-link gate is the mitigation.
