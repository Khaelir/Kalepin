## Context

The project has no e2e tests. Backend has a handful of unit tests (OT engine, search, etc.) but nothing exercises the full stack — editor rendering, WebSocket collaboration, or ProseMirror transaction behavior. Bugs like table corruption on remote edits required manual two-tab testing. The project is a monorepo (npm workspaces) with NestJS backend, React/Vite frontend, and `better-sqlite3` for storage.

## Goals / Non-Goals

**Goals:**
- Self-contained test suite that needs zero running services — spins up backend + frontend, runs tests, tears down
- Reproducible: in-memory SQLite, deterministic test data, no SMTP dependency
- Test real multi-user collaboration via multiple Playwright browser contexts over WebSocket
- Provide reusable fixtures (authenticated page, editor with content, two-user collaboration) for future tests
- Runnable locally and in CI with a single command

**Non-Goals:**
- Visual regression testing or screenshot comparisons
- Load/stress testing the OT engine
- Testing the Obsidian plugin or MCP server
- Replacing existing backend unit tests

## Decisions

### 1. Separate `packages/e2e/` workspace

Put Playwright config, fixtures, and tests in a dedicated workspace package rather than inside frontend or backend.

**Why:** e2e tests span both packages. Keeping them separate avoids polluting either package's dev dependencies and makes it clear these are integration tests. The monorepo workspace setup makes cross-package imports trivial.

**Alternative: Tests in `packages/frontend/`** — rejected because tests also exercise backend behavior (WebSocket, OT, auth). Placing them in frontend would be misleading.

### 2. Playwright `webServer` to start backend + frontend

Use Playwright's built-in `webServer` config array to start both servers before tests:
- Backend: `npm run start:dev` in `packages/backend/` with test env vars (`DB_PATH=:memory:`, `JWT_SECRET=test-secret`, `DOMAIN_ALLOWLIST=*`, `STORAGE_ADAPTER=localfs`, `VAULT_PATH=<tmpdir>`)
- Frontend: `npm run dev` in `packages/frontend/` (Vite dev server, proxies to backend)

Playwright waits for both servers to be healthy before running tests, and kills them after.

**Why over Docker:** Docker adds complexity (image build time, networking). Direct process startup is faster, simpler to debug, and sufficient for local + CI use. The backend already supports `:memory:` SQLite and `localfs` storage adapter — no special test mode needed.

**Alternative: Single-server mode (backend serves built frontend)** — rejected because it requires a frontend build step (~10s), and Vite dev server gives HMR for test development.

### 3. JWT token generation in test fixtures

Generate valid JWT tokens directly in test fixtures using the same secret (`test-secret`) configured for the test backend. Use `jsonwebtoken` to sign tokens with the expected payload structure, then set them as cookies/localStorage before navigating.

**Why:** Avoids the magic-link email flow entirely. The backend's `JwtAuthGuard` only validates the JWT signature and expiry — it doesn't care how the token was created. This is fast, deterministic, and needs no SMTP setup.

### 4. Temporary vault directory per test

Each test (or test file) gets a fresh temporary directory as `VAULT_PATH`. Test fixtures create markdown files directly on disk before the test runs, ensuring deterministic starting content.

**Why:** Avoids test pollution. Since the backend watches the vault directory for files, placing `.md` files there before the test means the editor can open them immediately. Cleanup is automatic via `tmpdir`.

Note: since the backend is started once for all tests via `webServer`, the vault path is shared across tests in a run. Individual test isolation comes from using unique note filenames or clearing state between tests.

### 5. Editor interaction helpers as Playwright fixtures

Create custom fixtures that encapsulate common editor interactions:
- `editorPage`: authenticated page with a note open in the editor
- `collaborationPair`: two browser contexts both connected to the same note, with helpers to type in cells, wait for sync, and assert content

These use Playwright's `page.locator()` to target the TipTap editor's `.ProseMirror` container and `page.keyboard` for typing.

**Why:** Raw Playwright selectors for ProseMirror are verbose. Fixtures keep tests readable and make it easy to add new test scenarios later.

## Risks / Trade-offs

- **[Risk] Port conflicts if dev servers are already running** → Mitigation: use non-default ports for test servers (e.g., backend on 3099, frontend on 5199). Playwright config sets `reuseExistingServer: false`.
- **[Risk] Test flakiness from WebSocket timing** → Mitigation: collaboration fixtures wait for WebSocket connection + OT sync before asserting. Use Playwright's `expect().toPass()` with retry for eventual consistency checks.
- **[Risk] Backend startup time slows test feedback** → Mitigation: NestJS dev mode starts in ~2-3s. Playwright's `webServer` only starts once per test run, not per test. Acceptable for a project this size.
- **[Risk] In-memory SQLite loses state on backend restart** → Acceptable: tests should not depend on state across backend restarts. Each test run starts fresh.
