## 1. Package and Playwright setup

- [x] 1.1 Create `packages/e2e/` directory with `package.json` (`@kalepin/e2e`, private, devDeps: `@playwright/test`), add it to root workspace list, and run `npm install`.
- [x] 1.2 Create `packages/e2e/playwright.config.ts` with `webServer` array: backend on port 3099 (`DB_PATH=:memory:`, `JWT_SECRET=test-secret`, `VAULT_PATH=<tmpdir>`, `STORAGE_ADAPTER=localfs`, `PORT=3099`), frontend Vite on port 5199 proxying to backend. Set `reuseExistingServer: false`.
- [x] 1.3 Add `"test:e2e": "npm run test:e2e -w @kalepin/e2e"` script to root `package.json`, and the corresponding script in `packages/e2e/package.json` that runs `playwright test`.

## 2. Test fixtures

- [x] 2.1 Create `packages/e2e/fixtures.ts` with a base `test` export extending Playwright's `test`. Add an `editorPage` fixture that: generates a JWT token (using `jsonwebtoken` with `test-secret`), sets it in browser storage, navigates to the app, and waits for the editor to be ready.
- [x] 2.2 Add a `createNote` helper fixture/function that writes a `.md` file to the vault temp directory and returns its path/slug for navigation.
- [x] 2.3 Add a `collaborationPair` fixture that creates two independent browser contexts (each with distinct JWT user identities), opens the same note in both, and waits for WebSocket connections to be established. Include a `waitForSync` helper that polls until the second editor reflects a change.

## 3. Table corruption tests

- [x] 3.1 Write test: user A types in a table cell, verify user B's editor has intact table structure (correct row/cell count, no nested tables).
- [x] 3.2 Write test: after remote table edit syncs to user B, user B presses Ctrl+Z — verify remote edit remains visible.
- [x] 3.3 Write test: user A edits a paragraph (non-table content), verify user B sees the update without corruption (regression check for surgical replace).

## 4. CI and polish

- [x] 4.1 Ensure `npx playwright install --with-deps chromium` runs as part of setup (document in package.json or add a `postinstall` script). Verify `npm run test:e2e` works end-to-end from a clean state.
