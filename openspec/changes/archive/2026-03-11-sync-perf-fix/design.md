## Context

The OT system flushes document content to disk via `flushToDisk()` after 3 seconds of inactivity. The local filesystem adapter writes the full file with `fs.writeFile()`. Chokidar watches the vault directory and emits `change` events for any file modification — including ones the OT system itself caused. The gateway blindly broadcasts these as `file:changed` to all clients, triggering a full document reload.

Current flow on every flush:
```
OT flush → fs.writeFile → chokidar 'change' → gateway broadcast
→ client toast + HTTP reload → setDocState → full editor re-render
```

The `getSession()` method already exists on `OTSessionManager` and returns the session for a given docId.

## Goals / Non-Goals

**Goals:**
- Eliminate the self-triggered reload loop (P1)
- Implement proper OT operation composition (P2)
- Establish a profiling baseline for future optimization decisions (P3)

**Non-Goals:**
- Rewriting the OT system to use ProseMirror Steps (too large a change)
- Optimizing the prefix/suffix diff without profiling data first
- Changing the flush-to-disk strategy (debounced write is fine)
- Modifying how actual external edits (e.g., from Obsidian) are detected

## Decisions

### D1: Session-based event suppression over write-flag or content-comparison

**Choice:** Check if an active OT session exists for the changed path. If yes, suppress the `file:changed` broadcast.

**Alternatives considered:**
- **Write-suppression flag**: Set a flag before writing, clear after. Fragile — requires timing coordination with chokidar's async event delivery. Race conditions likely.
- **Content comparison**: Read the file back and compare to session content. Correct but wasteful — reads the entire file just to discard the event.
- **Chokidar `ignored` option**: Can't dynamically add/remove paths from the ignore list.

**Rationale:** If there's an active OT session, the OT system owns that document. Any disk write for that path was caused by the flush. Simple, zero overhead, no race conditions. When the session closes, the watcher resumes normal behavior for truly external edits.

### D2: Proper OT composition using cursor-walk algorithm

**Choice:** Implement `composeOps(a, b)` as a proper OT composition that walks both operation lists simultaneously, merging adjacent components.

The composition algorithm walks operations `a` and `b` in lockstep:
- `retain(n)` + `retain(m)` → `retain(min(n,m))`, advance both
- `insert(s)` from `a` → emit `insert(s)`, advance `a`, apply `b` ops against inserted length
- `delete(n)` from `a` → emit `delete(n)`, advance `a`
- `insert(s)` from `b` over a retain → emit `insert(s)`, consume retain

This mirrors the existing `transform` logic already in `ot-client.ts` and `ot-engine.ts`.

**Rationale:** The current `[...a, ...b]` concatenation is not just suboptimal — it produces invalid OT operations (the total retain+delete count won't match the document length). It works by accident because the server re-transforms, but it means buffered operations grow linearly with typing speed.

### D3: Defer diff and setContent optimizations until profiled

**Choice:** Don't optimize `diffMarkdownToOps` or remote op application yet. Fix P1 and P2, then profile.

**Rationale:** The self-triggered reload is almost certainly the dominant cost. The prefix/suffix scan on a 100KB string is ~1ms in V8. Only invest in the more complex cursor-hint or incremental serialization approaches if profiling confirms they matter.

## Risks / Trade-offs

- **[Risk] Genuine external edit while OT session active** → The suppression means if someone edits the file in Obsidian while a Kalepin session is open, the change won't trigger a reload. This is acceptable because the OT flush will overwrite the external edit anyway (OT is source of truth while session is active). A future improvement could detect content divergence on flush. → Mitigation: document this behavior; it's the correct semantic — OT owns the file while a session is active.

- **[Risk] composeOps correctness** → OT composition is subtle. An incorrect implementation could cause document divergence. → Mitigation: the existing `ot-engine.ts` already has a working `compose` function on the server side. Port the same logic to the client.
