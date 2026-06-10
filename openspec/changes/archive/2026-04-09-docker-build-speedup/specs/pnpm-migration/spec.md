## ADDED Requirements

### Requirement: pnpm as package manager
The project SHALL use pnpm as its package manager with a `pnpm-lock.yaml` lockfile and `pnpm-workspace.yaml` workspace configuration.

#### Scenario: Clean install succeeds
- **WHEN** a developer runs `pnpm install` in a clean checkout
- **THEN** all workspace packages SHALL install successfully with no errors

#### Scenario: pnpm version is pinned
- **WHEN** any developer or CI runs pnpm
- **THEN** the `packageManager` field in root `package.json` SHALL enforce the exact pnpm version via corepack

### Requirement: All phantom dependencies are declared
All packages that are directly imported in source code SHALL be declared as explicit dependencies in the importing package's `package.json`.

#### Scenario: Backend declares cron dependency
- **WHEN** `packages/backend/src/backup/backup.service.ts` imports `cron`
- **THEN** `cron` SHALL be listed in `packages/backend/package.json` dependencies

#### Scenario: Frontend declares tiptap extension dependencies
- **WHEN** frontend source imports `@tiptap/extension-document`, `@tiptap/extension-heading`, `@tiptap/extension-paragraph`, `@tiptap/extension-text`, or `prosemirror-tables`
- **THEN** each SHALL be listed in `packages/frontend/package.json` dependencies

### Requirement: pnpm native patching replaces patch-package
The project SHALL use `pnpm.patchedDependencies` in root `package.json` to apply patches, replacing the `patch-package` devDependency and postinstall script.

#### Scenario: tiptap patch is applied via pnpm
- **WHEN** `pnpm install` runs
- **THEN** the `@tiptap/react@3.20.1` patch SHALL be applied from `patches/@tiptap+react+3.20.1.patch`
- **THEN** no `postinstall` script invoking `patch-package` SHALL exist

### Requirement: @tiptap/react pinned to 3.20.1
`@tiptap/react` SHALL be pinned to exact version `3.20.1` in `packages/frontend/package.json` to ensure patch compatibility.

#### Scenario: Version is exact
- **WHEN** the lockfile is resolved
- **THEN** `@tiptap/react` SHALL resolve to exactly `3.20.1` (not a newer semver-compatible version)

### Requirement: Native build scripts are allowed
The `pnpm.onlyBuiltDependencies` field SHALL list packages that need to run install/postinstall scripts: `@nestjs/core`, `better-sqlite3`, `esbuild`, `onnxruntime-node`, `protobufjs`, `sharp`.

#### Scenario: Native bindings compile on install
- **WHEN** `pnpm install` runs
- **THEN** `better-sqlite3`, `esbuild`, `onnxruntime-node`, `sharp`, and `protobufjs` SHALL execute their build scripts without being blocked

### Requirement: Dockerfile uses pnpm for installs
The Dockerfile SHALL use `pnpm fetch` and `pnpm install --offline` for dependency installation.

#### Scenario: Docker dependency layer caching
- **WHEN** only `package.json` files change (not `pnpm-lock.yaml`)
- **THEN** the `pnpm fetch` layer SHALL be a Docker cache hit

#### Scenario: Docker build completes with pnpm
- **WHEN** the Docker image is built
- **THEN** `pnpm install --offline`, frontend build, and backend build SHALL all succeed

### Requirement: CI workflow uses pnpm
The `build-prod.yml` workflow SHALL use pnpm (via corepack) instead of npm for all build steps.

#### Scenario: CI build succeeds with pnpm
- **WHEN** a `v*` tag is pushed
- **THEN** the CI build SHALL install dependencies with pnpm and produce a working Docker image

### Requirement: Build correctness validated
All existing tests SHALL pass after the migration.

#### Scenario: Backend builds successfully
- **WHEN** `pnpm --filter @kalepin/backend run build` is executed
- **THEN** the backend SHALL compile with no errors

#### Scenario: Frontend builds successfully
- **WHEN** `pnpm --filter @kalepin/frontend run build` is executed
- **THEN** the frontend SHALL compile and bundle with no errors

#### Scenario: Unit tests pass
- **WHEN** unit tests are executed
- **THEN** all existing unit tests SHALL pass

#### Scenario: E2E tests pass
- **WHEN** Playwright e2e tests are executed
- **THEN** all existing e2e tests SHALL pass
