# Tasks — note templates and daily notes

## 1. Renderer

- [x] 1.1 `templates/template-renderer.ts`: `renderTemplate(source, ctx)`, `formatDateTime(parts, format)`, `resolveTimeZone(tz)`, `todayIn(tz, now)`, `isValidDateKey(date)`, `prettifyEmailName(email)`.
- [x] 1.2 Unit tests: every variable, every format token, `[literal]`, unknown variables, no re-scan of substituted values, timezone day boundaries, invalid timezone fallback, `date` override with current time of day.

## 2. Templates service and config

- [x] 2.1 `templates/templates.config.ts`: `TEMPLATES_FOLDER`, `DAILY_NOTES_FOLDER`, personal-folders detection, folder-name validation.
- [x] 2.2 `TemplatesService.listTemplates(email)`: shared + own personal folder, recursive, visibility + E2E filtered, sorted.
- [x] 2.3 `resolveTemplateRef` (listed name/path, else literal path) and `readTemplate` (E2E → 400, non-`.md` → 400, assertReadable, PIN, read).
- [x] 2.4 `FilesService.createItem`: optional content factory `(leaf) => string` (creation path only).
- [x] 2.5 `createFromTemplate` (parent folder + optional name, `_secure/` parent → 400) and `renderTemplateRef` (explicit title, for MCP `create_note`).
- [x] 2.6 `dailyNote`: date validation, location, `Daily.md` lookup (personal wins), default content, per-path lock + idempotency.
- [x] 2.7 `createSampleTemplate`: idempotent `Templates/Meeting notes.md`.
- [x] 2.8 `{{author}}` lookup from `users.displayName` with prettified email fallback.

## 3. HTTP

- [x] 3.1 `TemplatesController`: `GET /api/templates`, `POST /api/templates/sample`, `POST /api/daily-notes` with scopes and PIN request plumbing.
- [x] 3.2 `VaultController`: accept `template` + `timezone` on `POST /api/vault/items`, delegate to `TemplatesService` via `ModuleRef`.
- [x] 3.3 `TemplatesModule` registered in `app.module.ts`.

## 4. MCP

- [x] 4.1 `create_note`: optional `template` + `timezone`, `content` optional and appended after the template.
- [x] 4.2 `daily_note` tool (note-write scope), PIN sentinel for locked notes; add to `REGISTERED_TOOLS`.

## 5. Backend tests

- [x] 5.1 Listing visibility: Bob never sees Alice's personal templates (with and without a grant); configured folder; subfolders; missing folder.
- [x] 5.2 Create from template: rendering, collision-resolved `{{title}}`, foreign template 404, PIN 423, E2E 400, folder kind 400.
- [x] 5.3 Daily note: location (personal on/off, configured folder), default content, personal `Daily.md` wins, idempotency, concurrent-create race, invalid date.
- [x] 5.4 MCP: `create_note` with template, `daily_note` round trip, tool catalog.

## 6. Frontend

- [x] 6.1 `templates.ts` pure helpers (local date key, browser timezone, grouping, shortcut matching, shortcut label) + vitest.
- [x] 6.2 `api.ts` (appended): `listTemplates`, `createNoteFromTemplate`, `openDailyNote`, `createSampleTemplate`.
- [x] 6.3 `CreatePopover`: actions strip (Today's note, From template…), template view with grouping, name field, keyboard navigation, empty state + sample action, disabled in the Encrypted Folder.
- [x] 6.4 `App.tsx`: `createFromTemplate` / `openTodayNote` handlers, popover props, ⌘⇧D / Ctrl+Shift+D shortcut.
- [x] 6.5 `styles.css`: appended `/* ── Templates ── */` block using `--kalepin-*` variables.

## 7. E2E and verification

- [x] 7.1 `packages/e2e/tests/note-templates.spec.ts`: new from template via the popover, empty-state sample, today's note via shortcut and idempotency, foreign template not listed.
- [x] 7.1a Run the e2e spec after merge (not run in the feature worktree: fixed ports). Required before archiving. Passed on the merged branch (heading assertions loosened to `toContainText` for the editor's `#` anchor glyph).
- [x] 7.2 Backend build + new and neighbouring unit tests; frontend `tsc -b` + vitest.
- [x] 7.3 `openspec validate add-note-templates --strict`.
