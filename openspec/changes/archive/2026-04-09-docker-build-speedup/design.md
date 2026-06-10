## Context

The Docker build has three bottlenecks measured on a cold build:

| Phase | Local | CI (GH Actions) |
|---|---|---|
| ONNX model download (HuggingFace) | 128.6s | 6.3s |
| `npm ci` | 76.9s | 33.9s |
| `vite build` (frontend) | 24.0s | 37.5s |
| `npm prune --omit=dev` | 6.1s | ~7s |
| Total wall-clock | ~136s | ~6min |

CI uses `cache-from: type=gha` / `cache-to: type=gha,mode=max`, but builds trigger on `tags: v*` which are ref-scoped — resulting in **zero cache hits** across runs. Every CI build reinstalls and rebuilds everything from scratch.

Current setup: npm workspaces (backend, frontend, shared, e2e), `patch-package` for one `@tiptap/react` patch, `node:22-slim` base image, multi-stage Dockerfile with parallel build stages.

## Goals / Non-Goals

**Goals:**
- Eliminate redundant ONNX model downloads across builds (local and CI)
- Fix CI Docker layer caching so builds share cache across tag pushes
- Reduce `npm ci` time by switching to pnpm (~4-5x faster installs)
- Maintain full build correctness — all existing tests (unit, e2e/Playwright) must pass

**Non-Goals:**
- Optimizing vite/tsc build speed (separate concern, not addressed here)
- Changing the multi-stage Dockerfile architecture
- Migrating to Yarn (pnpm chosen for superior Docker story and built-in patching)

## Decisions

### 1. Pre-built model image via dedicated CI workflow

**Choice:** Separate `Dockerfile.models` + `build-model-image.yml` workflow that pushes `ghcr.io/Khaelir/kalepin-models:e5-base`. Main Dockerfile uses `FROM ... AS model`.

**Why over alternatives:**
- *BuildKit cache mount* (`--mount=type=cache`): Local-only, doesn't help CI, requires `cp` hack to export from cache mount
- *Baking into base image*: Couples model version to Node version upgrades
- *Git LFS / artifact caching*: More complex, model is 265 MB which exceeds typical cache limits

The dedicated image is simple, durable (survives cache eviction), and the model almost never changes.

**CI trigger:** `push.paths: packages/backend/scripts/download-model.mjs` + `workflow_dispatch` for manual rebuilds.

### 2. Registry-based Docker cache instead of GHA cache

**Choice:** Switch `build-prod.yml` from `type=gha` to `type=registry` with a dedicated cache tag:
```
cache-from: type=registry,ref=ghcr.io/Khaelir/kalepin:cache
cache-to: type=registry,ref=ghcr.io/Khaelir/kalepin:cache,mode=max
```

**Why:** GHA cache is scoped per git ref. Tag pushes (`v*`) don't share cache with each other or with `main`. Registry cache uses a fixed tag that all builds read/write, solving this completely.

**Trade-off:** Registry cache is slightly slower to export than GHA cache (pushes layers to GHCR), but the savings from actual cache hits vastly outweigh this.

### 3. pnpm over npm (not Yarn)

**Choice:** pnpm v10 with strict `node_modules` linking.

**Why pnpm over Yarn:**
- `pnpm fetch` + `pnpm install --offline` gives optimal Docker layer caching (download layer only busts on lockfile change)
- Built-in `patchedDependencies` replaces `patch-package` (one fewer devDependency)
- Content-addressable store means near-instant warm installs locally
- Strict resolution catches phantom dependencies at install time (found 6 — correctness win)

**Why not `--shamefully-hoist`:** Defeats pnpm's strictness benefit. The 6 phantom deps are straightforward to add.

### 4. Pin @tiptap/react to 3.20.1

**Choice:** Pin exact version in `packages/frontend/package.json` rather than re-creating the patch for 3.22.3.

**Why:** The patch fixes Safari crashes in `PureEditorContent.init()` and `componentWillUnmount()`. Upstream 3.22.3 still has the same vulnerable code (verified by reading the published dist). Pinning is safer than maintaining patches across versions. When upstream fixes the issue, we unpin and remove the patch.

### 5. pnpm native patching

**Choice:** Use `pnpm.patchedDependencies` in root `package.json` pointing to existing `patches/@tiptap+react+3.20.1.patch`.

**Why over keeping patch-package:** pnpm applies patches during install natively — no postinstall script, no extra dependency, cleaner integration.

## Risks / Trade-offs

**[Phantom deps in future packages]** → pnpm's strict resolution may surface new phantom deps when adding packages. Mitigation: this is a feature, not a bug — it catches real dependency issues early. Developers will see clear error messages at install time.

**[Model image staleness]** → If someone changes the model URL inside `download-model.mjs` but the path trigger doesn't fire (e.g., manual edit on a non-main branch). Mitigation: `workflow_dispatch` allows manual rebuild; the Dockerfile `FROM` will fail visibly if the image doesn't exist.

**[Registry cache size]** → `mode=max` caches all intermediate layers, which can grow large. Mitigation: GHCR has generous storage for packages; single cache tag means old layers are overwritten.

**[pnpm version drift in CI vs local]** → Different pnpm versions could produce different lockfiles. Mitigation: Use `corepack enable` with `packageManager` field in `package.json` to pin the exact pnpm version.

## Migration Plan

1. Build and push the model image first (can be done independently)
2. Migrate to pnpm locally (lockfile, workspace config, phantom deps, patching)
3. Verify builds: `pnpm install` → backend build → frontend build
4. Run full test suite: unit tests + Playwright e2e
5. Update Dockerfile for pnpm + model image reference
6. Update `build-prod.yml` for registry cache + pnpm
7. Commit all changes, push tag to trigger CI build, verify CI passes

Rollback: Revert to npm by restoring `package-lock.json` from git and reverting Dockerfile/CI changes. The model image can stay published regardless.
