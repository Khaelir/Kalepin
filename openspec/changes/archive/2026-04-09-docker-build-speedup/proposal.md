## Why

Docker builds are slow both locally (~136s) and on CI (~6min), with zero GHA cache hits across runs. The three main bottlenecks are: ONNX model download (128s locally), `npm ci` (77s locally / 34s CI), and broken cross-tag cache sharing. Fixing these cuts local cold builds from ~136s to ~20s and should significantly reduce CI build times.

## What Changes

- **Pre-built model image**: Extract the 265 MB ONNX model download into a dedicated Docker image (`ghcr.io/Khaelir/kalepin-models:e5-base`), built by CI only when `download-model.mjs` changes. Main Dockerfile references it as a build stage instead of downloading from HuggingFace every time.
- **Fix Docker cache strategy**: Replace `cache-from/to: type=gha` with `type=registry` in `build-prod.yml` so cache is shared across tag pushes (currently ref-scoped, causing zero cache hits).
- **npm to pnpm migration**: Switch package manager for ~4-5x faster installs. Includes adding 6 phantom dependencies surfaced by pnpm's strict resolution, migrating from `patch-package` to pnpm native patching, and updating Dockerfile/CI scripts.

## Capabilities

### New Capabilities
- `prebuilt-model-image`: CI workflow and Dockerfile for building/consuming a cached ONNX model Docker image
- `pnpm-migration`: pnpm workspace configuration, lockfile, native patching, and phantom dependency fixes

### Modified Capabilities

_(none — these are infrastructure/tooling changes with no spec-level behavior changes)_

## Impact

- **Dockerfile**: Model stage replaced with pre-built image reference; install commands changed from npm to pnpm
- **CI workflows**: New `build-model-image.yml` workflow; `build-prod.yml` updated for registry cache and pnpm
- **package.json** (root): Remove `patch-package`, add `pnpm.onlyBuiltDependencies` and `pnpm.patchedDependencies`
- **packages/backend/package.json**: Add `cron` dependency (was phantom)
- **packages/frontend/package.json**: Add 5 tiptap/prosemirror dependencies (were phantom), pin `@tiptap/react` to `3.20.1`
- **Lockfile**: Delete `package-lock.json`, add `pnpm-lock.yaml` and `pnpm-workspace.yaml`
- **patches/**: Kept as-is, referenced by pnpm native patching config
