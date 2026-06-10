# Design — hide-secure-folder-ui

## Decisions

### Why a build-time flag, not a runtime setting

Build-time (`E2E_SECURE_FOLDER` in `import.meta.env`) keeps the dormant code paths from being reachable in shipped bundles for the off-state. We are not trying to A/B-test or cohort users — we want the feature off by default and re-enable simultaneously when the editor parity work lands. Build-time is the simplest mechanism that matches that intent.

If a runtime gate is later needed (e.g. enable for a single internal tester), it can replace the build flag without changing the surface list. Out of scope for this change.

### Why keep the backend live

The backend is complete and tested (see `add-e2e-secure-subfolder/tasks.md`). Removing it would create a two-step path back: hide UI now, then re-implement and re-test the backend later. Keeping it live means the re-enable is purely a frontend diff. Cost is near-zero: dormant routes do not affect users who never reach a `_secure/` path.

### Why drop "Move out of Encrypted Folder…" entirely

The "Move out…" action exists so users with `_secure/` content can rescue it back to plaintext. That justification disappears here: no user has `_secure/` content. Keeping it would require keeping its trigger (right-click on a `_secure/` file) which requires keeping the synthesized placeholder so the user can navigate into the folder, which is the very surface we're hiding. Dropping both move actions is the consistent choice.

If, in some edge case, a developer or test fixture has created `_secure/` content locally, the API endpoints still work — they would just need to be invoked from devtools or a script. That's an acceptable escape hatch given how unlikely the case is.

### Why route stray `_secure/` paths to a placeholder, not silently fall through

If somehow a path starting with `_secure/` becomes the active file (e.g. URL deep-link, dev console), the current code mounts `SecureEditor`. With the flag off, mounting that editor would advertise the hidden feature. Routing to a generic "this content is not available" placeholder keeps the hidden surface hidden without needing the editor. Cheap defense in depth.

### Why not archive `add-e2e-secure-subfolder`

OpenSpec archives are for shipped, user-visible work. The user-visible part of this feature isn't shipping; the backend foundation is being preserved for a future re-enable. Archiving it would make it harder for a future contributor to find the unfinished editor-parity question. It stays in `openspec/changes/` with a status banner pointing at this hide change.

## Surface map

| Surface | File | Action |
|---|---|---|
| Synthesized `_secure` tile | `FileTree.tsx:334-339` | Skip when flag off |
| Context menu — Move to / out | `App.tsx:1171-1185` | Drop both entries when flag off |
| Setup/unlock trigger | `App.tsx:517-540` | No-op when flag off |
| Setup/unlock dialogs | `App.tsx:1670-1689` | Render guard (defensive) |
| Onboarding modal trigger | `SecureEditor.tsx:32` (and indirectly via `SecureOnboardingModal`) | Suppress invocation |
| `SecureEditor` mount | `App.tsx:1475` | Replace with "unavailable" placeholder when flag off |
| Settings → Security tab | `SettingsPage.tsx:305` | Hide tab when flag off |
| Settings → Security panel | `SettingsPage.tsx:507` | Skip render when flag off |

## What stays untouched

- `packages/frontend/src/crypto/**` — crypto modules.
- `packages/backend/**` — encryption pipeline, ClientKEKSource, predicates, secure read/write/move/reset endpoints.
- `Breadcrumb.tsx`, `VaultHeader.tsx`, `CreatePopover.tsx` — relabeling logic stays. Dormant when no `_secure/` path is reachable.
- `EncryptionSettings.tsx` — admin at-rest encryption panel (different feature).
- All tests under `packages/backend` and `packages/frontend/src/crypto`.

## Re-enable path

When a future change ships a richer secure editor (e.g. read-only Tiptap preview + raw-markdown source mode), the re-enable is:

1. Set `E2E_SECURE_FOLDER=true` in the relevant build env.
2. Restore the synthesized placeholder, the two context-menu entries, the onboarding trigger, the `SecureEditor` mount, the Settings tab visibility, the Settings panel render.
3. Remove the "feature unavailable" placeholder route.
4. Update `add-e2e-secure-subfolder/proposal.md` status banner to reflect ship.
