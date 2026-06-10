# Frontend E2E Testing with Playwright

## Prerequisites

- Docker running (`docker compose up -d`) — the backend serves on `:3000`
- `npm install` at root (installs `playwright` + `@tiptap/*` etc.)
- Chromium browser: `npx playwright install chromium`

## Authentication

The app uses magic-link auth. In dev mode (no SMTP), the token is logged to
Docker stdout. Here's the full flow to get a JWT programmatically:

```bash
# 1. Request a magic link (creates user if first time)
curl -s -X POST http://localhost:3000/api/auth/magic-link \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@kalepin.app"}'

# 2. Extract the verify-token UUID from Docker logs
TOKEN_UUID=$(docker logs kalepin-kalepin-1 2>&1 \
  | grep "Magic link" | tail -1 \
  | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')

# 3. Hit the verify endpoint — it 302-redirects to /?token=<JWT>
JWT=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "http://localhost:3000/api/auth/verify?token=$TOKEN_UUID" \
  | sed 's/.*token=//')
```

**Important**: each magic-link token is single-use. You need a fresh one for
every test run (steps 1-3 above).

### One-liner helper

```bash
get_jwt() {
  curl -s -X POST http://localhost:3000/api/auth/magic-link \
    -H 'Content-Type: application/json' -d '{"email":"test@kalepin.app"}' > /dev/null
  sleep 1
  local uuid=$(docker logs kalepin-kalepin-1 2>&1 \
    | grep "Magic link" | tail -1 \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
  curl -s -o /dev/null -w '%{redirect_url}' \
    "http://localhost:3000/api/auth/verify?token=$uuid" | sed 's/.*token=//'
}
export JWT=$(get_jwt)
```

## Using the JWT in Playwright

Pass the JWT via the `/?token=` query param on the first navigation.
The app stores it in `localStorage` and uses it for all subsequent requests.

```js
import { chromium } from 'playwright';

const JWT = process.env.JWT;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Auth — navigate with token query param
await page.goto(`http://localhost:3000/?token=${JWT}`);
await page.waitForSelector('.sidebar', { timeout: 10000 });
```

## Creating test data via API

Use the REST API with the JWT to set up fixtures:

```bash
# Create a file
curl -s -X POST http://localhost:3000/api/files/create \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"path":"my-test.md","content":"# Hello\n\nTest content."}'

# List files
curl -s http://localhost:3000/api/files/tree \
  -H "Authorization: Bearer $JWT"

# Read a file
curl -s "http://localhost:3000/api/files/read?path=my-test.md" \
  -H "Authorization: Bearer $JWT"

# Delete a file
curl -s -X DELETE "http://localhost:3000/api/files/delete?path=my-test.md" \
  -H "Authorization: Bearer $JWT"
```

## Navigating to a document

Two approaches:

```js
// Option A: click in the sidebar file tree
const file = page.locator('.file-tree-item', { hasText: 'my-test' });
await file.click();

// Option B: navigate directly via URL (faster, no sidebar dependency)
await page.goto('http://localhost:3000/doc/my-test.md');
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
```

## Handling the coach-mark overlay

New users (or fresh DB) trigger the onboarding tour which overlays the editor
with `.coach-mark-overlay-piece` elements that intercept pointer events.
Dismiss before interacting with editor content:

```js
// Remove all coach-mark overlays
await page.evaluate(() => {
  document.querySelectorAll('[class*=coach]').forEach(el => el.remove());
});
await page.waitForTimeout(300);
```

Alternatively, click the "Skip" button if present:

```js
const skip = page.locator('button', { hasText: /skip/i });
if (await skip.count() > 0) await skip.first().click();
```

## Detecting new-tab navigation

```js
const newPages = [];
context.on('page', (p) => newPages.push(p));

// ... perform click ...

console.log('New tabs opened:', newPages.length);
// newPages[0].url() to inspect where it went
```

## Accessing ProseMirror internals

The tiptap editor renders inside `.tiptap`. You can inspect the ProseMirror
view and its plugins from the page context:

```js
const plugins = await page.evaluate(() => {
  const el = document.querySelector('.tiptap');
  const view = el?.pmViewDesc?.view;
  if (!view) return null;
  return view.state.plugins.map(p => p.key);
});
```

## Example: full test script

```js
import { chromium } from 'playwright';

const JWT = process.env.JWT;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Track new tabs
const newPages = [];
context.on('page', (p) => newPages.push(p));

// Auth + open doc
await page.goto(`http://localhost:3000/?token=${JWT}`);
await page.waitForSelector('.sidebar', { timeout: 10000 });
await page.goto('http://localhost:3000/doc/test-anchors.md');
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
await page.waitForTimeout(1000);

// Dismiss coach marks
await page.evaluate(() => {
  document.querySelectorAll('[class*=coach]').forEach(el => el.remove());
});

// Click an anchor link
await page.locator('.tiptap a[href="#section-one"]').first().click();
await page.waitForTimeout(500);

console.log('URL:', page.url());           // should contain #section-one
console.log('New tabs:', newPages.length);  // should be 0

await browser.close();
```

### Running it

```bash
export JWT=$(get_jwt)   # see helper above
node test-my-feature.mjs
```

## Testing against the vite dev server (faster iteration)

For frontend-only changes you can skip Docker rebuilds:

```bash
# Backend stays on Docker :3000
cd packages/frontend && npx vite --port 5173
# Vite proxies /api → localhost:3000 and /ws → ws://localhost:3000

# Then point tests at http://localhost:5173 instead of :3000
```

Note: you still get the JWT from the backend on `:3000` (the magic-link
flow hits the API directly). Only the page URL changes to `:5173`.
