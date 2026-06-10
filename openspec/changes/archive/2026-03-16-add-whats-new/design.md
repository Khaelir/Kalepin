## Context

Kalepin stores notes as Markdown files on disk, with an OT-based real-time collaboration layer and a SQLite database for search indexes, users, and sessions. Notes are written through two paths: the OT flush (collaborative editing) and direct API/MCP calls (create, edit, delete). There is currently no mechanism to track what changed over time — only the current file state is available.

The MCP server exposes tools for LLMs to interact with the vault. Adding a `get_updates` tool enables a "what's new?" workflow where the LLM summarizes recent changes for the user.

## Goals / Non-Goals

**Goals:**
- Track diffs of note changes in a storage-adapter-agnostic way
- Capture diffs with zero extra I/O on the OT collaboration path
- Provide an MCP tool that returns categorized diffs since the user last checked
- Keep storage bounded and automatically pruned

**Non-Goals:**
- Git-based diffing — must work with any storage adapter
- Per-API-key activity tracking — one `lastActiveAt` per user account is sufficient
- Real-time change notifications or webhooks
- Tracking read access (only writes)

## Decisions

### 1. Diff storage: unified diffs in a `note_changes` table

Store one row per save event with a unified diff string. This gives the LLM enough context to summarize what changed in each file.

**Alternatives considered:**
- **Snapshot per file** (store full content at last check): bounded storage but per-user×per-file rows, and diffs must be computed at query time for every changed file
- **Change log without diffs** (just path + action + timestamp): lightweight but LLM can't know *what* changed inside a file
- **Git-based**: powerful but couples to GitAdapter, violating adapter-agnostic requirement

**Rationale:** Unified diffs are compact (typically 1-5% of file size for a normal edit), pre-computed at write time, and directly consumable by an LLM.

### 2. Diff capture: hook at two distinct points

**OT flush path (hot path):**
- Add `lastFlushedContent: string` to `DocumentSession`
- On `flushToDisk()`, compute `diff(lastFlushedContent, content)` — purely in-memory
- Async insert into `note_changes` — does not block the flush
- Update `lastFlushedContent` after flush
- On session creation (`getOrCreateSession`), initialize `lastFlushedContent` from `initialContent`

**Non-OT write path (cold path):**
- Before `adapter.write()`, read current content via `adapter.read()`
- Compute diff, insert into `note_changes`
- One extra read per write — acceptable since these are infrequent single-user operations
- For creates: store full content as the diff (no "before")
- For deletes: store row with `action='deleted'`, no diff body needed

**Alternative considered:**
- Wrapping the storage adapter with a proxy: cleaner separation but adds complexity for all adapter methods. Hooking at the service level is simpler and more explicit.

### 3. Diff library: `diff` npm package

Use the `diff` npm package (`createTwoFilesPatch` or `structuredPatch`) for unified diff generation. It's well-maintained, has no native bindings (no Alpine issues), and produces standard unified diff format.

**Alternative:** `fast-diff` — faster but produces character-level diffs, not unified format. Less readable for LLMs.

### 4. `get_updates` response: group by top-level folder

Changes are grouped by the first path segment (folder), which maps to the user's organizational structure (topics/subjects). Files at the root are grouped under `"/"`.

Multiple diffs for the same file between checks are returned as an array — not collapsed — so the LLM can see the progression of changes.

### 5. Pruning: delete changes older than oldest `last_active_at`

Once every user has "seen" changes (their `last_active_at` is past the change timestamp), those rows are safe to delete. Run pruning on application startup and optionally on a daily interval.

For users with `last_active_at = NULL` (never checked), treat as epoch — don't prune until they've checked at least once. Cap maximum retention at 90 days regardless.

## Risks / Trade-offs

- **[Storage growth with no active users]** If no user calls `get_updates`, the table grows unbounded → Mitigated by 90-day hard cap on retention regardless of user activity
- **[OT session memory]** `lastFlushedContent` doubles the memory per active document session → Acceptable: sessions are short-lived (5min inactivity timeout) and typically few are active simultaneously
- **[Diff accuracy on external edits]** Files modified outside Kalepin (e.g., Obsidian) trigger the file watcher but bypass both OT and API write paths → These changes won't have diffs tracked. Could be addressed later by hooking into the watcher's `change` event with a read+diff, but out of scope for now
- **[Large file diffs]** A full rewrite of a 50KB file produces a ~50KB diff → Acceptable: this is the worst case and still small for SQLite. Could add a size cap per diff if needed later
