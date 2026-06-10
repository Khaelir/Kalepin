# Quiet the create-new-file flow

## Why

Creating a single new private file produces three toasts in the UI:

1. `File changed externally: …Untitled note.md.tmp.0d8580583738`  ← bug (watcher leaks the atomic-write tmp file)
2. `File changed externally: …Untitled note.md`                    ← bug (the user's own create echoes back as an "external" event)
3. `Untitled note.md is private. Share with user-2@kalepin.local too?`  ← intentional, but stacked behind two errors it feels like noise

This is a death-by-papercuts UX: any new note in a personal folder triggers a stack of toasts, two of which are factually wrong (the file was not changed externally — it was just created, by the same client, with no external editor involved). It also reveals an implementation detail (the `.tmp.<hex>` filename of the atomic-write pattern) that should never reach the UI.

## What Changes

### A. Filter `.tmp.<hex>` paths from the watcher broadcast

The atomic-write helper `LocalFSAdapter.writeBytesAtomic` writes to `<resolved>.tmp.<6-byte-hex>` and renames into place. Chokidar emits `add` and then `change` events for the tmp file before the rename. The current watcher gate in `OTGateway` is:

```ts
if (event.event === 'change' || (event.event === 'add' && event.path.endsWith('.md'))) {
  // → broadcast file:changed
}
```

The `change` branch has no extension/pattern filter, so a chokidar `change` on the tmp file becomes a `file:changed` broadcast. **The watcher SHALL skip events whose final basename matches `/\.tmp\.[0-9a-f]+$/`** — both the OT broadcast and the per-user fanout. This is one regex, applied uniformly.

(Alternative considered: write tmp files into a `.tmp/` subdir excluded from chokidar's watch root. Rejected — `LocalFSAdapter` is shared with paths the watcher must continue to see, and the per-event filter is a one-line change in one file vs. plumbing a new directory.)

### B. Self-saved paths cover REST writes, not just OT saves

`consumeSelfSaved(path)` is the existing mechanism for "this client just saved; suppress the watcher echo". It is registered only by the OT save flush path. REST creates / moves / restores do not register, so their watcher echoes leak as "external" toasts.

**The frontend SHALL register `selfSavedPaths.add(path)` before issuing `POST /api/files/create`, `POST /api/files/move`, `POST /api/files/version/restore`, and equivalents.** A short TTL (5s) protects against pathological cases where the watcher event is delayed or never fires (no permanent leak). Server-side echo suppression via a request-id round-trip was considered; the client-side registry is simpler and matches the existing OT flush pattern.

### C. The "share with X too?" nudge fires on first non-empty save, not on create

`maybePromptShareNewNote` currently fires from `App.handleCreateFile` immediately after the file is created. At that moment the file has no content, the user has not yet decided whether to keep it, and the toast is competing for attention with the new editor session. The user is also still on track to type a name for the file (renaming from `Untitled note.md`).

**The nudge SHALL fire after the first OT save that lands non-empty content** (or after the first explicit rename away from `Untitled`, whichever comes first), and only once per `(parentPath, path)` pair per session. A small in-memory map `nudgePendingByPath` tracks state.

### D. The `file:changed` toast is suppressed for the active document

When `msg.path === activeFileRef.current` and the editor already received the new content via the OT `doc:opened` flow, the toast is redundant. Today the code refreshes the editor content but *also* shows the toast. **The toast SHALL be suppressed when the path is the active document AND the OT session received the same revision within the last 2 seconds.** Out-of-band external editors still reach the toast (their writes don't go through OT and don't register `selfSaved`).

## Capabilities

### Modified Capabilities

- `ot-collaboration`: Watcher gate filters `.tmp.<hex>` paths; the active-document echo suppression rule for `file:changed` toasts is added.
- `external-write-sync`: The toast-suppression rule for the active document is documented (the `file:changed` event still fires; only the user-visible toast is gated).
- `personal-user-folders`: The "share with X too?" nudge is deferred to first non-empty save / explicit rename.

## Impact

- **Backend**:
  - `packages/backend/src/ot/ot.gateway.ts:62-105` — extend the `event.event === 'change' || …` gate with `&& !isAtomicWriteTmpPath(event.path)`. Same filter on the personal-watcher branch.
  - `packages/backend/src/files/file-watcher.service.ts` (or wherever the chokidar emit lives) — alternative location for the same filter. Pick whichever is closest to the source.
  - New helper `isAtomicWriteTmpPath(path)` colocated with `LocalFSAdapter` (so the tmp pattern stays defined in one place).
- **Frontend**:
  - `packages/frontend/src/self-saved-paths.ts` — already exists. Just call `selfSavedPaths.add(path)` from `api.createFile`, `api.moveFile`, `api.restoreVersion`. (Ideally wrap the api calls to make the registration unmissable.)
  - `packages/frontend/src/App.tsx:451-465` — the `file:changed` toast suppression for the active-doc-with-recent-OT-revision case.
  - `packages/frontend/src/App.tsx:813-868` — restructure `maybePromptShareNewNote` to fire on first non-empty save / first rename. Track pending state in a map keyed by `path`.
- **DB**: none.
- **Risk**: very low. The .tmp filter is a regex narrowing; it cannot leak more events than today. Self-saved-paths covering more code paths only narrows what reaches the toast surface. The nudge timing change is purely UX.
- **Tests**: an e2e test creates a new file in a personal folder where a sibling is shared; asserts that exactly zero toasts fire on creation, that the nudge fires after the first content save, and that no toast contains the substring `.tmp.`.
