## Why

Every note in Kalepin starts empty. Teams that run recurring meetings, weekly reviews or a personal journal re-type the same skeleton each time, and users coming from Obsidian expect their `Templates/` folder and `{{date}}`-style variables to just work. A daily journal note is the most common recurring note and today takes several clicks (pick folder, create, rename to the date).

## What Changes

- **Template folders.** `Templates/` at the vault root (shared) plus `_users/{email}/Templates/` (personal, owner only) when personal folders are enabled. The folder name is configurable via `TEMPLATES_FOLDER` (default `Templates`). Any `.md` file in that folder (subfolders included) is a template. `_secure/` templates are not supported.
- **Obsidian-compatible variables.** `{{title}}`, `{{date}}` (`YYYY-MM-DD`), `{{time}}` (`HH:mm`), `{{date:FORMAT}}` / `{{time:FORMAT}}` with a moment-style token subset (`YYYY YY MMMM MMM MM M DD D Do dddd ddd HH H hh h mm ss A a`, `[literal]`), plus Kalepin extras `{{author}}` and `{{author_email}}`. Unknown variables are left untouched. Rendering is server-side, in one pure function, in the caller's IANA timezone (validated, falling back to the server timezone).
- **`GET /api/templates`** lists the templates visible to the caller (`name`, `path`, `scope: shared|personal`) and the configured folder name.
- **Create from template.** `POST /api/vault/items` (behind `createVaultItem`) accepts optional `template` (path or name) and `timezone`; the note is created with the rendered template using the existing naming/collision logic. The template read passes the same visibility and PIN checks as any note read.
- **Sample template.** `POST /api/templates/sample` creates `Templates/Meeting notes.md` with a sample that uses a few variables (idempotent), so an empty vault can discover the feature.
- **Daily notes.** `POST /api/daily-notes` with `{ date: 'YYYY-MM-DD', timezone }` returns the path and id of that day's note, creating it if missing: `_users/{email}/Journal/YYYY-MM-DD.md` when personal folders are enabled, otherwise `Journal/YYYY-MM-DD.md` (`DAILY_NOTES_FOLDER`, default `Journal`). Content comes from a template named `Daily.md` (personal wins over shared), else `# {{date:dddd, MMMM D, YYYY}}`. Idempotent and race-safe.
- **MCP.** `create_note` gains optional `template` (and `timezone`) arguments; a new `daily_note` write-scope tool returns path, id and content.
- **UI.** The create popover gains "From template…" (templates grouped Shared / Personal, an optional name, empty-state hint with a "Create a sample template" action) and "Today's note". A global shortcut ⌘⇧D / Ctrl+Shift+D opens today's note.

## Capabilities

### New Capabilities

- `note-templates`: template folders and listing, the variable renderer, creating a note from a template (REST + MCP), the sample template, and the create-popover template picker.
- `daily-notes`: the daily-note endpoint, its location and content rules, idempotency, the `daily_note` MCP tool, and the keyboard shortcut / popover entry.

### Modified Capabilities

- `mcp-tool-registration`: `daily_note` joins the write tools registered for `rw` / `admin` / JWT sessions only.

## Impact

- **Backend** (new module `packages/backend/src/templates/`):
  - `template-renderer.ts` (pure renderer + timezone helpers), `templates.config.ts` (env), `templates.service.ts`, `templates.controller.ts` (`GET /api/templates`, `POST /api/templates/sample`, `POST /api/daily-notes`), `templates.module.ts`.
  - `files/files.service.ts` — `createItem` takes an optional content factory `(leaf) => string` so the rendered `{{title}}` matches the collision-resolved name. Creation path only.
  - `files/vault.controller.ts` — `POST /api/vault/items` accepts `template` + `timezone` and delegates to `TemplatesService` (resolved lazily through `ModuleRef` to avoid a Files ↔ Templates module cycle).
  - `mcp/mcp.service.ts`, `mcp/mcp.module.ts` — `create_note.template`, `daily_note` tool.
  - `app.module.ts` — registers `TemplatesModule`.
- **Frontend**:
  - `api.ts` — `listTemplates`, `createNoteFromTemplate`, `openDailyNote`, `createSampleTemplate` (appended).
  - `templates.ts` (new, pure helpers: local date key, browser timezone, grouping, shortcut matching).
  - `components/Sidebar/CreatePopover.tsx` — template view and Today's note entry.
  - `App.tsx` — wiring and the ⌘⇧D shortcut. `styles.css` — one appended `Templates` block.
- **Config**: new env vars `TEMPLATES_FOLDER`, `DAILY_NOTES_FOLDER`.
- **Compatibility**: templates and daily notes are plain `.md` files in ordinary folders; Obsidian sees and can edit them. Obsidian's own Templates / Daily notes plugins can point at the same folders.
- **Risk**: ⌘⇧D is "Bookmark all tabs" in Chrome/Firefox and "Add to Reading List" in Safari; the app calls `preventDefault`, which works in Chromium and Firefox. Where a browser refuses, the popover entry remains.
