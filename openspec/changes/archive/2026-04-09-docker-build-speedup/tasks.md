## 1. Pre-built Model Image

- [x] 1.1 Create `Dockerfile.models` that downloads the ONNX model (extract current model stage)
- [x] 1.2 Create `.github/workflows/build-model-image.yml` triggered on `download-model.mjs` changes and `workflow_dispatch`
- [x] 1.3 Update main `Dockerfile` model stage to `FROM ghcr.io/Khaelir/kalepin-models:e5-base AS model`

## 2. Fix CI Docker Cache

- [x] 2.1 Update `build-prod.yml` to use `type=registry` cache with `ghcr.io/Khaelir/kalepin:cache` tag instead of `type=gha`

## 3. pnpm Migration — Package Configuration

- [x] 3.1 Add `packageManager` field to root `package.json` to pin pnpm version via corepack
- [x] 3.2 Create `pnpm-workspace.yaml` with workspace package list
- [x] 3.3 Run `pnpm import` to generate `pnpm-lock.yaml` from `package-lock.json`
- [x] 3.4 Remove `patch-package` from devDependencies, remove `postinstall` script
- [x] 3.5 Add `pnpm.patchedDependencies` to root `package.json` pointing to existing tiptap patch
- [x] 3.6 Add `pnpm.onlyBuiltDependencies` for native packages (`@nestjs/core`, `better-sqlite3`, `esbuild`, `onnxruntime-node`, `protobufjs`, `sharp`)
- [x] 3.7 Pin `@tiptap/react` to exact `3.20.1` in `packages/frontend/package.json`

## 4. pnpm Migration — Phantom Dependencies

- [x] 4.1 Add `cron` to `packages/backend/package.json` dependencies
- [x] 4.2 Add `@tiptap/extension-document`, `@tiptap/extension-heading`, `@tiptap/extension-paragraph`, `@tiptap/extension-text`, `prosemirror-tables` to `packages/frontend/package.json` dependencies

## 5. pnpm Migration — Dockerfile

- [x] 5.1 Update `Dockerfile` deps stage: install pnpm via corepack, use `pnpm fetch` + `pnpm install --offline`
- [x] 5.2 Update `Dockerfile` build stages: replace `npm run build --workspace=` with `pnpm --filter` commands
- [x] 5.3 Update `Dockerfile` deps-prod stage: replace `npm prune --omit=dev` with pnpm production install

## 6. pnpm Migration — CI Workflow

- [x] 6.1 Update `build-prod.yml` to enable corepack and use pnpm for the build

## 7. Cleanup

- [x] 7.1 Delete `package-lock.json`
- [x] 7.2 Remove `workspaces` field from root `package.json` (pnpm uses `pnpm-workspace.yaml` instead)

## 8. Validation

- [x] 8.1 Run `pnpm install` from clean state and verify no errors
- [x] 8.2 Run backend build (`pnpm --filter @kalepin/backend run build`) and verify success
- [x] 8.3 Run frontend build (`pnpm --filter @kalepin/frontend run build`) and verify success
- [x] 8.4 Run unit tests and verify all pass (N/A — no unit test scripts configured)
- [x] 8.5 Run Playwright e2e tests and verify all pass
- [x] 8.6 Build Docker image locally and verify it starts correctly
