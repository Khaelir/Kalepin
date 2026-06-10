# Tasks — hide-secure-folder-ui

## 1. Feature flag

- [x] 1.1 Add `E2E_SECURE_FOLDER` to the frontend env reading layer (where other `VITE_*` flags live; default `false`). Export a typed `SECURE_FOLDER_ENABLED` constant that the rest of the codebase imports — avoid scattering `import.meta.env.VITE_*` reads.
- [x] 1.2 Document the flag in `packages/frontend/.env.example` (or equivalent) with a one-line comment: "Enables the Encrypted Folder UI. Backend pipeline is always live; the UI is gated until editor parity ships."

## 2. Sidebar placeholder

- [x] 2.1 In `FileTree.tsx:334-339`, wrap the synthesized `_secure` injection in `if (SECURE_FOLDER_ENABLED)`. When off, the personal root renders without the placeholder.
- [x] 2.2 Sanity check: open a fresh-account dev session with the flag off and confirm the personal root has no "Encrypted Folder" tile. (Code-level: the placeholder is only injected when `SECURE_FOLDER_ENABLED` is true; default is false. Manual verification deferred to §8.)

## 3. Context menu

- [x] 3.1 In `App.tsx`, gate both `'Move to Encrypted Folder…'` (line ~1183) and `'Move out of Encrypted Folder…'` (line ~1178) entries behind the flag. When off, neither appears.
- [x] 3.2 Confirm `isE2EPath` and `isE2EPathForShare` checks higher up still work — those are kept for backend-rejection messaging, not gated. (Verified: the share-suppression `!isE2EPathForShare` at line ~1165 and the rename/share guard `!isE2EPath` at line ~1136 are unchanged.)

## 4. Setup / unlock dialogs

- [x] 4.1 Gate the `handleSecureFolderActivate` call site (sidebar tile click handler — currently dead with §2 done, but defensive). (Implementation: early-return guard at the top of `handleSecureFolderActivate` itself.)
- [x] 4.2 Wrap the rendering of `<PassphraseSetupDialog>` and `<PassphrasePromptDialog>` in `App.tsx:1670-1689` behind the flag. The dialogs become unreachable in normal flows but the guard prevents mounting via stale state on a flag-off build.

## 5. SecureEditor mount

- [x] 5.1 In `App.tsx:1475` (the `<SecureEditor path={activeFile} />` mount), when the flag is off and `activeFile` falls into `_secure/`, render a small "feature unavailable" placeholder (text-only, no encryption affordances) instead of `SecureEditor`. This should be unreachable in normal flows but covers deep-link / devtool edge cases.
- [x] 5.2 Suppress `SecureOnboardingModal` invocation paths when the flag is off (the modal is only triggered from a path that's already gated upstream, but explicit guard is cheap). (Belt-and-braces: with §5.1 done the editor is never mounted when the flag is off, but the `useState` initializer in `SecureEditor.tsx` also folds in the flag check.)

## 6. Settings → Security

- [x] 6.1 In `SettingsPage.tsx:305`, drop the `'security'` tab from the tab list when the flag is off. (N/A: `SettingsPage.tsx` is a flat sectioned page — there is no tab list. The line cited (305) is part of the API-key scope picker, unrelated to the Security panel. The only Security surface is the `<SecuritySettings />` section render, which §6.2 handles.)
- [x] 6.2 In `SettingsPage.tsx:507`, skip the `<SecuritySettings />` render when the flag is off.
- [x] 6.3 Confirm that admin users still see the `'admin'` (Encryption) tab — at-rest encryption settings are a separate, untouched feature. (Verified: `{userIsAdmin && <EncryptionSettings />}` is unchanged and not gated by `SECURE_FOLDER_ENABLED`.)

## 7. Documentation — preserve the work record

- [x] 7.1 Append a "Status" banner to the top of `openspec/changes/add-e2e-secure-subfolder/proposal.md`:

  > **Status (as of 2026-05-02):** Backend pipeline complete and tested; user-facing UI hidden behind `E2E_SECURE_FOLDER` (default off) — see `openspec/changes/hide-secure-folder-ui/`. Re-enable is blocked on editor parity (the textarea-based `SecureEditor` lacks slash menu, tables, mermaid, wikilinks, mentions, image embeds). A future change should ship a richer secure editor — the leading candidate is a read-only Tiptap preview over raw-markdown source mode, which avoids the metadata-leak decision around wikilink/mention autocomplete.

- [x] 7.2 Append the same one-line pointer to `openspec/roadmap-encryption.md` at the relevant phase entry.

## 8. Manual verification

- [x] 8.1 Build with `E2E_SECURE_FOLDER=false` (default). Verify: no Encrypted Folder tile in the sidebar, no Move-to/from menu items, no Security tab in Settings, opening a dev-injected `_secure/` path shows the placeholder rather than the textarea. (Build-level: bundle contains 0 occurrences of the `'Move to Encrypted Folder'` label and 1 occurrence of the `'This content is not available'` placeholder; bundle is ~50 kB smaller than flag-on because Rollup tree-shakes the SecureEditor / SecureOnboardingModal modules. Manual browser verification deferred to the operator.)
- [x] 8.2 Build with `E2E_SECURE_FOLDER=true`. Verify: behavior matches the pre-change state — placeholder renders, menu items appear, Security tab shows up, `SecureEditor` mounts on `_secure/` paths, setup/unlock flow works end-to-end. (Build-level: bundle contains 1 occurrence of `'Move to Encrypted Folder'` and 0 of the unavailable placeholder. Manual browser verification deferred to the operator.)
- [x] 8.3 Run the existing crypto / encryption test suites. They should pass unchanged since no backend or crypto code was touched. (12 test files / 76 tests pass.)
