# Design: per-grantee view stats in share dialog

## Endpoint shape

`GET /api/notes/:path/access-summary` (path is URL-encoded), authn'd, owner-or-admin gate.

```json
{
  "grantees": [
    {
      "email": "alice@example.com",
      "view_count": 12,
      "last_view_at": 1714760000000,
      "last_edit_at": 1714720000000
    },
    {
      "email": "bob@example.com",
      "view_count": 0,
      "last_view_at": null,
      "last_edit_at": null
    }
  ],
  "anonymous": {
    "resolve_count": 47,
    "last_resolve_at": 1714767000000
  }
}
```

## Query plan

Two queries (both indexed by `(path, ts DESC)`):

```sql
-- Per-grantee aggregate (joined with the active-grants list to scope output)
SELECT
  viewer_email,
  SUM(CASE WHEN action IN ('view','fetched') THEN 1 ELSE 0 END) AS view_count,
  MAX(CASE WHEN action IN ('view','fetched') THEN ts END) AS last_view_at,
  MAX(CASE WHEN action = 'edit' THEN ts END) AS last_edit_at
FROM note_access_log
WHERE path = :path
  AND viewer_email <> 'anonymous'
GROUP BY viewer_email;

-- Anonymous aggregate (one row)
SELECT
  COUNT(*) AS resolve_count,
  MAX(ts) AS last_resolve_at
FROM note_access_log
WHERE path = :path
  AND viewer_email = 'anonymous'
  AND action = 'share-link-resolved';
```

The grantees query returns rows for every viewer that touched the path. The frontend joins this with the grants list and **only renders rows whose email is in the active grants**. This is the privacy filter — see below.

## Why filter to active grantees only

The access log is the system's truth about who viewed; the grants list is the system's truth about who has access. They diverge in three cases:

1. **Revoked grantee**: had access, viewed it 5 times, was revoked. Their rows exist in `note_access_log`. We do not surface them in the summary — leaking "we revoked them but they had viewed it" is unnecessary signal.
2. **Owner**: the owner's own views are in the log (every owner-open hits the read route). They are also not in the grants list. We do not surface owner-self-views as a "grantee" row, but the summary's `you viewed this 5 times` could be a separate field if desired (out of scope for v1).
3. **Anonymous public-link viewers**: surfaced as the dedicated `anonymous` aggregate, not interleaved with grantee rows.

This means the summary is always a strict subset of "rows the current user can already see in the grants list". No new identity is leaked.

## UI sketch

```
┌────────────────────────────────────────────────────────────────────┐
│  Public link                                                       │
│  https://kalepin.example.com/d/abc123def0/Notes-foo                │
│  ┌──────┐                            47 anonymous · last 12m ago   │
│  │ Copy │  Expires: 30 days ▾   [Revoke]                            │
│  └──────┘                                                           │
├────────────────────────────────────────────────────────────────────┤
│  People with access (3)                                            │
│  alice@example.com   · 12 views · last 3h ago     [Read    ▾] [Revoke] │
│  bob@example.com     · Not yet viewed             [Comment ▾] [Revoke] │
│  carol@example.com   · 4 views · last yesterday   [Write   ▾] [Revoke] │
└────────────────────────────────────────────────────────────────────┘
```

`Not yet viewed` is the empty-state phrasing. We do NOT show "0 views" because that conflates "never viewed" with "viewed but log was pruned" (retention default 90d).

## Why a separate endpoint, not joined onto `/api/grants`?

Two reasons:
- **Authz boundaries are different in the future.** Today both endpoints are owner-or-admin. If we ever want to expose the grants list to the *grantee* (so they can see "who else has access"), the grants endpoint widens; the access-summary stays owner-only. Keeping them separate lets us evolve them independently.
- **The grants list is small and cheap; the summary is heavier (DB aggregate). Don't pay the cost when the dialog only needs the grants list (e.g., a folder-mode share where the dialog doesn't show summary at all).**

## Stage-2 awareness

For `isE2EEncrypted(path)` true:
- The summary's `view_count` aggregates `'fetched'` rows.
- The frontend renders `· 12 fetched · last 3h ago` with a tooltip ("Server saw 12 ciphertext downloads — actual decryption status unknown").
- The anonymous public-link row is suppressed (E2E paths cannot mint share-links per the existing predicate contract).

## What we are NOT doing

- **Not** surfacing grantee→grantee visibility (Bob doesn't see Alice's view count).
- **Not** showing per-grantee timeline (only count + last-ts).
- **Not** logging downloads of anonymous public-link viewers as anything other than the existing `'share-link-resolved'` row — the public viewer doesn't have a "view" event distinct from "resolve".
