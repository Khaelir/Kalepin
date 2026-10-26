# Design — note templates and daily notes

## Goals

- Obsidian users can keep using their `Templates/` folder and `{{date}}` variables; files stay plain markdown.
- One keystroke opens today's journal note, created from a `Daily.md` template when present.
- No new path can bypass the existing visibility, grant, PIN and E2E rules.

## Non-goals

- Templater syntax (`<% %>`), date arithmetic (`{{date+1d}}`), `{{yesterday}}` / `{{tomorrow}}`, localized month/day names, configurable default `{{date}}`/`{{time}}` formats.
- Inserting a template into an existing note (Obsidian's "Insert template" command). Templates only seed new notes.
- Templates inside, or notes created from templates into, `_secure/` (the server never sees E2E plaintext, so it cannot render there).

## Module layout

```
packages/backend/src/templates/
  template-renderer.ts     pure: renderTemplate, formatDateTime, resolveTimeZone, todayIn, prettifyEmailName
  templates.config.ts      env → { templatesFolder, dailyNotesFolder, personalEnabled }
  templates.service.ts     listing, template resolution + read checks, create-from-template, daily note, sample
  templates.controller.ts  GET /api/templates, POST /api/templates/sample, POST /api/daily-notes
  templates.module.ts
```

`TemplatesService` sits on top of `FilesService` (it never writes to storage directly; it only uses the storage adapter for `exists` / `list`). `FilesModule` does not import `TemplatesModule`: `VaultController` resolves `TemplatesService` lazily through `ModuleRef` (same pattern as `FilesController.getOTService`), so there is no module cycle and `files.module.ts` is untouched.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `TEMPLATES_FOLDER` | `Templates` | Folder name, at the vault root and inside each personal folder |
| `DAILY_NOTES_FOLDER` | `Journal` | Folder for daily notes (personal folder when enabled, else vault root) |

Values are trimmed of leading/trailing slashes and must be canonical relative paths that do not start with `_users`; an invalid value falls back to the default with a warning. "Personal folders enabled" means `PERSONAL_PATH` is set, matching `AttachmentsService` and `ArchiveService`.

## Template listing and visibility

`GET /api/templates` → `{ folder, templates: [{ name, path, scope }] }`.

- Shared: `storage.list(<folder>)` at the vault root.
- Personal: `storage.list(personalRootFor(callerEmail) + '/' + <folder>)` — built from the caller's own canonical email, so another user's personal templates can never be enumerated (no `_users/` scan, no grants).
- Every `.md` file in the folder, recursively. `name` is the path relative to the folder without `.md` (`Meeting notes`, `Work/Standup`).
- Each candidate is still filtered through `isVisibleTo(path, email)` and `!isE2EPath(path)` as defence in depth.
- Sorted shared first, then personal; by name within a scope.

A note shared with the caller by grant is not listed, even if it sits in the owner's Templates folder: listing is a convenience surface, and grants are per-document, not "share my templates".

## Resolving and reading a template

The `template` argument (REST and MCP) is resolved in this order:

1. A listed template whose `path` or `name` matches case-insensitively (with or without `.md`); personal wins over shared on a name tie.
2. Otherwise it is taken as a literal vault path (`.md` appended when missing).

Reading then applies, in order: `isE2EPath` → 400; must end in `.md` → 400; `FilesService.assertReadable` (grant-aware, 404 for invisible paths); `PinService.assertUnlockedForRequest` (423 when locked); `FilesService.readFile`. Visibility runs before the PIN check so a lock never reveals the existence of an invisible note. Consequence of (2): any note the caller can read may serve as a template by path — no information is exposed that a plain read would not.

## Rendering

`renderTemplate(source, ctx)` is a pure function:

```ts
interface TemplateContext {
  title: string;        // new note's leaf name, no extension
  author: string;       // display name, else prettified email local part
  authorEmail: string;
  now: Date;
  timeZone: string;     // already validated
  date?: string;        // 'YYYY-MM-DD' override of the calendar day (daily notes)
}
```

- One regex pass over `{{ name }}` / `{{ name:FORMAT }}`; names are case-insensitive and may be padded with spaces. Substituted values are never re-scanned, so a title containing `{{date}}` stays literal.
- Known: `title`, `date`, `time`, `author`, `author_email`. Only `date` and `time` take a format; `{{title:x}}`, unknown names and malformed braces are left untouched.
- `{{date}}` = `YYYY-MM-DD`, `{{time}}` = `HH:mm`. With a format, `date` and `time` behave the same (both format the same instant), as in Obsidian.
- Format tokens (longest match first): `YYYY YY MMMM MMM MM M DD Do D dddd ddd HH H hh h mm ss A a`. `[text]` is literal. Any other character is literal. English names.
- Wall-clock parts come from `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', ... }).formatToParts(now)`. The weekday is derived from the calendar date, so the `date` override gets the right weekday.
- Daily notes pass `date` = the requested day: date tokens show that day while time tokens show the current time, matching Obsidian's Daily notes plugin.

`resolveTimeZone(tz)` returns `tz` when `new Intl.DateTimeFormat('en-US', { timeZone: tz })` accepts it, else the server timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `UTC` as last resort).

