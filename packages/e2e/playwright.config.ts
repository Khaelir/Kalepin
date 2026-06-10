import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';

// Use fixed paths so config + test workers + the backend webServer share the
// same vault, personal-root and SQLite database. The wipe runs as part of the
// backend webServer command (see `wipeDataCmd` below); doing it at module
// import time would re-execute in every worker process and yank the DB out
// from under a running backend (SQLITE_READONLY_DBMOVED).
const dataRoot = path.join(os.tmpdir(), 'kalepin-e2e');
const vaultPath = path.join(dataRoot, 'vault');
const personalPath = path.join(dataRoot, 'personal');
const dbPath = path.join(dataRoot, 'kalepin.sqlite');
const kekPath = path.join(dataRoot, 'kalepin.kek');

export const BACKEND_PORT = 3099;
export const FRONTEND_PORT = 5199;
export const VAULT_PATH = vaultPath;
export const PERSONAL_PATH = personalPath;
export const DB_PATH = dbPath;
export const KEK_PATH = kekPath;

// Tests in this glob run on every browser project (chromium / firefox / webkit).
// Everything else stays on chromium-only to keep CI fast — the multi-browser
// pass is for UI surfaces whose rendering / interaction differs across engines.
const MULTI_BROWSER_GLOB = '**/personal-folders-ui.spec.ts';

// Shell-level wipe injected into the backend webServer command so it runs
// exactly once (before nest build / before the DB is opened) and is not
// re-executed in worker subprocesses that re-import this config. Quoting is
// careful because Playwright runs the command via /bin/sh.
const wipeDataCmd = `rm -rf ${JSON.stringify(dataRoot)} && mkdir -p ${JSON.stringify(vaultPath)} ${JSON.stringify(personalPath)}`;

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Default project runs everything (existing behavior preserved).
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: MULTI_BROWSER_GLOB,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: MULTI_BROWSER_GLOB,
    },
  ],
  webServer: [
    {
      command: `${wipeDataCmd} && pnpm exec nest build && node dist/backend/src/main.js`,
      cwd: path.resolve(__dirname, '../backend'),
      port: BACKEND_PORT,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        DB_PATH: dbPath,
        JWT_SECRET: 'test-secret',
        VAULT_PATH: vaultPath,
        PERSONAL_PATH: personalPath,
        STORAGE_ADAPTER: 'localfs',
        PORT: String(BACKEND_PORT),
        DOMAIN_ALLOWLIST: '*',
        LOG_LEVEL: 'warn',
        // Phase 4 leak-token harness needs an introspection surface
        // (route list, MCP tool list, notification counters). The backend
        // exposes /api/__test/* only when this flag is set.
        EXPOSE_TEST_ENDPOINTS: '1',
        // At-rest encryption: enable for the entire e2e suite so we exercise
        // the encrypting storage adapter on every test. The KEK is auto-
        // generated on first boot inside the wiped data root; subsequent
        // test sessions get a fresh KEK.
        KALEPIN_KEK_FILE: kekPath,
        KALEPIN_KEK_AUTO_GENERATE: '1',
      },
    },
    {
      // `E2E_USE_BUILD=1` swaps the dev server for a production build served
      // through `vite preview`. Some bugs only surface in the production
      // bundle (e.g. @rollup/plugin-commonjs's `require` shim re-activating
      // a Node-only branch in argon2-browser); the dev server uses esbuild
      // and never reproduces them. CI should run at least the smoke specs in
      // both modes.
      command:
        process.env.E2E_USE_BUILD === '1'
          ? `pnpm exec vite build && pnpm exec vite preview --port ${FRONTEND_PORT} --strictPort`
          : `pnpm exec vite --port ${FRONTEND_PORT}`,
      cwd: path.resolve(__dirname, '../frontend'),
      port: FRONTEND_PORT,
      timeout: process.env.E2E_USE_BUILD === '1' ? 180_000 : 30_000,
      reuseExistingServer: false,
      env: {
        BACKEND_URL: `http://localhost:${BACKEND_PORT}`,
        // Personal-folders-ui (15.1 empty) and secure-vault-setup-ui both
        // assert against the Encrypted Folder placeholder — turning the flag
        // on lets those specs run against the same bundle as the rest.
        E2E_SECURE_FOLDER: '1',
      },
    },
  ],
});
