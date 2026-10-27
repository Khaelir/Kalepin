# Kalepin

A collaborative, markdown-first note-taking app with real-time editing, semantic search, and AI integration via MCP.

Notes are stored as plain `.md` files on disk — compatible with Obsidian and any text editor.

## Features

- **Markdown on disk** — Notes are plain `.md` files. Edit them in Kalepin, Obsidian, VS Code, or anything else.
- **Real-time collaboration** — Multiple users can edit the same note simultaneously with operational transform (OT). Cursor presence shows who's working where.
- **Hybrid search** — Full-text (FTS5/BM25) and semantic vector search using local embeddings (`multilingual-e5-base`).
- **Slash commands** — Type `/` in the editor to insert headings, tables, task lists, images, links, and more.
- **Comments** — Thread-based comments attached to content blocks, stored in sidecar files to keep your markdown clean.
- **Tags** — Obsidian-style tags from frontmatter `tags:` and inline `#tag`, nested (`#project/kalepin` counts toward `project`) and case-insensitive. Browse them in the sidebar's Tags section, click any tag to search for it, or type `tag:name` in search (⌘K); several `tag:` tokens must all match, and a query of only `tag:` tokens lists those notes, newest first.
- **Related notes** — The Backlinks panel lists the notes most semantically similar to the open one (same local embeddings as search), with the matching section and a "not linked" marker; one click appends a `[[link]]`.
- **Templates & daily notes** — Obsidian-compatible templates (`{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{author}}`) from a `Templates/` folder, shared or personal. ⌘⇧D / Ctrl+Shift+D opens today's journal note, created from `Daily.md` when it exists.
- **Notifications** — The bell in the top bar lists mentions (in comments and note bodies), replies in threads you're part of, and notes shared with you, with a live unread badge. Each user picks which notifications are also emailed under **Settings → Email notifications**; every email has a one-click unsubscribe link.
- **Trash** — Deleting a note or folder moves it to a `.trash/` folder (Obsidian's convention; one per zone, so personal items stay private). Restore it from the sidebar's Trash or with Undo right after deleting: it comes back at the same path with its comments, share links, grants, stars, PIN and `/doc/` link. Items are purged after `TRASH_RETENTION_DAYS`. Notes in the Encrypted Folder are still deleted permanently.
- **MCP server** — Give Claude (or any MCP client) full access to your notes: search, read, create, edit, comment.
- **Magic link auth** — Passwordless email authentication with domain allowlists.
- **Microsoft sign-in (optional)** — "Sign in with Microsoft" for one Entra ID tenant, next to the magic link. See [docs/microsoft-sso.md](docs/microsoft-sso.md).
- **At-rest encryption** — Per-zone envelope encryption (AES-256-GCM + AES-KW). Personal folders encrypted by default; shared vault is opt-in to keep Obsidian-on-disk working. See [Encryption](#encryption).
- **Self-hosted** — Docker-ready with SQLite. No external database needed.

## Quick start

### Docker (recommended)

The supplied `docker-compose.yml` mounts a 32-byte KEK as a docker secret to enable at-rest envelope encryption. Generate it once before the first boot:

```bash
mkdir -p secrets
openssl rand -out ./secrets/kalepin.kek 32
chmod 0600 ./secrets/kalepin.kek
docker compose up
```

> **Back up `secrets/kalepin.kek` separately from `/data`.** Losing the KEK loses every encrypted byte. The `secrets/` directory is gitignored. See [Encryption](#encryption) for the full operator runbook (rotation, restore, fingerprint check).

Kalepin is available at `http://localhost:3000`. Notes are persisted in Docker volumes (`vault` for files, `personal` for per-user folders, `db` for the database). At-rest encryption is **enabled but inert by default**: the personal zone is encrypted on first write; the shared zone stays plaintext until an admin flips it from **Settings → Admin → Encryption** (so Obsidian-on-disk keeps working unless you opt in).

To configure, set environment variables in `docker-compose.yml` or a `.env` file. See `.env.example` for all options.

### Local development

```bash
npm install

# Build the shared package
npm run build --workspace=packages/shared

# Start the backend (NestJS, port 3000)
npm run start:dev --workspace=packages/backend

# In another terminal, start the frontend (Vite, port 5173)
npm run dev --workspace=packages/frontend
```

### Downloading the embedding model

Semantic search requires the `multilingual-e5-base` model. It's downloaded automatically on first startup, or you can pre-download it:

```bash
node packages/backend/scripts/download-model.mjs
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
|---|---|---|
| `STORAGE_ADAPTER` | `localfs` | Storage backend (`localfs` or `git`) |
| `VAULT_PATH` | `/data/vault` | Directory where shared (multi-user) markdown files are stored |
| `PERSONAL_PATH` | — | Optional. Directory where per-user "Personal" folders live, addressable virtually as `_users/{email}/...`. When unset, personal folders are disabled and storage runs single-root against `VAULT_PATH`. See [Personal folders](#personal-folders) below. |
| `DB_PATH` | `/data/db/kalepin.sqlite` | SQLite database path |
| `JWT_SECRET` | — | Secret for signing auth tokens (change in production) |
| `JWT_EXPIRY` | `7d` | Session duration |
| `APP_URL` | `http://localhost:3000` | Public URL (used in magic link emails and OAuth discovery metadata). Behind a TLS-terminating reverse proxy (e.g. Traefik) this MUST be the public `https://…` URL the proxy fronts — otherwise OAuth connectors (claude.ai) will fail. The backend logs a WARN at boot if this disagrees with `X-Forwarded-Proto`/`X-Forwarded-Host`. |
| `OAUTH_CORS_ALLOW_LIST` | — | Optional comma-separated extra origins allowed to call `/mcp`, `/oauth/*`, and `/.well-known/oauth-*`. `https://claude.ai` is always allowed. |
| `OAUTH_PREREGISTERED_CLIENT_IDS` | — | Optional comma-separated `client_id`s to insert into `oauth_clients` at boot. Use only when claude.ai already has a connector registered with a hand-picked `client_id` (e.g. installed before this Kalepin instance had OAuth, or set up by an Owner who can't delete/re-add). Pre-registered rows are public clients (PKCE only) locked to claude.ai's MCP callback. |
| `PORT` | `3000` | Server port |
| `DOMAIN_ALLOWLIST` | `*` | Comma-separated email domains allowed to sign in (by any method), or `*` for any. Matched case-insensitively. |
| `SMTP_HOST` | `in-v3.mailjet.com` | SMTP server for magic link emails |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials |
| `SMTP_FROM` | `noreply@kalepin.app` | Sender email address |
| `SSO_MICROSOFT_TENANT_ID` | — | Optional. Your Entra Directory (tenant) ID, a GUID. With the client ID and secret, enables **Sign in with Microsoft**. See [docs/microsoft-sso.md](docs/microsoft-sso.md). |
| `SSO_MICROSOFT_CLIENT_ID` | — | Entra Application (client) ID, a GUID. |
| `SSO_MICROSOFT_CLIENT_SECRET_FILE` | — | Path to a file holding the Entra client secret (recommended). |
| `SSO_MICROSOFT_CLIENT_SECRET` | — | Alternative to `_FILE`: the secret value itself. The file wins if both are set. |
| `SSO_MICROSOFT_AUTHORITY_HOST` | `https://login.microsoftonline.com` | Change only for a national cloud (e.g. `https://login.microsoftonline.us`). |
| `KALEPIN_KEK_FILE` | — | Path to a 32-byte raw KEK file (mode `0400`/`0600`). Enables at-rest envelope encryption when set. See [Encryption](#encryption). |
| `KALEPIN_KEK_AUTO_GENERATE` | — | Dev-only convenience: when set to `1` and `KALEPIN_KEK_FILE` does not exist, generate a fresh KEK at boot. **Never enable in production.** |
| `KALEPIN_KEK` | — | Dev/test fallback: hex-encoded 32-byte KEK. Refused when `NODE_ENV=production` unless `KALEPIN_KEK_FILE` is also set. |
| `ACCESS_LOG_RETENTION_DAYS` | `90` | Days to retain `note_access_log` rows; a daily cron prunes older rows. `0` disables retention (see [Privacy & access logs](#privacy--access-logs)). |
| `ACCESS_LOG_IP_SALT` | auto | Per-deployment salt used to HMAC client IPs in the access log. Auto-generated to `<DB_PATH dir>/.access-log-salt` if unset. |
| `TRASH_RETENTION_DAYS` | `30` | Days a deleted note or folder stays in the trash before a daily job purges it. `0` keeps trashed items until someone deletes them forever. |
| `TEMPLATES_FOLDER` | `Templates` | Templates folder, at the vault root (shared) and in each personal folder (owner only). |
| `DAILY_NOTES_FOLDER` | `Journal` | Daily notes folder: inside the personal folder when `PERSONAL_PATH` is set, else at the vault root. |
| `RELATED_NOTES_MIN_SCORE` | `0.88` | Minimum embedding similarity for a note to appear under Related. e5 scores sit in a narrow band; raise it if loosely related notes show up. |
| `NOTIFICATION_RETENTION_DAYS` | `90` | Days to keep **read** in-app notifications; a daily job deletes older read items. Unread items are never pruned. `0` disables pruning. |

## Personal folders

When `PERSONAL_PATH` is set, each authenticated user gets a private namespace at the virtual path `_users/{email}/...`, physically rooted at `PERSONAL_PATH/{email}/...`. Personal notes are owner-only by construction across every API surface (HTTP, WebSocket, MCP, search, attachments, share links, change feed, mention notifications). Foreign personal paths return `404 Not Found` — existence is not observable.

**On-disk layout:**

```
DATA_PATH/
├── vault/      ← VAULT_PATH (shared, visible to every authenticated user)
│   ├── _attachments/
│   └── Notes/...
└── personal/   ← PERSONAL_PATH
    ├── alice@example.com/
    │   ├── _attachments/
    │   └── Diary.md
    ├── bob@example.com/
    │   └── Scratch.md
    └── .deleted/
        └── carol@example.com-2026-04-30T14-30-00Z/   ← soft-deleted user content
```

**Operator notes:**

- The path `_users/` is reserved inside `VAULT_PATH`. The backend refuses to start if `VAULT_PATH/_users/` exists on disk. Move or delete that directory before booting.
- Personal folders are auto-created on first authenticated request post-login. No upfront migration needed.
- Backups (`/api/admin/backup/download` and S3 backup) tar both roots when `PERSONAL_PATH` is set; restore is symmetric.
- Admins still have unfiltered DB and disk visibility — the boundary is the API layer, not encryption-at-rest. Anyone with shell or DB access sees `personal/` plainly.
- When a user is removed (no UI today; via direct DB or future admin endpoint), call `RoutingStorageAdapter.softDeletePersonalFolder(email)` to move their folder to `personal/.deleted/{email}-{timestamp}/`. Restore is a manual `mv` for v1.
- For users: notes inside the Personal folder do not send mention notifications to anyone other than the folder owner. Share links from a personal note make its content readable by anyone with the URL — the UI surfaces a confirmation dialog at mint time.

## Encryption

Kalepin supports at-rest envelope encryption with a per-zone admin toggle. Each note gets a fresh AES-256 Content Encryption Key (CEK) wrapped by a server-held Key Encryption Key (KEK). The encryption boundary lives at the storage adapter, so every API surface (HTTP, WebSocket, MCP, search, comments, share-links, change tracking, per-user `download-zip`) sees plaintext markdown. Only the bytes on disk and in backups are envelopes.

Two zones are independently switchable:

- `personal` — `_users/{email}/...` (per-user private namespace). **Encrypted by default.**
- `shared` — everything else (the multi-user vault). **Plaintext by default**, so Obsidian-on-disk works.

Toggle each zone from **Settings → Admin → Encryption**. The flip starts a backgrounded sweep that rewrites files in place via atomic write-tmp + fsync + rename. Reads stay transparent during the sweep — auto-detection of the `KE1\0` envelope magic per file makes mid-state safe.

### Generating the KEK

```sh
# 32 bytes of cryptographic randomness, mode 0400, owned by the runtime user.
openssl rand -out kalepin.kek 32
chmod 0400 kalepin.kek
```

Mount it as a docker secret (the supplied `docker-compose.yml` does this):

```yaml
secrets:
  kalepin_kek:
    file: ./secrets/kalepin.kek

services:
  kalepin:
    secrets:
      - kalepin_kek
    environment:
      - KALEPIN_KEK_FILE=/run/secrets/kalepin_kek
```

The backend refuses to start if the file is not exactly 32 bytes or its mode is more permissive than `0600`.

For local development, set `KALEPIN_KEK_FILE=./secrets/kalepin.kek` and `KALEPIN_KEK_AUTO_GENERATE=1` to have a KEK generated automatically on first boot. Do not use auto-generate in production — losing the file loses every encrypted byte.

### Backup runbook

The KEK is **not** included in `/api/admin/backup/download` or the S3 backup. Back it up **separately**, in a different location from your data: typically a password manager, a secrets vault (HashiCorp Vault, 1Password, Bitwarden), a Yubikey-encrypted file in a different bucket, or printed paper in a safe.

Every envelope on disk includes the first 8 bytes of `HMAC-SHA256(KEK, "kalepin-kek-fp")` as a fingerprint. On restore, if the configured KEK does not match the fingerprint embedded in the data, the backend logs a `WrongKEKError` with both fingerprints surfaced — much clearer than a generic GCM-tag failure.

A standard restore loop:

1. Restore `/data` from your backup.
2. Restore the KEK file from its separate vault.
3. Boot. The fingerprint check fails fast if the KEK and data don't match.

### KEK rotation

Rotate the KEK on a schedule (e.g., yearly) or after suspected compromise:

```sh
# Inside the running container.
node dist/cli/rotate-kek.js --new-kek-file=/run/secrets/kalepin.kek.new
```

The rotation walks every encrypted file, unwraps the CEK with the old KEK source, re-wraps it with the new one, and rewrites the envelope. Bulk ciphertext bytes never change — only the small wrapped-CEK header. Expected duration on a 10K-file vault: under a minute on a typical SSD. After completion, swap the symlink and destroy the old KEK.

The rotation reuses the migration sweep state machine, so it is crash-safe and resumable.

### End-to-end encryption (`_users/{email}/_secure/`)

Files under `_users/{email}/_secure/` are end-to-end encrypted with a master-KEK that lives **only** in the user's browser. The server never sees the plaintext, the master-KEK, or the passphrase.

What's protected:

- **Bytes on disk and in backups** — encrypted with a per-file CEK that is itself wrapped with the user's master-KEK (AES-KW). The server only ever sees opaque envelope bytes for `_secure/` paths.
- **Server-side reads** — every API surface (FTS, semantic search, backlinks, OT collaboration, comments, share-links, MCP read tools) is gated by `isE2EEncrypted(path)`. None of them touch plaintext for `_secure/` paths.
- **Change tracking** — `note_change` rows for `_secure/` paths are metadata-only (hash + size + author + ts). Diffs are not stored.

What's NOT protected (deliberately):

- **Path names** — the directory layout is visible to anyone with disk or DB access. Filenames in `_secure/` are not encrypted.
- **File sizes and modification times** — visible to operators.
- **Comments, share-links, OT collaboration** — disabled, not encrypted. If you need to share a `_secure/` note, move it out first.

Lost passphrase = permanently lost data:

- The setup dialog requires you to type the literal string "I understand" before creating the vault. There is no "forgot passphrase" link.
- During setup, you can opt into a **24-word BIP-39 recovery phrase**. The phrase is shown once; we cannot recover it for you.
- If you lose both the passphrase and the recovery phrase, the only path forward is a **vault reset** (Settings → Security). This is destructive — every file in `_secure/` is queued for deletion. A 24-hour grace window with an emailed undo link covers accidental clicks. After 24 hours, the data is gone.

#### Decrypting a `download-zip` archive's `_secure/` entries

`/api/files/download-zip` includes a `manifest.json` at the archive root. Each entry is tagged either `plaintext` or `e2e-encrypted`. For `e2e-encrypted` entries the bytes in the zip are raw envelopes; you decrypt them in your own client with your passphrase or recovery phrase.

The envelope format is documented in `packages/backend/src/crypto/envelope.ts`. Layout (little-endian):

```
4 bytes  magic            "KE1\0"
1 byte   version          0x01
1 byte   algorithm        0x01 (AES-256-GCM)
1 byte   kdf              0x01 (Argon2id)
2 bytes  kdf_params_len   u16
N bytes  kdf_params       16-byte salt + memKiB(u32) + iterations(u16) + parallelism(u8)
12 bytes iv               GCM nonce
2 bytes  wrapped_cek_len  u16
M bytes  wrapped_cek      AES-KW(master-KEK, CEK), typically 40 bytes
8 bytes  kek_fingerprint  HMAC-SHA256(master-KEK, "kalepin-kek-fp")[:8]
2 bytes  aad_len          u16
P bytes  aad              JSON {"v":1,"path":"<full path>","kind":"note","z":"personal"}
*        ciphertext+tag   AES-256-GCM(CEK, plaintext, IV, AAD)
```

Reference walkthrough (Node.js, replace the input with one entry from your zip):

```js
import { argon2id } from '@noble/hashes/argon2';
import { createDecipheriv } from 'node:crypto';
import { unwrapKey } from '@noble/ciphers/aes-kw';

const passphrase = '<your passphrase>';
const passphraseWrappedKek = '<base64 from /api/users/me/vault-meta>'; // server-stored
const passphraseSalt = '<base64 from /api/users/me/vault-meta>';

// 1. Derive passphrase-KEK with the params from the envelope's kdf_params.
const kdf_params = parseKdfParams(envelope);
const passphraseKek = argon2id(passphrase, kdf_params.salt, {
  m: kdf_params.memKiB, t: kdf_params.iterations, p: kdf_params.parallelism, dkLen: 32,
});
// 2. Unwrap the master-KEK from the server-stored blob.
const masterKek = unwrapKey(passphraseKek, base64decode(passphraseWrappedKek));
// 3. Unwrap the per-file CEK (parse from envelope).
const cek = unwrapKey(masterKek, envelope.wrapped_cek);
// 4. AES-256-GCM decrypt with iv + aad from the envelope.
const decipher = createDecipheriv('aes-256-gcm', cek, envelope.iv);
decipher.setAAD(envelope.aad);
decipher.setAuthTag(envelope.ciphertext.slice(-16));
const plaintext = Buffer.concat([decipher.update(envelope.ciphertext.slice(0, -16)), decipher.final()]);
```

If `kek_fingerprint` doesn't match `HMAC-SHA256(your master-KEK, "kalepin-kek-fp")[:8]`, you derived the wrong master-KEK — typically a passphrase typo or a stale recovery phrase.

## Privacy & access logs

Kalepin records per-note access events (views, edits, comments, share-link resolves) in `note_access_log`. Owners and admins can review the log via the **Activity** tab in the right rail; non-owners never see the tab. The data is GDPR-relevant — it ties an email to a path at a timestamp — so retention and erasure are first-class:

| Variable | Default | Description |
|---|---|---|
| `ACCESS_LOG_RETENTION_DAYS` | `90` | Days to keep access-log rows. A daily cron at 03:00 prunes anything older. Set to `0` to disable retention (the rows live forever) — **doing so puts the burden of GDPR compliance entirely on you**. |
| `ACCESS_LOG_IP_SALT` | auto-generated | Per-deployment HMAC salt used to hash recorded IPs. Hex or base64; must decode to ≥16 bytes. When unset, the backend generates a 32-byte random salt on first boot and persists it to `<DB_PATH dir>/.access-log-salt` (mode `0600`). |

**Right to erasure.** Any authenticated user can wipe every row attributed to their email by calling:

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$APP_URL/api/users/me/access-log"
# → { "deleted": 142 }
```

Admins can erase another user's rows (e.g. for a verified GDPR Article 17 request) with:

```bash
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$APP_URL/api/admin/users/alice%40example.com/access-log"
```

**Anonymous rows.** Public share-link resolves are logged with `viewer_email = 'anonymous'`; the IP hash is salted and truncated to 8 bytes, so it's not personally identifiable in the GDPR sense. Anonymous rows still respect retention.

**Stage-2 caveat.** For end-to-end encrypted paths (`_users/{email}/_secure/...`) the server only sees that the ciphertext was fetched — not that decryption succeeded. The action value for those reads is `'fetched'`, and the Activity panel labels them accordingly.

## MCP server

The backend includes a built-in MCP server at `/mcp` (HTTP transport). AI assistants like Claude can search, read, create, edit, and comment on your notes.

Each piece of access — a CLI API key or a Claude.ai OAuth grant — appears in **Settings → Connections** and can be revoked individually.

### Setup — Claude.ai (web / desktop / mobile)

1. Open **Settings → Connections** in Kalepin and click **Connect** on the *Claude.ai (web)* card.
2. Follow the wizard: open Claude.ai's connectors page, paste the URL it gives you (`<APP_URL>/mcp`), and Claude will redirect you back to Kalepin to confirm the permission level.
3. The connection appears in **Connections** with a "Last used" timestamp; revoke it from there at any time.

The flow uses OAuth 2.1 with PKCE and Dynamic Client Registration (RFC 7591). Adding a custom connector may require a Pro/Max/Team/Enterprise Claude plan. Discovery metadata lives at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`; user-facing docs at `/docs/mcp`.

### Setup — Claude Code (CLI) and other static-token clients

1. Go to **Settings → Connections** in Kalepin, click **+ New API key**, and create a key.
2. Add the server to your MCP client config (e.g. Claude Code `.mcp.json`):

```json
{
  "mcpServers": {
    "kalepin": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

### Tools

The tools a client sees depend on the scope of its key or grant: **Read-only** (`ro`, OAuth `notes.read`), **Read + Comments** (`rc`, `notes.comment`), **Full access** (`rw`, `notes.write`) or **Admin** (`admin`, API keys only, offered to admins). Each scope includes the ones before it. A key outside the scope never sees the tool in `tools/list`.

| Tool | Scope | Description |
|---|---|---|
| `search_notes` | ro | Full-text and semantic search across notes and comments; `tag:<name>` tokens filter by tag |
| `read_note` | ro | Read a note's markdown and comment threads; `maxLength` returns an outline for long notes |
| `read_attachment` | ro | Read a draw.io diagram attached to a note as a graph (nodes and edges) |
| `list_files` | ro | List note paths; `include_ids` adds each note's stable id |
| `list_tags` | ro | List the tags in notes you can see, with counts |
| `related_notes` | ro | Notes most semantically similar to a note, with why they match and whether they're linked |
| `list_comments` | ro | List the comment threads on a note as structured data |
| `get_updates` | ro | Summary of note changes since your last check (or `since`); `include_diffs` adds unified diffs |
| `add_comment` | rc | Comment on a note, anchored to `quotedText`, or reply to a thread |
| `resolve_comment` | rc | Resolve or unresolve a comment thread |
| `create_note` | rw | Create a new note, optionally from a template (`template`, `timezone`) |
| `daily_note` | rw | Open or create today's (or a given date's) daily note |
| `patch_note` | rw | Replace exactly one occurrence of `old_text`; fails if it is missing or ambiguous |
| `append_to_note` | rw | Append content to the end of a note without rewriting it |
| `edit_note` | rw | Replace the whole content of a note |
| `delete_note` | rw | Move a note to the trash (restorable from Trash; Encrypted Folder notes are deleted permanently) |
| `list_backups` | admin | List the S3 backups with dates and sizes |
| `create_backup` | admin | Run an S3 backup now |
| `restore_backup` | admin | Restore an S3 backup by `key` or `nearTimestamp`, after a safety-net backup; the app restarts |
| `mcp_stats` | admin | MCP usage and system health over the last 14 days |

The S3 backup tools are only registered when S3 backups are configured. `patch_note`, `append_to_note` and `edit_note` take an optional `base_hash` from `read_note` and refuse the write if the note changed since. Until a PIN-locked note is unlocked, reads return its path with `kind: "pin-protected"` instead of its content, and writes fail with `pin-protected: <path>`.

Every tool that targets an existing note accepts either `path` or `id` (`notePath` or `noteId` for `read_attachment`). The id is the note's stable identifier, the same one used in `/doc/<id>` app URLs. It survives renames and moves, and is returned by `search_notes`, `read_note`, `create_note`, `daily_note`, `related_notes`, `get_updates` and `list_files` (with `include_ids: true`).

### Resources

- `note://{path}` — Read a note as a markdown resource
- `tree://files` — The complete file tree as JSON

### Prompts

- `summarize-notes` — Summarize all notes in a directory
- `review-doc` — Review a document and provide feedback

## Project structure

```
packages/
  backend/       NestJS API server, OT engine, search, auth, MCP
  frontend/      React + TipTap editor, Vite
  shared/        TypeScript types shared across packages
```

## Tech stack

- **Backend:** NestJS, TypeORM, SQLite, WebSockets
- **Frontend:** React, TipTap 3 (ProseMirror), Vite
- **Search:** SQLite FTS5 + local ONNX embeddings (multilingual-e5-base)
- **MCP:** @modelcontextprotocol/sdk
- **Auth:** JWT + magic links via SMTP; Microsoft sign-in (optional, OpenID Connect via `openid-client`)
- **Deploy:** Docker (node:20-slim), multi-stage build

## License

MIT
