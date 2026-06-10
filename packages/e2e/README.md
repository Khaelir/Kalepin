# E2E Tests

End-to-end tests using Playwright. The suite is self-contained: it starts the backend (in-memory SQLite) and frontend (Vite dev server) automatically, runs tests, and tears everything down.

## Quick start

```bash
# From project root
npm run test:e2e

# From this directory
npx playwright test

# Run a single test file
npx playwright test tests/table-collaboration.spec.ts

# Run in headed mode (see the browser)
npx playwright test --headed

# Debug a specific test
npx playwright test --debug -g "remote cell edit"
```

## Architecture

```
packages/e2e/
  playwright.config.ts   # Server startup, ports, vault path
  fixtures.ts            # Reusable fixtures (editorPage, collaborationPair, createNote)
  tests/                 # Test files (*.spec.ts)
```

**How it works:**
1. Playwright config wipes and recreates a temp vault directory (`/tmp/kalepin-e2e-vault`)
2. `webServer` starts the backend on port 3099 (`DB_PATH=:memory:`, `JWT_SECRET=test-secret`) and frontend on port 5199
3. Tests create `.md` files in the vault, generate JWT tokens, and open pages
4. After all tests finish, servers are killed automatically

## Writing a new test

### 1. Create a spec file

All test files go in `tests/` and must end with `.spec.ts`.

```ts
// tests/my-feature.spec.ts
import { test, expect, createNote } from '../fixtures';

test.describe('My feature', () => {
  test('does something', async ({ editorPage }) => {
    // editorPage.page is an authenticated Playwright Page with a note open
    const { page } = editorPage;
    // ...
  });
});
```

### 2. Choose the right fixture

**`editorPage`** — Single authenticated user with a note open in the editor.

```ts
test('single user editing', async ({ editorPage }) => {
  const { page, notePath } = editorPage;
  // page is ready, editor is visible
  await page.locator('.editor-content .tiptap p').first().click();
  await page.keyboard.type('Hello');
});
```

**`collaborationPair`** — Two users (Alice & Bob) with the same note open, connected via WebSocket.

```ts
test('two users see each other edits', async ({ collaborationPair }) => {
  const { pageA, pageB, waitForSync } = collaborationPair;
  // Both pages have the editor open on the same (empty) note
});
```

**Manual setup with `createNote` + `setupPair`** — When you need custom starting content (tables, headings, etc.), create the note yourself and set up the pair manually. See `table-collaboration.spec.ts` for the pattern.

### 3. Create notes with specific content

Use `createNote(filename, markdown)` to write a file to the test vault before opening it.

```ts
const noteName = `my-test-${Date.now()}.md`;
createNote(noteName, '# Title\n\nSome paragraph.\n');
```

**Rules:**
- Always include `Date.now()` in the filename to avoid collisions between tests
- The file is written to the shared vault directory that the backend watches
- The backend picks it up automatically when opened via `/doc/<filename>`

### 4. Navigate to a note

```ts
await page.goto(`http://localhost:5199/doc/${encodeURIComponent(noteName)}`);
await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
```

## Common patterns

### Wait for remote sync

Never use `waitForTimeout` to wait for sync. Use `expect().toPass()` which retries:

```ts
await expect(async () => {
  const text = await pageB.locator('.editor-content .tiptap').innerText();
  expect(text).toContain('expected text');
}).toPass({ timeout: 10_000 });
```

### Type into the editor

```ts
// Click a paragraph then type
await page.locator('.editor-content .tiptap p').first().click();
await page.keyboard.type('new text');

// Type at end of a line
await page.locator('.editor-content .tiptap p').first().click();
await page.keyboard.press('End');
await page.keyboard.type(' appended');
```

### Interact with table cells

```ts
// Click a specific cell
const cell = page.locator('.editor-content .tiptap table td').first();
await cell.click();
await page.keyboard.type('cell content');
```

### Assert editor content

```ts
// Text content
await expect(page.locator('.editor-content .tiptap p').first()).toContainText('expected');

// Element count
await expect(page.locator('.editor-content .tiptap table')).toHaveCount(1);

// Absence
await expect(page.locator('.editor-content .tiptap table table')).toHaveCount(0);
```

### Keyboard shortcuts

```ts
// Undo (macOS)
await page.keyboard.press('Meta+z');

// Bold
await page.keyboard.press('Meta+b');

// Select all
await page.keyboard.press('Meta+a');
```

## Key selectors

| Selector | Target |
|----------|--------|
| `.editor-content .tiptap` | The ProseMirror/TipTap editor root |
| `.editor-content .tiptap p` | Paragraphs |
| `.editor-content .tiptap h1` | Headings (h1-h6) |
| `.editor-content .tiptap table` | Tables |
| `.editor-content .tiptap table td` | Table data cells |
| `.editor-content .tiptap table th` | Table header cells |
| `.editor-content .tiptap pre code` | Code blocks |
| `.editor-content .tiptap ul[data-type="taskList"]` | Task lists |
| `.editor-content .tiptap a` | Links |
| `.editor-content .tiptap img` | Images |
| `.editor-mode-toggle` | Mode toggle bar |

## Rules

1. **One concern per test.** Each test should verify one behavior. Don't combine "typing works" and "undo works" in the same test.

2. **Never sleep to wait for sync.** Use `expect().toPass()` with a timeout. Sleeping makes tests slow and flaky.

3. **Unique filenames.** Always use `Date.now()` (or similar) in note filenames. Tests run sequentially with a shared vault.

4. **Clean up browser contexts.** If you create contexts manually (not via fixtures), close them in a `cleanup()` or `afterEach`. Leaked contexts leave open WebSocket connections.

5. **Use `Meta+z` not `Control+z`.** Tests run on macOS. If you need cross-platform, use `process.platform === 'darwin' ? 'Meta' : 'Control'`.

6. **Don't assert on timing.** The OT sync latency varies. Always use retry-based assertions for anything involving remote changes.

7. **Test files go in `tests/`.** The Playwright config only scans `packages/e2e/tests/`. Files elsewhere won't be picked up.

8. **Keep test data minimal.** Only put the markdown content you need in `createNote`. Large documents slow down the editor initialization.

## Authentication details

Tests bypass the magic link flow entirely. Fixtures sign JWT tokens directly using `jsonwebtoken` with the test backend's secret (`test-secret`). The token is set in `localStorage` under the key `kalepin_token` before navigation.

The test users don't exist in the database (only the JWT is validated). This means:
- WebSocket/OT collaboration works normally
- Some REST endpoints (`/api/updates`) log errors server-side, but the frontend silently ignores them
- This is harmless and doesn't affect test behavior

## Troubleshooting

**Tests can't find the editor** — The backend may not have started in time. Check if port 3099 is free. Increase `webServer.timeout` in `playwright.config.ts` if needed.

**Port already in use** — Kill stale processes: `lsof -ti:3099 -ti:5199 | xargs kill -9`

**Content not loading** — Verify the note file was created before navigation. `createNote` must be called before `page.goto`.

**Flaky sync assertions** — Increase the `toPass()` timeout. If consistently failing, add a `await page.waitForTimeout(500)` before the first assertion (last resort).