`{{author}}` mirrors the frontend `SearchModal.editorName`: `User.displayName` when set, else the email local part split on `.`, `_`, `-` with each part capitalized (`jane.doe@x` → `Jane Doe`). Users without a `users` row (e.g. JWT-only test users) get the fallback.

## Create from template

`POST /api/vault/items` gains `template?: string` and `timezone?: string` (notes only; `kind: 'folder'` with a template is 400).

`FilesService.createItem` gains an optional content factory `(leaf: string) => string`, invoked with the collision-resolved leaf name (`Untitled note 2`). This keeps the existing naming/collision loop as the single source of truth and makes `{{title}}` match the file name. The template is read and checked before `createItem` runs; rendering happens inside the factory. Creating into a `_secure/` parent with a template is 400 (the server would otherwise write plaintext into an E2E folder); the UI disables the entry there.

`{{title}}` is only meaningful if the note is named up front, so the popover's template view offers an optional "Note name" field. With a name, the note opens directly; without one, it falls back to `Untitled note` and opens in rename mode like any new note.

## Sample template

`POST /api/templates/sample` creates `<TEMPLATES_FOLDER>/Meeting notes.md` in the shared vault if absent and returns `{ path, id, created }`; an existing file is never overwritten. The content lives in the backend so it is defined once and unit-tested:

```markdown
# {{title}}

**Date:** {{date:dddd, MMMM D, YYYY}} at {{time}}
**Organizer:** {{author}}

## Attendees

-

## Agenda

1.

## Notes

## Action items

- [ ]
```

## Daily notes

`POST /api/daily-notes { date, timezone }` → `{ path, id, created }`.

- `date` must be `YYYY-MM-DD` and a real calendar date (400 otherwise). The client sends its local today, so the server does not need to guess the user's day.
- Path: `_users/{email}/<DAILY_NOTES_FOLDER>/<date>.md` when personal folders are enabled (journals are private by default), else `<DAILY_NOTES_FOLDER>/<date>.md` shared by everyone.
- `FilesService.assertWritable(path)` runs first.
- Content: `<TEMPLATES_FOLDER>/Daily.md` in the personal folder, else in the shared vault, else the built-in `# {{date:dddd, MMMM D, YYYY}}\n\n`. Read checks as above. `{{title}}` is the date.
- Idempotency: the existence check, render and write run inside a per-path in-process async lock (`Map<path, Promise>` chain). A second request — sequential or concurrent — finds the file and returns it unchanged with `created: false`. Kalepin runs as a single Node process, so an in-process lock is sufficient; an external writer (Obsidian) creating the same file in the same instant is not covered, as for any other create.

## MCP

- `create_note`: new optional `template` (path or name) and `timezone`. `content` becomes optional; when both are given the rendered template comes first and `content` is appended after a blank line. `{{title}}` is the leaf of `path`. Template read checks are the same as REST; a PIN-locked template fails with `pin-protected: <path>` unless the `X-Kalepin-Unlock` header validates.
- `daily_note` (registered with the other note-write tools, i.e. `rw`/`admin`/JWT): optional `date` (default: today in `timezone`) and `timezone`. Returns JSON `{ path, id, created, content }`. If the existing note is PIN-locked, `content` is omitted and `kind: 'pin-protected'` is returned instead.
- `daily_note` is registered only when `TemplatesService` is injected (it is `@Optional()` at the end of the constructor so existing hand-built test instances keep working).

## UI

- `CreatePopover` (note mode) gets an actions strip above the footer: **Today's note** (with the shortcut hint) and **From template…**. The latter switches the popover to a template view: back button, the target-folder chip, an optional name field, then templates grouped **Shared** / **Personal**, with arrow-key navigation and Enter to create. Empty state: "Add notes to a Templates folder to use them here." plus **Create a sample template**, which calls the sample endpoint and reloads the list.
- **From template…** is disabled when the selected folder is in the Encrypted Folder.
- Shortcut: **⌘⇧D** (macOS) / **Ctrl+Shift+D**. In-app it clashes with nothing (⌘K search, ⌘⇧C copy link, ⌘N / ⌘⇧N create, double-Shift search; TipTap StarterKit binds no `Mod-Shift-d`). Browsers bind it to "Bookmark all tabs" (Chrome, Firefox) and "Add to Reading List" (Safari); the handler calls `preventDefault`, which Chromium and Firefox honour for this combination. It fires from the editor too, but not while an `<input>` / `<textarea>` has focus.
- A created daily note opens like any note (no rename mode). The file tree reloads after each create.

## Alternatives considered

- **Client-side rendering.** Would enable `_secure/` templates, but duplicates logic across MCP and REST and makes the timezone behaviour untestable server-side. Rejected per the brief.
- **Lock-free `wx` exclusive create.** The storage adapter interface has no exclusive-create primitive and the encrypting adapter writes via tmp + rename. Adding one to every adapter is out of scope; the in-process lock gives the same guarantee for a single server.
- **Separate `POST /api/templates/create` endpoint.** Rejected: the brief asks to extend `POST /api/vault/items` so naming/collision behaviour stays in one place.
