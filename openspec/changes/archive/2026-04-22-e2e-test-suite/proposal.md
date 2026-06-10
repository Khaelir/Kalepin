## Why

There is no end-to-end test infrastructure. Bugs like table corruption on remote edits require manual two-tab verification that's tedious and easy to skip. A self-contained Playwright suite that spins up its own backend and frontend would catch collaboration regressions automatically and enable confident iteration on editor features.

## What Changes

- Add Playwright as a dev dependency with project configuration
- Create a test harness that starts the NestJS backend (with in-memory SQLite, test JWT secret) and Vite frontend dev server automatically before tests, tears them down after
- Add a test authentication helper that generates valid JWT tokens directly (no SMTP/magic-link needed)
- Implement initial e2e tests covering the table-corruption fix: table integrity on remote edits, undo history isolation, and non-table surgical replace regression check
- Add npm scripts at root level for running the e2e suite

## Capabilities

### New Capabilities
- `e2e-test-harness`: Self-contained test infrastructure that spins up backend + frontend, manages auth, and provides Playwright fixtures for editor interaction and multi-user collaboration scenarios

### Modified Capabilities

## Impact

- New package/directory: `packages/e2e/` (Playwright config, fixtures, tests)
- Root `package.json`: new `test:e2e` script
- No changes to backend or frontend source code
- New dev dependencies: `@playwright/test`, `playwright`
