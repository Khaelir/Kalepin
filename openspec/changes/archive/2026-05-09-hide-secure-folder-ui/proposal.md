# Hide the Encrypted Folder UI behind a feature flag

## Why

`add-e2e-secure-subfolder` shipped the backend pipeline (envelope crypto, ClientKEKSource, predicate flips, move endpoints, vault management API) and a minimal client surface (`SecureEditor` textarea, sidebar placeholder, setup/unlock dialogs, Settings → Security panel). The textarea editor is feature-poor compared to the Tiptap-based `Editor.tsx`: no slash menu, no tables, no mermaid, no wikilinks, no mentions, no image embeds. Reaching parity is a real chunk of work (~500–800 LOC plus encrypted-attachment plumbing and a metadata-leak decision on wikilink/mention autocomplete) and we don't want to embark on it now.

No user has put content into `_secure/` yet — the feature has not shipped externally. So we can hide the entry points without a rescue path. The backend code, crypto modules, predicates, API endpoints, and tests stay in place. Only the user-facing surfaces are gated, so re-enabling is one config flip when a future change ships a richer secure editor (the explored "option C" — read-only Tiptap preview with raw-markdown editing — is a candidate).

## What Changes

- Add a build-time feature flag `E2E_SECURE_FOLDER`, default `false`.
- Gate every user-facing surface behind the flag:
  - **FileTree synthesized placeholder** (`FileTree.tsx:334-339`): skip when flag off, so the "Encrypted Folder" tile no longer appears under the personal root.
  - **Context menu**: drop the "Move to Encrypted Folder…" and "Move out of Encrypted Folder…" entries (`App.tsx:1178, 1183`). With no `_secure/` content existing, dropping both is safe.
  - **Setup / unlock dialogs**: do not trigger `handleSecureFolderActivate` (`App.tsx:517-540, 1670-1689`).
  - **First-run onboarding modal**: never invoke `SecureOnboardingModal`.
  - **`SecureEditor` mount**: when flag off, route any path under `_secure/` to a "feature unavailable" placeholder rather than the textarea (defensive — should not be reachable, but prevents stranded states).
  - **Settings → Security tab**: hide the tab in `SettingsPage.tsx:305` and skip the `<SecuritySettings />` render at `SettingsPage.tsx:507`.
- Document the "preserved-but-dormant" status of `add-e2e-secure-subfolder` so a future contributor can find it: append a status banner to that change's `proposal.md` pointing at this hide change and the open editor-parity question.

## Non-goals

- **Do not** delete or revert any backend code, crypto modules, API endpoints, or tests. The work stays intact and exercised by its own test suite.
- **Do not** touch `EncryptionSettings.tsx` (admin-only at-rest encryption — a separate feature that is shipped and remains visible).
- **Do not** touch the path-prefix labels (`Breadcrumb.tsx`, `VaultHeader.tsx`, `CreatePopover.tsx`): those become dormant naturally because no `_secure/` path is ever surfaced. Keeping them intact avoids making the re-enable diff larger.
- **Do not** archive the `add-e2e-secure-subfolder` change. It remains active in `openspec/changes/` because the user-facing feature is not shipped.
