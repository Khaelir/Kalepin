## Context

Kalepin has a working change tracking backend (`note_changes` table, `ChangeTrackingService`, `GET /api/updates`) built for MCP/LLM consumption. The frontend is React 19 + TipTap in a three-column workspace layout (file tree | editor | comments panel). There is no UI for viewing changes, no user attribution on changes, and no way to prioritize watching specific files.

Files are plain markdown on disk — the filesystem is the source of truth. Obsidian cross-editor compatibility is a non-negotiable constraint, so no file-level UUIDs or frontmatter modifications.

## Goals / Non-Goals

**Goals:**
- Surface changes-since-last-visit in the app UI without requiring an LLM
- Show who made each change (multi-user attribution)
- Let users star files/folders for priority change notifications
- Keep stars and change history intact across file renames
- Non-obtrusive — users who don't care can ignore the feature entirely

**Non-Goals:**
- LLM-powered summarization in the frontend
- Real-time push notifications (browser notifications, email)
- Per-line authorship (git-blame-style)
- File UUIDs or frontmatter modifications

## Decisions

### 1. Toolbar icon with badge + dropdown panel (not sidebar, not modal)

A dropdown panel anchored to a toolbar icon. Not a sidebar tab (this is an occasional "catch up" action, not persistent), not a modal (too heavy for a glance).

The icon shows a badge with change count only when changes exist. Hover tooltip shows "What's changed — N changes across M files since [date]". Clicking opens the panel.

**Badge behavior:** Badge persists until the user explicitly clicks "Mark all as seen" — not auto-cleared on panel open. This prevents losing track if you open the panel and get distracted.

### 2. User attribution via userId column on note_changes

Add a nullable `userId` integer column to the `note_changes` table. Pass userId through from:
- OT flush path: the session tracks connected clients with userId
- Non-OT write path: the files service has request context with userId

The `GET /api/updates` response filters out changes where `userId = currentUser.id` so you only see what others changed.

**Why not email?** userId is stable, lightweight, and joins to the users table for display name if needed later. Email could change.

**OT flush attribution:** When multiple users contribute to a document between flushes, the diff is attributed to the user who applied the most recent operation. This is imprecise but acceptable — the goal is "someone else changed this", not per-line blame.

### 3. Stars: path-based with rename repair (no UUIDs)

Stars reference file paths (or folder path prefixes) directly. No UUID indirection — this preserves the markdown-first, filesystem-as-source-of-truth architecture.

When chokidar detects a file rename (unlink + add with matching content within a debounce window), update the path in both `starred_items` and `note_changes`.

**Folder stars** are stored as path prefixes (e.g., `"projects/"`). A change matches a folder star if its path starts with the prefix.

**Max 5 starred items per user.** Keeps toasts manageable and forces intentionality.

### 4. Changes panel layout: starred section on top, diffs collapsed

```
┌─ What's changed ──────────────────────────┐
│  Since Mar 11 (2 days ago)                 │
│  5 changes across 3 files                  │
│                                            │
│  ★ Starred                                 │
│    ★ api-spec.md        alice · 2h         │
│      @@ -12,3 +12,5 @@                    │
│      + new endpoint: /v2/users             │
│                                            │
│  Other changes                             │
│    ✎ roadmap.md          bob · 10h         │
│      ▸ Show diff                           │
│    + new-idea.md         bob · 1d          │
│      (new file — 24 lines)                 │
│                                            │
│           [ Mark all as seen ]             │
└────────────────────────────────────────────┘
```

- Starred changes: first diff expanded by default
- Other changes: diffs collapsed by default
- File names are clickable — navigates to the file in the editor
- Relative timestamps ("2h", "1d")
- User email/name shown inline

### 5. Toast on page load for starred file changes only

When the app loads and there are changes to starred files, show a toast:
"★ api-spec.md was modified by alice · 2h ago"

Max 3 toasts (aggregate if more: "★ 4 starred files changed"). Non-starred changes are silent.

### 6. Badge escalation for starred changes

```
Normal changes only:     ↻ 5        (default/muted style)
Starred file changed:    ↻★ 5       (accent color, star indicator)
```

The badge visually distinguishes "things changed" from "things you care about changed".

### 7. File tree star toggle

On hover over a file or folder in the file tree, show a ☆ icon. Click to toggle star. Starred items show a persistent ★. Enforce the 5-item cap in the UI with a tooltip ("Maximum 5 starred items — unstar one first").

## Risks / Trade-offs

- **[Rename detection reliability]** Chokidar reports renames as unlink+add. Correlating them requires a debounce window and content matching. Edge case: if two files are swapped simultaneously, correlation could misfire. Acceptable for the rarity of this case.
- **[OT flush attribution imprecision]** Multi-user edits between flushes get attributed to the last editor. Users may occasionally see "alice changed X" when bob also contributed. Acceptable — this isn't git blame.
- **[Stale badge]** Badge persists until explicit dismiss. Users who never click "Mark as seen" will accumulate an ever-growing count. Could cap display at "99+" and prune old changes normally.
- **[Folder star matching]** A folder star `"projects/"` won't match if the folder is renamed to `"Projects/"` (case sensitivity). File renames are handled, but case changes in folder names are an edge case.
